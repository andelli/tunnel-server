const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const { generateWireGuardKeyPair, generatePresharedKey, getNextIp, generatePassword } = require('../utils/crypto');
const wgService = require('../services/wireguard');

const router = express.Router();

// List users
router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM vpn_users ORDER BY created_at DESC').all();

  const activeCounts = db.prepare(`
    SELECT username, COUNT(*) as count FROM active_sessions GROUP BY username
  `).all();
  const activeMap = {};
  activeCounts.forEach(a => { activeMap[a.username] = a.count; });

  users.forEach(u => { u.activeCount = activeMap[u.username] || 0; });

  res.render('users', { users });
});

// New user form
router.get('/new', (req, res) => {
  res.render('user-form', { user: null, error: null });
});

// Create user
router.post('/', (req, res) => {
  const { username, password, notes } = req.body;
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
    INSERT INTO vpn_users (username, password, notes, wg_private_key, wg_public_key, wg_preshared_key, wg_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, userPassword, notes || null, wgKeys.privateKey, wgKeys.publicKey, wgPsk, wgIp);

  logger.info(`VPN user created: ${username}`, { id: result.lastInsertRowid, ip: wgIp });

  try {
    wgService.addPeer(username, wgKeys.publicKey, wgPsk, wgIp);
  } catch (e) {
    logger.error(`Failed to add WireGuard peer ${username}: ${e.message}`);
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

  const { password, notes, enabled } = req.body;

  db.prepare(`
    UPDATE vpn_users SET password = COALESCE(NULLIF(?, ''), password),
      notes = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(password || null, notes || null, enabled !== '0' ? 1 : 0, req.params.id);

  try {
    if (enabled !== '0') {
      wgService.addPeer(user.username, user.wg_public_key, user.wg_preshared_key, user.wg_address);
    } else {
      wgService.removePeer(user.username, user.wg_public_key);
    }
  } catch (e) {
    logger.error(`Failed to update WireGuard peer ${user.username}: ${e.message}`);
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
    if (newStatus) wgService.addPeer(user.username, user.wg_public_key, user.wg_preshared_key, user.wg_address);
    else wgService.removePeer(user.username, user.wg_public_key);
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

  res.setHeader('Content-Type', 'application/x-wireguard-config');
  res.setHeader('Content-Disposition', `attachment; filename="${user.username}.conf"`);
  res.send(config);
});

// QR Code for WireGuard
router.get('/:id/qr', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM vpn_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).send('User not found');

  const svrPubKey = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_server_public_key'").get()?.value || '';
  const svrAddress = db.prepare("SELECT value FROM server_settings WHERE key = 'server_public_ip'").get()?.value || req.hostname;
  const wgPort = db.prepare("SELECT value FROM server_settings WHERE key = 'wg_port'").get()?.value || '51820';
  const dns = db.prepare("SELECT value FROM server_settings WHERE key = 'dns_servers'").get()?.value || '8.8.8.8';

  const wgConfig = `[Interface]
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
  const qrDataUrl = await QRCode.toDataURL(wgConfig, { width: 400, margin: 2 });

  res.send(`<!DOCTYPE html><html><head><title>WireGuard QR - ${user.username}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;
background:#0f0f1a;font-family:sans-serif;flex-direction:column;gap:20px}
h2{color:#e0e0e0;margin:0}img{border-radius:12px;box-shadow:0 0 40px rgba(0,0,0,0.5)}
p{color:#8899aa;font-size:0.85rem}
</style></head><body>
<h2>${user.username}</h2>
<img src="${qrDataUrl}" alt="WireGuard QR"/>
<p>Scan with WireGuard mobile app</p>
</body></html>`);
});

module.exports = router;
