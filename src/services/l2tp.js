const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const IPSEC_DIR = '/etc/ipsec.d';
const L2TP_DIR = '/etc/xl2tpd';
const PPP_DIR = '/etc/ppp';
const L2TP_CONFIG_DIR = path.join(config.paths.configs, 'l2tp');

function ensureDirs() {
  [L2TP_CONFIG_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function isStrongSwanInstalled() {
  try {
    execSync('which ipsec', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function isXl2tpdInstalled() {
  try {
    execSync('which xl2tpd', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function initServer() {
  const strongSwanOk = isStrongSwanInstalled();
  const xl2tpdOk = isXl2tpdInstalled();

  if (!strongSwanOk || !xl2tpdOk) {
    logger.warn('L2TP/IPsec not fully installed. Need: apt install strongswan xl2tpd ppp');
    return false;
  }

  ensureDirs();
  const db = getDb();
  const psk = db.prepare("SELECT value FROM server_settings WHERE key = 'l2tp_ipsec_psk'").get()?.value || config.vpn.l2tp.ipsecPsk;

  // Write ipsec.conf
  const ipsecConf = `config setup
    charondebug="ike 2, knl 2, cfg 2"
    uniqueids=no

conn %default
    ikelifetime=24h
    lifetime=8h
    rekey=yes
    dpdaction=clear
    dpddelay=30
    dpdtimeout=120

conn l2tp-vpn
    type=transport
    left=%any
    leftprotoport=17/1701
    right=%any
    rightprotoport=17/%any
    auto=add
    keyexchange=ikev1
    authby=secret
    ike=aes128-sha1-modp1024
    esp=aes128-sha1-modp1024
`;
  fs.writeFileSync(path.join(L2TP_CONFIG_DIR, 'ipsec.conf'), ipsecConf);
  if (fs.existsSync(IPSEC_DIR)) {
    fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'ipsec.conf'), path.join(IPSEC_DIR, 'l2tp.conf'));
  }

  // Write ipsec.secrets
  const ipsecSecrets = `%any  %any : PSK "${psk}"\n`;
  fs.writeFileSync(path.join(L2TP_CONFIG_DIR, 'ipsec.secrets'), ipsecSecrets);
  if (fs.existsSync(IPSEC_DIR)) {
    fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'ipsec.secrets'), path.join(IPSEC_DIR, 'l2tp.secrets'));
  }

  // Write xl2tpd.conf
  const xl2tpdConf = `[global]
listen-addr = 0.0.0.0
port = 1701
access control = no

[lns default]
ip range = 10.0.2.2-10.0.2.254
local ip = 10.0.2.1
require chap = yes
refuse pap = no
require authentication = yes
name = tunnel-server
ppp debug = yes
pppoptfile = ${L2TP_CONFIG_DIR}/options.xl2tpd
length bit = yes
`;
  fs.writeFileSync(path.join(L2TP_CONFIG_DIR, 'xl2tpd.conf'), xl2tpdConf);
  if (fs.existsSync(L2TP_DIR)) {
    fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'xl2tpd.conf'), path.join(L2TP_DIR, 'xl2tpd.conf'));
  }

  // Write options.xl2tpd
  const optionsXl2tpd = `ipcp-accept-local
ipcp-accept-remote
ms-dns ${config.vpn.dns[0]}
ms-dns ${config.vpn.dns[1] || config.vpn.dns[0]}
noccp
auth
crtscts
idle 1800
mtu 1410
mru 1410
nodefaultroute
debug
lock
proxyarp
connect-delay 5000
name tunnel-server
plugin chap_ms.so
`;
  fs.writeFileSync(path.join(L2TP_CONFIG_DIR, 'options.xl2tpd'), optionsXl2tpd);
  if (fs.existsSync(L2TP_DIR)) {
    fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'options.xl2tpd'), path.join(L2TP_DIR, 'options.xl2tpd'));
  }

  // Write chap-secrets with all enabled L2TP users
  writeChapSecrets();

  // Also write to /etc/ppp if accessible
  if (fs.existsSync(PPP_DIR)) {
    try {
      fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'chap-secrets'), path.join(PPP_DIR, 'chap-secrets'));
    } catch {}
  }

  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('l2tp_ipsec_psk', ?)").run(psk);
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('l2tp_subnet', ?)").run(config.vpn.l2tp.subnet);

  logger.info('L2TP/IPsec configuration written');
  return true;
}

function writeChapSecrets() {
  const db = getDb();
  const users = db.prepare('SELECT * FROM vpn_users WHERE enabled = 1 AND l2tp_enabled = 1').all();
  let content = '# username\tserver\tpassword\tip\n';
  for (const user of users) {
    if (user.password) {
      content += `${user.username}\t*\t${user.password}\t*\n`;
    }
  }
  fs.writeFileSync(path.join(L2TP_CONFIG_DIR, 'chap-secrets'), content);
}

function start() {
  if (!isStrongSwanInstalled() || !isXl2tpdInstalled()) return;
  try {
    execSync('ipsec restart 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    execSync('systemctl start xl2tpd 2>/dev/null || xl2tpd -c /etc/xl2tpd/xl2tpd.conf 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    logger.info('L2TP/IPsec started');
  } catch (e) {
    logger.error(`Failed to start L2TP/IPsec: ${e.message}`);
  }
}

function stop() {
  try {
    execSync('ipsec stop 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    execSync('systemctl stop xl2tpd 2>/dev/null; pkill xl2tpd 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    logger.info('L2TP/IPsec stopped');
  } catch {}
}

function restart() {
  stop();
  initServer();
  try {
    // Load IPsec config
    if (fs.existsSync(IPSEC_DIR)) {
      execSync(`ipsec rereadsecrets 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      execSync(`ipsec reload 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    }
    start();
  } catch {}
}

function addUser(username, password) {
  if (!password) return;
  writeChapSecrets();
  if (fs.existsSync(PPP_DIR)) {
    try {
      fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'chap-secrets'), path.join(PPP_DIR, 'chap-secrets'));
    } catch {}
  }
  logger.info(`L2TP user added/updated: ${username}`);
}

function removeUser(username) {
  writeChapSecrets();
  if (fs.existsSync(PPP_DIR)) {
    try {
      fs.copyFileSync(path.join(L2TP_CONFIG_DIR, 'chap-secrets'), path.join(PPP_DIR, 'chap-secrets'));
    } catch {}
  }
  logger.info(`L2TP user removed: ${username}`);
}

function getActiveConnections() {
  try {
    const output = execSync('ipsec statusall 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const connections = [];
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('ESTABLISHED')) {
        const match = line.match(/([\d.]+)\[.+?\].+?([\d.]+)\[/);
        if (match) {
          connections.push({ clientIp: match[1] || 'unknown' });
        }
      }
    }

    // Also check ppp interfaces
    try {
      const pppOutput = execSync('ip -o addr show dev ppp+ 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const pppLines = pppOutput.split('\n').filter(Boolean);
      for (const pppLine of pppLines) {
        const ipMatch = pppLine.match(/inet (\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          connections.push({ assignedIp: ipMatch[1] });
        }
      }
    } catch {}

    return connections;
  } catch {
    return [];
  }
}

function monitorConnections() {
  const db = getDb();
  const connections = getActiveConnections();

  // L2TP monitoring is trickier - we primarily rely on ppp interface tracking
  try {
    const pppOutput = execSync('ip -o addr show dev ppp+ 2>/dev/null; echo "done"', { encoding: 'utf8', timeout: 3000 });
    const lines = pppOutput.split('\n').filter(l => l.includes('inet '));
    for (const line of lines) {
      const match = line.match(/inet (\d+\.\d+\.\d+\.\d+)/);
      if (!match) continue;
      const assignedIp = match[1];

      const existing = db.prepare('SELECT * FROM active_sessions WHERE assigned_ip = ? AND protocol = ?')
        .get(assignedIp, 'l2tp');
      if (!existing) {
        // Try to find username from ppp interface
        const ifaceMatch = line.match(/^(\d+):\s+(ppp\d+)/);
        if (ifaceMatch) {
          const pppIface = ifaceMatch[2];
          try {
            const status = execSync(`cat /sys/class/net/${pppIface}/device/driver 2>/dev/null`, { encoding: 'utf8', timeout: 2000 });
          } catch {}
        }
        // Log generic L2TP connection
        db.prepare(`
          INSERT INTO active_sessions (username, protocol, client_ip, assigned_ip, bytes_sent, bytes_recv, last_seen)
          VALUES (?, 'l2tp', ?, ?, 0, 0, CURRENT_TIMESTAMP)
        `).run('unknown', '', assignedIp);
      }
    }
  } catch {}
}

module.exports = { initServer, start, stop, restart, addUser, removeUser, getActiveConnections, monitorConnections, isInstalled: isStrongSwanInstalled };
