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

  // Recent VPN events dari DB
  const active = db.prepare(`
    SELECT username, 'connect' as event, assigned_ip, connected_at as time
    FROM active_sessions ORDER BY connected_at DESC LIMIT 5
  `).all();
  const completed = db.prepare(`
    SELECT username, 'disconnect' as event, assigned_ip, disconnected_at as time
    FROM sessions_log ORDER BY disconnected_at DESC LIMIT 5
  `).all();

  const merged = [...active, ...completed]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 10)
    .map(e => ({
      message: `${e.username} ${e.event === 'connect' ? 'terkoneksi' : 'terputus'} (${e.assigned_ip || ''})`,
      level: e.event === 'connect' ? 'info' : 'warn',
      timestamp: e.time,
      category: 'vpn',
    }));

  res.render('dashboard', {
    stats: { totalUsers, activeUsers, enabledUsers, ...bwStats, ...totalBw },
    protocols,
    recentEvents: merged,
  });
});

router.get('/api/stats', (req, res) => {
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users').get().count;
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM active_sessions').get().count;
  const enabledUsers = db.prepare('SELECT COUNT(*) as count FROM vpn_users WHERE enabled = 1').get().count;
  const bwStats = db.prepare('SELECT COALESCE(SUM(bytes_sent), 0) as total_sent, COALESCE(SUM(bytes_recv), 0) as total_recv FROM active_sessions').get();
  const protocols = db.prepare('SELECT protocol, COUNT(*) as count FROM active_sessions GROUP BY protocol').all();

  res.json({ totalUsers, activeUsers, enabledUsers, ...bwStats, protocols });
});

module.exports = router;
