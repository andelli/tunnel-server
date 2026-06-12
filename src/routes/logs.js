const express = require('express');
const { getDb } = require('../db/database');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();

// Log viewer
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const category = req.query.category || '';

  let query = 'SELECT * FROM event_log';
  let countQuery = 'SELECT COUNT(*) as count FROM event_log';
  const params = [];

  if (category) {
    query += ' WHERE category = ?';
    countQuery += ' WHERE category = ?';
    params.push(category);
  }

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(query).all(...params);
  const totalLogs = db.prepare(countQuery).all(...(category ? [category] : []))[0].count;
  const totalPages = Math.ceil(totalLogs / limit);

  // Also read file log for full content
  let fileLogs = [];
  try {
    const logFile = path.join(config.paths.logs, 'tunnel.log');
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      fileLogs = content.split('\n').filter(Boolean).reverse().slice(0, 30);
    }
  } catch {}

  res.render('logs', { logs, fileLogs, page, totalPages, totalLogs, category });
});

// API recent logs
router.get('/api/recent', (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM event_log ORDER BY id DESC LIMIT 20
  `).all();
  res.json(logs);
});

// API: add log entry (for services to call)
router.post('/api', (req, res) => {
  const { level, category, message, details } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const db = getDb();
  db.prepare(`
    INSERT INTO event_log (level, category, message, details)
    VALUES (?, ?, ?, ?)
  `).run(level || 'info', category || 'system', message, details ? JSON.stringify(details) : null);

  res.json({ success: true });
});

module.exports = router;
