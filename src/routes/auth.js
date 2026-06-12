const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { layout: false, error: 'Username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) {
    logger.warn(`Login failed: user ${username} not found`);
    return res.render('login', { error: 'Invalid credentials' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    logger.warn(`Login failed: wrong password for ${username}`);
    return res.render('login', { error: 'Invalid credentials' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');

  logger.info(`Admin ${username} logged in`);
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  const username = req.session?.username;
  req.session.destroy(() => {
    if (username) logger.info(`Admin ${username} logged out`);
    res.redirect('/login');
  });
});

module.exports = router;
