const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const network = require('../utils/network');

const WG_DIR = '/etc/wireguard';
const WG_IFACE = config.vpn.wireguard.interface;

function ensureDirs() {
  if (!fs.existsSync(WG_DIR)) fs.mkdirSync(WG_DIR, { recursive: true });
}

function isInstalled() {
  try {
    execSync('which wg', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function initServer() {
  if (!isInstalled()) {
    logger.warn('WireGuard tools not installed. Install with: apt install wireguard-tools');
    return false;
  }

  ensureDirs();
  const db = getDb();
  const mainIface = network.getMainInterface();

  // Generate server keys if not exist
  let svrPrivKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_private_key'").get()?.value;
  if (!svrPrivKey) {
    const privKey = execSync('wg genkey', { encoding: 'utf8' }).trim();
    const pubKey = execSync(`echo "${privKey}" | wg pubkey`, { encoding: 'utf8' }).trim();
    db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_server_private_key', ?)").run(privKey);
    db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_server_public_key', ?)").run(pubKey);
    svrPrivKey = privKey;
    logger.info(`WireGuard server keys generated. Public key: ${pubKey}`);
  }

  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_port', ?)").run(String(config.vpn.wireguard.port));
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_subnet', ?)").run(config.vpn.wireguard.subnet);
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('dns_servers', ?)").run(config.vpn.dns.join(', '));

  writeConfig();
  return true;
}

function writeConfig() {
  const db = getDb();
  const mainIface = network.getMainInterface();
  const svrPrivKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_private_key'").get()?.value;
  const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
  const wgSubnet = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_subnet'").get()?.value || '10.0.0.0/24';
  const svrIp = wgSubnet.split('/')[0].replace(/\.\d+$/, '.1') + '/' + wgSubnet.split('/')[1];

  if (!svrPrivKey) return false;

  let conf = `[Interface]
Address = ${svrIp}
PrivateKey = ${svrPrivKey}
ListenPort = ${wgPort}
PostUp = iptables -A FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${mainIface} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_IFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${mainIface} -j MASQUERADE
`;

  const users = db.prepare('SELECT * FROM vpn_users WHERE enabled = 1').all();
  for (const user of users) {
    if (user.wg_public_key && user.wg_address) {
      conf += `\n# ${user.username}\n[Peer]\nPublicKey = ${user.wg_public_key}\nPresharedKey = ${user.wg_preshared_key}\nAllowedIPs = ${user.wg_address}/32\n`;
    }
  }

  fs.writeFileSync(path.join(WG_DIR, `${WG_IFACE}.conf`), conf);
  return true;
}

function start() {
  if (!isInstalled()) return;
  try {
    execSync(`wg-quick up ${WG_IFACE} 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    logger.info(`WireGuard ${WG_IFACE} is up`);
  } catch (e) {
    try { execSync(`wg show ${WG_IFACE}`, { encoding: 'utf8', stdio: 'pipe' }); }
    catch { logger.error(`Failed to start WireGuard: ${e.message}`); }
  }
}

function stop() {
  if (!isInstalled()) return;
  try {
    execSync(`wg-quick down ${WG_IFACE} 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
  } catch {}
}

function restart() {
  stop();
  writeConfig();
  start();
}

function addPeer(username, publicKey, presharedKey, address) {
  if (!isInstalled() || !publicKey || !address) return;
  try {
    // Write preshared key to temp file (process substitution not supported by /bin/sh)
    const tmpFile = `/tmp/wg-psk-${username}`;
    fs.writeFileSync(tmpFile, presharedKey);
    execSync(`wg set ${WG_IFACE} peer ${publicKey} preshared-key ${tmpFile} allowed-ips ${address}/32`, { encoding: 'utf8', timeout: 5000 });
    fs.unlinkSync(tmpFile);
    logger.info(`WireGuard peer added: ${username} (${address})`);
  } catch (e) {
    logger.warn(`WireGuard add peer (${username}) failed: ${e.message}`);
  }
  writeConfig();
}

function removePeer(username, publicKey) {
  if (!isInstalled() || !publicKey) return;
  try {
    execSync(`wg set ${WG_IFACE} peer ${publicKey} remove`, { encoding: 'utf8', timeout: 5000 });
    logger.info(`WireGuard peer removed: ${username}`);
  } catch (e) {
    logger.warn(`WireGuard remove peer (${username}) failed: ${e.message}`);
  }
  writeConfig();
}

function getPeers() {
  if (!isInstalled()) return [];
  try {
    const output = execSync(`wg show ${WG_IFACE} dump`, { encoding: 'utf8', timeout: 5000 }).trim();
    const lines = output.split('\n').slice(1);
    return lines.map(line => {
      const parts = line.split('\t');
      return {
        publicKey: parts[0],
        presharedKey: parts[1],
        endpoint: parts[2],
        allowedIps: parts[3],
        latestHandshake: parseInt(parts[4]) || 0,
        transferRx: parseInt(parts[5]) || 0,
        transferTx: parseInt(parts[6]) || 0,
      };
    });
  } catch { return []; }
}

function monitorPeers() {
  if (!isInstalled()) return;
  const db = getDb();
  const peers = getPeers();
  const now = Math.floor(Date.now() / 1000);

  for (const peer of peers) {
    if (!peer.allowedIps) continue;
    const ip = peer.allowedIps.split('/')[0];
    const user = db.prepare('SELECT * FROM vpn_users WHERE wg_address = ? OR wg_public_key = ?').get(ip, peer.publicKey);
    if (!user) continue;

    const isActive = (now - peer.latestHandshake) < 180;
    const existing = db.prepare('SELECT * FROM active_sessions WHERE assigned_ip = ?').get(ip);

    if (isActive && !existing) {
      db.prepare(`
        INSERT INTO active_sessions (username, client_ip, assigned_ip, peer_pubkey, bytes_sent, bytes_recv, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(user.username, peer.endpoint || '', ip, peer.publicKey, peer.transferRx, peer.transferTx);
      logger.info(`Session started: ${user.username} via WireGuard (${ip})`);
    } else if (isActive && existing) {
      db.prepare(`
        UPDATE active_sessions SET last_seen = CURRENT_TIMESTAMP, bytes_sent = ?, bytes_recv = ?, client_ip = ?
        WHERE id = ?
      `).run(peer.transferRx, peer.transferTx, peer.endpoint || '', existing.id);

      db.prepare('UPDATE vpn_users SET last_handshake = CURRENT_TIMESTAMP, total_bytes_sent = ?, total_bytes_recv = ? WHERE id = ?')
        .run(peer.transferTx, peer.transferRx, user.id);
    } else if (!isActive && existing && (now - peer.latestHandshake) > 300) {
      db.prepare(`
        INSERT INTO sessions_log (username, client_ip, assigned_ip, connected_at, disconnected_at, bytes_sent, bytes_recv, disconnect_reason)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'timeout')
      `).run(user.username, existing.client_ip, existing.assigned_ip, existing.connected_at, existing.bytes_sent, existing.bytes_recv);
      db.prepare('DELETE FROM active_sessions WHERE id = ?').run(existing.id);
      logger.info(`Session ended: ${user.username} (timeout)`);
    }
  }
}

module.exports = { initServer, writeConfig, start, stop, restart, addPeer, removePeer, getPeers, monitorPeers, isInstalled };
