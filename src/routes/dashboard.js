const express = require('express');
const { getDb } = require('../db/database');
const { execSync } = require('child_process');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM active_sessions').get().count;
  const enabledUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users WHERE enabled = 1').get().count;

  // Get bandwidth stats from active sessions
  const bwStats = db.prepare(`
    SELECT COALESCE(SUM(bytes_sent), 0) as total_sent,
           COALESCE(SUM(bytes_recv), 0) as total_recv
    FROM active_sessions
  `).get();

  // Get total bandwidth all time
  const totalBw = db.prepare(`
    SELECT COALESCE(SUM(bytes_sent), 0) as total_sent,
           COALESCE(SUM(bytes_recv), 0) as total_recv
    FROM sessions_log
  `).get();

  // Get protocol distribution
  const protocols = db.prepare(`
    SELECT protocol, COUNT(*) as count
    FROM active_sessions
    GROUP BY protocol
  `).all();

  // Recent events
  const recentEvents = db.prepare(`
    SELECT * FROM event_log
    ORDER BY id DESC LIMIT 10
  `).all();

  res.render('dashboard', {
    stats: { totalUsers, activeUsers, enabledUsers, ...bwStats, ...totalBw },
    protocols,
    recentEvents,
  });
});

// API endpoint for dashboard data (AJAX polling)
router.get('/api/stats', (req, res) => {
  const db = getDb();

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM active_sessions').get().count;
  const enabledUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users WHERE enabled = 1').get().count;

  const bwStats = db.prepare(`
    SELECT COALESCE(SUM(bytes_sent), 0) as total_sent,
           COALESCE(SUM(bytes_recv), 0) as total_recv
    FROM active_sessions
  `).get();

  const protocols = db.prepare(`
    SELECT protocol, COUNT(*) as count
    FROM active_sessions
    GROUP BY protocol
  `).all();

  const recentEvents = db.prepare(`
    SELECT * FROM event_log
    ORDER BY id DESC LIMIT 5
  `).all();

  res.json({ totalUsers, activeUsers, enabledUsers, ...bwStats, protocols, recentEvents });
});

module.exports = router;
