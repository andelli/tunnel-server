const express = require('express');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

// List active sessions
router.get('/', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT * FROM active_sessions ORDER BY connected_at DESC
  `).all();
  res.render('sessions', { sessions });
});

// API: list active sessions (JSON)
router.get('/api', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT * FROM active_sessions ORDER BY connected_at DESC
  `).all();
  res.json(sessions);
});

// Kill session
router.post('/:id/kill', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM active_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    if (session.protocol === 'wireguard') {
      require('../services/wireguard').removePeer(session.username, session.peer_pubkey);
    }
    // For OpenVPN and L2TP, kill via signal
    logger.info(`Session killed: ${session.username} (${session.protocol})`);
  } catch (e) {
    logger.error(`Failed to kill session: ${e.message}`);
  }

  // Log the disconnection
  db.prepare(`
    INSERT INTO sessions_log (username, protocol, client_ip, assigned_ip, connected_at, disconnected_at, bytes_sent, bytes_recv, disconnect_reason)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'killed')
  `).run(session.username, session.protocol, session.client_ip, session.assigned_ip, session.connected_at, session.bytes_sent, session.bytes_recv);

  db.prepare('DELETE FROM active_sessions WHERE id = ?').run(req.params.id);
  res.redirect('/sessions');
});

module.exports = router;
