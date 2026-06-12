const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const network = require('../utils/network');

const OVPN_DIR = '/etc/openvpn';
const OVPN_CONFIG_DIR = path.join(config.paths.configs, 'openvpn');
const OVPN_CCD_DIR = path.join(OVPN_CONFIG_DIR, 'ccd');
const OVPN_CLIENT_DIR = path.join(OVPN_CONFIG_DIR, 'clients');
const OVPN_SERVER_DIR = path.join(OVPN_CONFIG_DIR, 'server');
const EASYRSA_DIR = path.join(config.paths.root, 'easy-rsa');

function ensureDirs() {
  [OVPN_DIR, OVPN_CCD_DIR, OVPN_CLIENT_DIR, OVPN_SERVER_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function isInstalled() {
  try {
    execSync('which openvpn', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function initServer() {
  if (!isInstalled()) {
    logger.warn('OpenVPN not installed. Install with: apt install openvpn easy-rsa');
    return false;
  }

  ensureDirs();
  const db = getDb();

  // Check if PKI is initialized
  const pkiDir = path.join(EASYRSA_DIR, 'pki');
  if (!fs.existsSync(path.join(pkiDir, 'ca.crt'))) {
    logger.info('Initializing EasyRSA PKI...');
    try {
      execSync(`cd ${EASYRSA_DIR} && ./easyrsa init-pki 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
      execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa build-ca nopass 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
      execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa gen-dh 2>/dev/null`, { encoding: 'utf8', timeout: 60000 });
      execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa build-server-full server nopass 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });

      // Copy to server dir
      execSync(`cp ${pkiDir}/ca.crt ${OVPN_SERVER_DIR}/`, { encoding: 'utf8' });
      execSync(`cp ${pkiDir}/issued/server.crt ${OVPN_SERVER_DIR}/`, { encoding: 'utf8' });
      execSync(`cp ${pkiDir}/private/server.key ${OVPN_SERVER_DIR}/`, { encoding: 'utf8' });
      execSync(`cp ${pkiDir}/dh.pem ${OVPN_SERVER_DIR}/`, { encoding: 'utf8' });

      // Generate ta.key
      execSync(`openvpn --genkey secret ${OVPN_SERVER_DIR}/ta.key`, { encoding: 'utf8', timeout: 10000 });

      // Save CA cert to DB for inline .ovpn
      const caCert = fs.readFileSync(path.join(OVPN_SERVER_DIR, 'ca.crt'), 'utf8');
      db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('ovpn_ca_cert', ?)").run(caCert);

      logger.info('OpenVPN PKI initialized successfully');
    } catch (e) {
      logger.error(`Failed to initialize EasyRSA: ${e.message}`);
      return false;
    }
  } else {
    // Ensure CA cert is in DB
    const caCertPath = path.join(OVPN_SERVER_DIR, 'ca.crt');
    if (fs.existsSync(caCertPath)) {
      const caCert = fs.readFileSync(caCertPath, 'utf8');
      db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('ovpn_ca_cert', ?)").run(caCert);
    }
  }

  // Save settings
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('ovpn_port', ?)").run(String(config.vpn.openvpn.port));
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('ovpn_proto', ?)").run(config.vpn.openvpn.proto);

  // Write server.conf
  const mainIface = network.getMainInterface();
  const svrSubnet = config.vpn.openvpn.subnet;
  const svrIp = svrSubnet.split('/')[0].replace(/\.\d+$/, '.0');
  const svrMask = svrSubnet.includes('/24') ? '255.255.255.0' : '255.255.255.0';

  const conf = `port ${config.vpn.openvpn.port}
proto ${config.vpn.openvpn.proto}
dev tun
ca ${OVPN_SERVER_DIR}/ca.crt
cert ${OVPN_SERVER_DIR}/server.crt
key ${OVPN_SERVER_DIR}/server.key
dh ${OVPN_SERVER_DIR}/dh.pem
server ${svrIp} ${svrMask}
ifconfig-pool-persist ${OVPN_DIR}/ipp.txt
client-config-dir ${OVPN_CCD_DIR}
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS ${config.vpn.dns[0]}"
push "dhcp-option DNS ${config.vpn.dns[1] || config.vpn.dns[0]}"
client-to-client
keepalive 10 120
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun
status ${OVPN_DIR}/status.log 5
log-append ${OVPN_DIR}/openvpn.log
verb 3
explicit-exit-notify 1
`;

  fs.writeFileSync(path.join(OVPN_DIR, 'server.conf'), conf);
  logger.info('OpenVPN server.conf written');

  return true;
}

function start() {
  if (!isInstalled()) return;
  try {
    execSync('systemctl start openvpn@server 2>/dev/null || openvpn --daemon --config /etc/openvpn/server.conf', { encoding: 'utf8', timeout: 10000 });
    logger.info('OpenVPN started');
  } catch (e) {
    logger.error(`Failed to start OpenVPN: ${e.message}`);
  }
}

function stop() {
  if (!isInstalled()) return;
  try {
    execSync('systemctl stop openvpn@server 2>/dev/null; pkill openvpn 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    logger.info('OpenVPN stopped');
  } catch {}
}

function restart() {
  stop();
  initServer();
  start();
}

function addClient(username, ip) {
  if (!isInstalled()) return;
  const db = getDb();

  // Check if client cert exists
  const clientCertPath = path.join(EASYRSA_DIR, 'pki', 'issued', `${username}.crt`);
  if (!fs.existsSync(clientCertPath)) {
    try {
      execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa build-client-full ${username} nopass 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
      logger.info(`OpenVPN client cert created: ${username}`);
    } catch (e) {
      logger.error(`Failed to create OpenVPN client ${username}: ${e.message}`);
      return;
    }
  }

  // Create CCD file
  if (ip) {
    fs.writeFileSync(path.join(OVPN_CCD_DIR, username), `ifconfig-push ${ip} 255.255.255.0\n`);
  }

  // Create .ovpn file
  const clientDir = path.join(OVPN_CLIENT_DIR, username);
  if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

  try {
    execSync(`cp ${path.join(EASYRSA_DIR, 'pki', 'issued', `${username}.crt`)} ${clientDir}/`, { encoding: 'utf8' });
    execSync(`cp ${path.join(EASYRSA_DIR, 'pki', 'private', `${username}.key`)} ${clientDir}/`, { encoding: 'utf8' });
    execSync(`cp ${OVPN_SERVER_DIR}/ca.crt ${clientDir}/`, { encoding: 'utf8' });
    execSync(`cp ${OVPN_SERVER_DIR}/ta.key ${clientDir}/ 2>/dev/null`, { encoding: 'utf8' });
  } catch {}
}

function removeClient(username) {
  if (!isInstalled()) return;
  try {
    execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa revoke ${username} 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
    execSync(`cd ${EASYRSA_DIR} && EASYRSA_BATCH=1 ./easyrsa gen-crl 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
    execSync(`cp ${path.join(EASYRSA_DIR, 'pki', 'crl.pem')} ${OVPN_DIR}/crl.pem 2>/dev/null`, { encoding: 'utf8' });

    // Remove files
    const clientDir = path.join(OVPN_CLIENT_DIR, username);
    if (fs.existsSync(clientDir)) fs.rmSync(clientDir, { recursive: true });
    if (fs.existsSync(path.join(OVPN_CCD_DIR, username))) fs.rmSync(path.join(OVPN_CCD_DIR, username));

    logger.info(`OpenVPN client removed: ${username}`);
  } catch (e) {
    logger.error(`Failed to remove OpenVPN client ${username}: ${e.message}`);
  }
}

function getStatus() {
  try {
    const statusFile = '/etc/openvpn/status.log';
    if (!fs.existsSync(statusFile)) return [];
    const content = fs.readFileSync(statusFile, 'utf8');
    const lines = content.split('\n');
    const clients = [];
    let inClientList = false;

    for (const line of lines) {
      if (line.startsWith('OpenVPN CLIENT LIST')) { inClientList = true; continue; }
      if (line.startsWith('ROUTING TABLE')) { inClientList = false; }
      if (inClientList && line.startsWith('Updated,')) continue;
      if (inClientList && line.includes(',')) {
        const parts = line.split(',');
        if (parts.length >= 5 && !parts[0].startsWith('Common')) {
          clients.push({
            username: parts[0],
            realAddress: parts[1],
            virtualAddress: parts[2],
            bytesReceived: parseInt(parts[3]) || 0,
            bytesSent: parseInt(parts[4]) || 0,
            connectedSince: parts[5],
          });
        }
      }
    }
    return clients;
  } catch {
    return [];
  }
}

function monitorClients() {
  const db = getDb();
  const clients = getStatus();
  const now = Date.now();

  for (const client of clients) {
    const user = db.prepare('SELECT * FROM vpn_users WHERE username = ?').get(client.username);
    if (!user) continue;

    const existing = db.prepare('SELECT * FROM active_sessions WHERE assigned_ip = ? AND protocol = ?')
      .get(client.virtualAddress, 'openvpn');

    if (!existing) {
      db.prepare(`
        INSERT INTO active_sessions (username, protocol, client_ip, assigned_ip, bytes_sent, bytes_recv, last_seen)
        VALUES (?, 'openvpn', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(client.username, client.realAddress, client.virtualAddress, client.bytesSent, client.bytesReceived);
      logger.info(`Session started: ${client.username} via OpenVPN (${client.virtualAddress})`);
    } else {
      db.prepare(`
        UPDATE active_sessions SET last_seen = CURRENT_TIMESTAMP, bytes_sent = ?, bytes_recv = ?, client_ip = ?
        WHERE id = ?
      `).run(client.bytesSent, client.bytesReceived, client.realAddress, existing.id);
    }
  }
}

module.exports = { initServer, start, stop, restart, addClient, removeClient, getStatus, monitorClients, isInstalled };
