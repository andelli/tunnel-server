#!/usr/bin/env node
// Generate OpenVPN server.conf from database settings
// Called by systemd ExecStartPre

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getDb } = require('../db/database');

const OVPN_CONFIG_DIR = path.join(config.paths.configs, 'openvpn');
const OVPN_SERVER_DIR = path.join(OVPN_CONFIG_DIR, 'server');
const OVPN_CCD_DIR = path.join(OVPN_CONFIG_DIR, 'ccd');

[OVPN_CONFIG_DIR, OVPN_SERVER_DIR, OVPN_CCD_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const db = getDb();
const port = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_port'").get()?.value || '1194';
const proto = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_proto'").get()?.value || 'udp';
const subnet = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_subnet'").get()?.value || '10.0.1.0/24';
const dns = db.prepare("SELECT value FROM server_settings WHERE key = 'dns_servers'").get()?.value || '8.8.8.8';
const dnsArr = dns.split(',').map(s => s.trim());

const svrIp = subnet.split('/')[0].replace(/\.\d+$/, '.0');
const svrMask = '255.255.255.0';

const caPath = path.join(OVPN_SERVER_DIR, 'ca.crt');
const certPath = path.join(OVPN_SERVER_DIR, 'server.crt');
const keyPath = path.join(OVPN_SERVER_DIR, 'server.key');
const dhPath = path.join(OVPN_SERVER_DIR, 'dh.pem');

// If EasyRSA certs exist, copy them
const pkiDir = path.join(config.paths.root, 'easy-rsa', 'pki');
if (!fs.existsSync(caPath) && fs.existsSync(path.join(pkiDir, 'ca.crt'))) {
  ['ca.crt', 'issued/server.crt', 'private/server.key', 'dh.pem'].forEach(f => {
    const src = path.join(pkiDir, f.replace('issued/', '').replace('private/', ''));
    const dest = path.join(OVPN_SERVER_DIR, f.replace('issued/', '').replace('private/', ''));
    if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
  });
}

const conf = `port ${port}
proto ${proto}
dev tun
ca ${caPath}
cert ${certPath}
key ${keyPath}
dh ${dhPath}
server ${svrIp} ${svrMask}
ifconfig-pool-persist ${OVPN_CONFIG_DIR}/ipp.txt
client-config-dir ${OVPN_CCD_DIR}
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS ${dnsArr[0]}"
push "dhcp-option DNS ${dnsArr[1] || dnsArr[0]}"
client-to-client
keepalive 10 120
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun
status ${OVPN_CONFIG_DIR}/status.log 5
log-append ${OVPN_CONFIG_DIR}/openvpn.log
verb 3
explicit-exit-notify 1
`;

fs.writeFileSync(path.join(OVPN_CONFIG_DIR, 'server.conf'), conf);
console.log(`[gen-openvpn-config] server.conf written (${port}/${proto}, ${subnet})`);
process.exit(0);
