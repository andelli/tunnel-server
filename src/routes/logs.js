const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();

// Log viewer — reads directly from tunnel.log
router.get('/', (req, res) => {
  const logFile = path.join(config.paths.logs, 'tunnel.log');

  let allLines = [];
  try {
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      allLines = content.split('\n').filter(Boolean);
    }
  } catch {}

  // Reverse so newest first
  allLines.reverse();

  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  const category = req.query.category || '';
  let filtered = allLines;
  if (category) {
    filtered = allLines.filter(l => l.toLowerCase().includes(`[${category}]`.toLowerCase()) || l.toLowerCase().includes(category.toLowerCase()));
  }

  const totalLogs = filtered.length;
  const totalPages = Math.ceil(totalLogs / limit) || 1;
  const logs = filtered.slice(offset, offset + limit).map(line => {
    // Parse structured log line: "timestamp [LEVEL] message"
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.+)/);
    if (match) {
      return { timestamp: match[1], level: match[2].toLowerCase(), category: '-', message: match[3] };
    }
    return { timestamp: '', level: 'info', category: '-', message: line };
  });

  res.render('logs', { logs, page, totalPages, totalLogs, category });
});

module.exports = router;
