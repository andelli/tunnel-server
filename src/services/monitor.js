const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const wgService = require('./wireguard');
const ovpnService = require('./openvpn');
const l2tpService = require('./l2tp');

let monitorInterval = null;

function startMonitoring(intervalMs = 10000) {
  logger.info(`Session monitor started (interval: ${intervalMs}ms)`);

  // Initial load
  monitorTick();

  monitorInterval = setInterval(monitorTick, intervalMs);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('Session monitor stopped');
  }
}

function monitorTick() {
  try {
    if (wgService.isInstalled()) wgService.monitorPeers();
    if (ovpnService.isInstalled()) ovpnService.monitorClients();
    if (l2tpService.isInstalled()) l2tpService.monitorConnections();
  } catch (e) {
    logger.error(`Monitor tick error: ${e.message}`);
  }
}

// Cleanup stale sessions on startup
function cleanupStaleSessions() {
  const db = getDb();
  const stale = db.prepare(`
    SELECT * FROM active_sessions
    WHERE last_seen < datetime('now', '-5 minutes')
  `).all();

  for (const session of stale) {
    db.prepare(`
      INSERT INTO sessions_log (username, protocol, client_ip, assigned_ip, connected_at, disconnected_at, bytes_sent, bytes_recv, disconnect_reason)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'stale-cleanup')
    `).run(session.username, session.protocol, session.client_ip, session.assigned_ip, session.connected_at, session.bytes_sent, session.bytes_recv);

    db.prepare('DELETE FROM active_sessions WHERE id = ?').run(session.id);
    logger.info(`Stale session cleaned: ${session.username} (${session.protocol})`);
  }
}

module.exports = { startMonitoring, stopMonitoring, cleanupStaleSessions };
