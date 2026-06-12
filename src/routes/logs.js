const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM sessions_log';
  let countQuery = 'SELECT COUNT(*) as count FROM sessions_log';

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';

  const logs = db.prepare(query).all(limit, offset);
  const totalLogs = db.prepare(countQuery).get().count;
  const totalPages = Math.ceil(totalLogs / limit) || 1;

  res.render('logs', { logs, page, totalPages, totalLogs });
});

module.exports = router;
