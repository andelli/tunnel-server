#!/usr/bin/env node
// Generate L2TP/IPsec config files from database settings
// Called by systemd ExecStartPre

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { getDb } = require('../db/database');

const L2TP_DIR = path.join(config.paths.configs, 'l2tp');
if (!fs.existsSync(L2TP_DIR)) fs.mkdirSync(L2TP_DIR, { recursive: true });

const db = getDb();
const psk = db.prepare("SELECT value FROM server_settings WHERE key = 'l2tp_ipsec_psk'").get()?.value || config.vpn.l2tp.ipsecPsk;
const dns = db.prepare("SELECT value FROM server_settings WHERE key = 'dns_servers'").get()?.value || '8.8.8.8';
const dnsArr = dns.split(',').map(s => s.trim());

// ipsec.conf
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
fs.writeFileSync(path.join(L2TP_DIR, 'ipsec.conf'), ipsecConf);

// ipsec.secrets
fs.writeFileSync(path.join(L2TP_DIR, 'ipsec.secrets'), `%any  %any : PSK "${psk}"\n`);

// Symlink to /etc/ipsec.d/
if (fs.existsSync('/etc/ipsec.d')) {
  try { fs.unlinkSync('/etc/ipsec.d/l2tp.conf'); } catch {}
  try { fs.unlinkSync('/etc/ipsec.d/l2tp.secrets'); } catch {}
  fs.copyFileSync(path.join(L2TP_DIR, 'ipsec.conf'), '/etc/ipsec.d/l2tp.conf');
  fs.copyFileSync(path.join(L2TP_DIR, 'ipsec.secrets'), '/etc/ipsec.d/l2tp.secrets');
}

// xl2tpd.conf
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
pppoptfile = ${L2TP_DIR}/options.xl2tpd
length bit = yes
`;
fs.writeFileSync(path.join(L2TP_DIR, 'xl2tpd.conf'), xl2tpdConf);

// options.xl2tpd
const options = `ipcp-accept-local
ipcp-accept-remote
ms-dns ${dnsArr[0]}
ms-dns ${dnsArr[1] || dnsArr[0]}
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
fs.writeFileSync(path.join(L2TP_DIR, 'options.xl2tpd'), options);

// chap-secrets from DB
const users = db.prepare('SELECT username, password FROM vpn_users WHERE enabled = 1 AND l2tp_enabled = 1').all();
let chap = '# username\tserver\tpassword\tip\n';
for (const u of users) {
  if (u.password) chap += `${u.username}\t*\t${u.password}\t*\n`;
}
fs.writeFileSync(path.join(L2TP_DIR, 'chap-secrets'), chap);

console.log(`[gen-l2tp-config] Config files written, PSK: ${psk}`);
process.exit(0);
