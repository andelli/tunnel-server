const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM active_sessions').get().count;
  const enabledUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users WHERE enabled = 1').get().count;

  const bwStats = db.prepare(`
    SELECT COALESCE(SUM(bytes_sent), 0) as total_sent, COALESCE(SUM(bytes_recv), 0) as total_recv
    FROM active_sessions
  `).get();

  const totalBw = db.prepare(`
    SELECT COALESCE(SUM(bytes_sent), 0) as total_sent_all, COALESCE(SUM(bytes_recv), 0) as total_recv_all
    FROM sessions_log
  `).get();

  const protocols = db.prepare(`
    SELECT protocol, COUNT(*) as count FROM active_sessions GROUP BY protocol
  `).all();

  const recentEvents = db.prepare(`
    SELECT * FROM event_log ORDER BY id DESC LIMIT 10
  `).all();

  res.render('dashboard', { stats: { totalUsers, activeUsers, enabledUsers, ...bwStats, ...totalBw }, protocols, recentEvents });
});

router.get('/api/stats', (req, res) => {
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM active_sessions').get().count;
  const enabledUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users WHERE enabled = 1').get().count;
  const bwStats = db.prepare('SELECT COALESCE(SUM(bytes_sent), 0) as total_sent, COALESCE(SUM(bytes_recv), 0) as total_recv FROM active_sessions').get();
  const protocols = db.prepare('SELECT protocol, COUNT(*) as count FROM active_sessions GROUP BY protocol').all();
  const recentEvents = db.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 5').all();

  res.json({ totalUsers, activeUsers, enabledUsers, ...bwStats, protocols, recentEvents });
});

module.exports = router;
