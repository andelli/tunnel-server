const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  // Session history (disconnected)
  const logs = db.prepare(`
    SELECT *, 'completed' as status FROM sessions_log
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  const totalLogs = db.prepare('SELECT COUNT(*) as count FROM sessions_log').get().count;

  // Active sessions
  const active = db.prepare(`
    SELECT id, username, client_ip, assigned_ip, connected_at as connected_at,
           NULL as disconnected_at, bytes_sent, bytes_recv, 'active' as status
    FROM active_sessions
  `).all();

  const totalPages = Math.ceil(totalLogs / limit) || 1;

  res.render('logs', { logs, active, page, totalPages, totalLogs });
});

module.exports = router;
