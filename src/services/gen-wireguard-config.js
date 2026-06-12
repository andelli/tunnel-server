#!/usr/bin/env node
// Generate WireGuard wg0.conf from database settings

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getDb } = require('../db/database');

const WG_DIR = '/etc/wireguard';
if (!fs.existsSync(WG_DIR)) fs.mkdirSync(WG_DIR, { recursive: true });

const db = getDb();
const svrPrivKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_private_key'").get()?.value;
const svrPubKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_public_key'").get()?.value;
const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
const wgSubnet = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_subnet'").get()?.value || '10.0.0.0/24';

// Get main interface
let mainIface = 'eth0';
try {
  const routes = require('child_process').execSync('ip route show default', { encoding: 'utf8' }).trim();
  const match = routes.match(/dev\s+(\S+)/);
  if (match) mainIface = match[1];
} catch {}

const svrIp = wgSubnet.split('/')[0].replace(/\.\d+$/, '.1') + '/' + wgSubnet.split('/')[1];

if (!svrPrivKey) {
  console.error('[gen-wireguard-config] Server private key not found in database. Run dashboard first.');
  process.exit(1);
}

let conf = `[Interface]
Address = ${svrIp}
PrivateKey = ${svrPrivKey}
ListenPort = ${wgPort}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${mainIface} -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${mainIface} -j MASQUERADE
`;

const users = db.prepare('SELECT * FROM vpn_users WHERE enabled = 1 AND wg_enabled = 1').all();
for (const u of users) {
  if (u.wg_public_key && u.wg_address) {
    conf += `\n# ${u.username}\n[Peer]\nPublicKey = ${u.wg_public_key}\nPresharedKey = ${u.wg_preshared_key}\nAllowedIPs = ${u.wg_address}/32\n`;
  }
}

fs.writeFileSync(path.join(WG_DIR, 'wg0.conf'), conf);
console.log(`[gen-wireguard-config] wg0.conf written (${users.length} peers)`);
process.exit(0);
