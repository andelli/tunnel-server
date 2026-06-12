#!/usr/bin/env node
// Generate /etc/wireguard/wg0.conf from database
// Falls back to generating server keys if dashboard hasn't done so

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getDb } = require('../db/database');
const network = require('../utils/network');

const WG_DIR = '/etc/wireguard';
if (!fs.existsSync(WG_DIR)) fs.mkdirSync(WG_DIR, { recursive: true });

const db = getDb();

// Ensure server keys exist in DB
let svrPrivKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_private_key'").get()?.value;
if (!svrPrivKey) {
  const privKey = execSync('wg genkey', { encoding: 'utf8' }).trim();
  const pubKey = execSync(`echo "${privKey}" | wg pubkey`, { encoding: 'utf8' }).trim();
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_server_private_key', ?)").run(privKey);
  db.prepare("INSERT OR REPLACE INTO server_settings (key, value) VALUES ('wg_server_public_key', ?)").run(pubKey);
  svrPrivKey = privKey;
  // Also save settings defaults
  db.prepare("INSERT OR IGNORE INTO server_settings (key, value) VALUES ('wg_port', '51820')").run();
  db.prepare("INSERT OR IGNORE INTO server_settings (key, value) VALUES ('wg_subnet', '10.0.0.0/24')").run();
  db.prepare("INSERT OR IGNORE INTO server_settings (key, value) VALUES ('dns_servers', '8.8.8.8, 8.8.4.4')").run();
  console.log('[gen-wg] Server keys auto-generated');
}

const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
const wgSubnet = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_subnet'").get()?.value || '10.0.0.0/24';
const mainIface = network.getMainInterface();
const svrIp = wgSubnet.split('/')[0].replace(/\.\d+$/, '.1') + '/' + wgSubnet.split('/')[1];

let conf = `[Interface]
Address = ${svrIp}
PrivateKey = ${svrPrivKey}
ListenPort = ${wgPort}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${mainIface} -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${mainIface} -j MASQUERADE
`;

const users = db.prepare('SELECT * FROM vpn_users WHERE enabled = 1').all();
for (const u of users) {
  if (u.wg_public_key && u.wg_address) {
    conf += `\n# ${u.username}\n[Peer]\nPublicKey = ${u.wg_public_key}\nPresharedKey = ${u.wg_preshared_key}\nAllowedIPs = ${u.wg_address}/32\n`;
  }
}

fs.writeFileSync(path.join(WG_DIR, 'wg0.conf'), conf);
console.log(`[gen-wg] wg0.conf written (${users.length} peers)`);
process.exit(0);
