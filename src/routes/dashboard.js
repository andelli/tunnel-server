const express = require('express');
const fs = require('fs');
const path = require('path');
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

  // Read recent events from log file
  const logFile = path.join(__dirname, '../../data/logs/tunnel.log');
  let recentEvents = [];
  try {
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      recentEvents = content.split('\n').filter(Boolean).reverse().slice(0, 10).map(line => {
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.+)/);
        if (match) return { timestamp: match[1], level: match[2].toLowerCase(), category: '-', message: match[3] };
        return { timestamp: '', level: 'info', category: '-', message: line };
      });
    }
  } catch {}

  res.render('dashboard', { stats: { totalUsers, activeUsers, enabledUsers, ...bwStats, ...totalBw }, protocols, recentEvents });
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
