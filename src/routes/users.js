const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const { generateWireGuardKeyPair, generatePresharedKey, getNextIp, generatePassword } = require('../utils/crypto');
const wgService = require('../services/wireguard');
const ovpnService = require('../services/openvpn');
const l2tpService = require('../services/l2tp');

const router = express.Router();

// List users
router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM vpn_users ORDER BY created_at DESC').all();

  // Get active session counts per user
  const activeCounts = db.prepare(`
    SELECT username, COUNT(*) as count, GROUP_CONCAT(protocol) as protocols
    FROM active_sessions GROUP BY username
  `).all();
  const activeMap = {};
  activeCounts.forEach(a => { activeMap[a.username] = a; });

  users.forEach(u => {
    u.activeCount = activeMap[u.username]?.count || 0;
    u.activeProtocols = activeMap[u.username]?.protocols || '';
  });

  res.render('users', { users });
});

// New user form
router.get('/new', (req, res) => {
  res.render('user-form', { user: null, error: null });
});

// Create user
router.post('/', async (req, res) => {
  const { username, password, notes, wg_enabled, ovpn_enabled, l2tp_enabled } = req.body;
  if (!username) {
    return res.render('user-form', { user: null, error: 'Username is required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM vpn_users WHERE username = ?').get(username);
  if (existing) {
    return res.render('user-form', { user: null, error: 'Username already exists' });
  }

  const userPassword = password || generatePassword();
  const usedIps = db.prepare("SELECT wg_address FROM vpn_users WHERE wg_address IS NOT NULL").all().map(r => r.wg_address);
  const wgSubnet = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_subnet'").get()?.value || '10.0.0.0/24';
  const wgIp = getNextIp(wgSubnet, usedIps);

  const wgKeys = generateWireGuardKeyPair();
  const wgPsk = generatePresharedKey();

  const result = db.prepare(`
    INSERT INTO vpn_users (username, password, notes, wg_enabled, ovpn_enabled, l2tp_enabled,
      wg_private_key, wg_public_key, wg_preshared_key, wg_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    username, userPassword, notes || null,
    wg_enabled !== undefined ? 1 : 1,
    ovpn_enabled !== undefined ? 1 : 1,
    l2tp_enabled !== undefined ? 1 : 1,
    wgKeys.privateKey, wgKeys.publicKey, wgPsk, wgIp
  );

  logger.info(`VPN user created: ${username}`, { id: result.lastInsertRowid, ip: wgIp });

  // Apply to VPN services
  try {
    if (wg_enabled !== '0') wgService.addPeer(username, wgKeys.publicKey, wgPsk, wgIp);
    if (ovpn_enabled !== '0') ovpnService.addClient(username, wgIp);
    if (l2tp_enabled !== '0') l2tpService.addUser(username, userPassword);
  } catch (e) {
    logger.error(`Failed to apply services for ${username}: ${e.message}`);
  }

  res.redirect('/users');
});

// Edit user form
router.get('/:id/edit', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('User not found');
  res.render('user-form', { user, error: null });
});

// Update user
router.post('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('User not found');

  const { password, notes, enabled, wg_enabled, ovpn_enabled, l2tp_enabled } = req.body;
  let updates = [];
  let params = [];

  if (password) {
    updates.push('password = ?');
    params.push(password);
  }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  updates.push('enabled = ?'); params.push(enabled !== undefined ? (enabled === '0' ? 0 : 1) : 1);
  updates.push('wg_enabled = ?'); params.push(wg_enabled !== undefined ? (wg_enabled === '0' ? 0 : 1) : 1);
  updates.push('ovpn_enabled = ?'); params.push(ovpn_enabled !== undefined ? (ovpn_enabled === '0' ? 0 : 1) : 1);
  updates.push('l2tp_enabled = ?'); params.push(l2tp_enabled !== undefined ? (l2tp_enabled === '0' ? 0 : 1) : 1);
  updates.push('updated_at = CURRENT_TIMESTAMP');

  params.push(req.params.id);

  db.prepare(`UPDATE vpn_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  // Re-apply VPN service configs
  try {
    if (wg_enabled !== '0') wgService.addPeer(user.username, user.wg_public_key, user.wg_preshared_key, user.wg_address);
    else wgService.removePeer(user.username, user.wg_public_key);

    if (l2tp_enabled !== '0') l2tpService.addUser(user.username, password || user.password);
    else l2tpService.removeUser(user.username);
  } catch (e) {
    logger.error(`Failed to update services for ${user.username}: ${e.message}`);
  }

  logger.info(`VPN user updated: ${user.username}`);
  res.redirect('/users');
});

// Toggle enable/disable
router.post('/:id/toggle', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newStatus = user.enabled ? 0 : 1;
  db.prepare('UPDATE vpn_users SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, req.params.id);

  try {
    if (newStatus) {
      if (user.wg_enabled) wgService.addPeer(user.username, user.wg_public_key, user.wg_preshared_key, user.wg_address);
    } else {
      if (user.wg_public_key) wgService.removePeer(user.username, user.wg_public_key);
    }
  } catch (e) {
    logger.error(`Toggle failed for ${user.username}: ${e.message}`);
  }

  logger.info(`User ${user.username} ${newStatus ? 'enabled' : 'disabled'}`);
  res.redirect('/users');
});

// Delete user
router.post('/:id/delete', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    if (user.wg_public_key) wgService.removePeer(user.username, user.wg_public_key);
    if (user.ovpn_enabled) ovpnService.removeClient(user.username);
    if (user.l2tp_enabled) l2tpService.removeUser(user.username);
  } catch (e) {
    logger.error(`Cleanup failed for ${user.username}: ${e.message}`);
  }

  db.prepare('DELETE FROM vpn_users WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM active_sessions WHERE username = ?').run(user.username);

  logger.info(`VPN user deleted: ${user.username}`);
  res.redirect('/users');
});

// Download config
router.get('/:id/config', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('User not found');

  const protocol = req.query.protocol || 'wireguard';
  const svrPubKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_public_key'").get()?.value || '';
  const svrAddress = db.prepare("SELECT value FROM server_settings WHERE key = 'server_public_ip'").get()?.value || req.hostname;
  const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
  const dns = db.prepare("SELECT value FROM server_settings WHERE key = 'dns_servers'").get()?.value || '8.8.8.8';

  if (protocol === 'wireguard') {
    const config = `[Interface]
PrivateKey = ${user.wg_private_key}
Address = ${user.wg_address}/32
DNS = ${dns}

[Peer]
PublicKey = ${svrPubKey}
PresharedKey = ${user.wg_preshared_key}
Endpoint = ${svrAddress}:${wgPort}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;
    res.setHeader('Content-Type', 'application/x-wireguard-config');
    res.setHeader('Content-Disposition', `attachment; filename="${user.username}.conf"`);
    return res.send(config);
  }

  if (protocol === 'openvpn') {
    const caCert = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_ca_cert'").get()?.value || '';
    const ovpnPort = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_port'").get()?.value || '1194';
    const ovpnProto = db.prepare("SELECT value FROM server_settings WHERE key = 'ovpn_proto'").get()?.value || 'udp';
    const config = `client
dev tun
proto ${ovpnProto}
remote ${svrAddress} ${ovpnPort}
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
auth SHA256
verb 3
<ca>
${caCert}
</ca>
<cert>
${user.ovpn_cert_serial || ''}
</cert>
<key>
${user.ovpn_cert_serial || ''}
</key>
`;
    res.setHeader('Content-Type', 'application/x-openvpn-config');
    res.setHeader('Content-Disposition', `attachment; filename="${user.username}.ovpn"`);
    return res.send(config);
  }

  res.status(400).send('Unsupported protocol');
});

// Generate QR code for WireGuard
router.get('/:id/qr', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('User not found');

  const svrPubKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_public_key'").get()?.value || '';
  const svrAddress = db.prepare("SELECT value FROM server_settings WHERE key = 'server_public_ip'").get()?.value || req.hostname;
  const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
  const dns = db.prepare("SELECT value FROM server_settings WHERE key = 'dns_servers'").get()?.value || '8.8.8.8';

  const config = `[Interface]
PrivateKey = ${user.wg_private_key}
Address = ${user.wg_address}/32
DNS = ${dns}

[Peer]
PublicKey = ${svrPubKey}
PresharedKey = ${user.wg_preshared_key}
Endpoint = ${svrAddress}:${wgPort}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

  const QRCode = require('qrcode');
  const qrDataUrl = await QRCode.toDataURL(config, { width: 400, margin: 2 });
  res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e">
    <img src="${qrDataUrl}" style="border-radius:12px;box-shadow:0 0 40px rgba(0,0,0,0.5)"/>
  </body></html>`);
});

module.exports = router;
