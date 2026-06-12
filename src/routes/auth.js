const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { layout: false, error: 'Username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) {
    logger.warn(`Login failed: user ${username} not found`);
    return res.render('login', { layout: false, error: 'Invalid credentials' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    logger.warn(`Login failed: wrong password for ${username}`);
    return res.render('login', { layout: false, error: 'Invalid credentials' });
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

// Change password
router.get('/change-password', (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');
  res.render('change-password', { error: null, success: null });
});

router.post('/change-password', (req, res) => {
  if (!req.session?.userId) return res.redirect('/login');

  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.render('change-password', { error: 'All fields required', success: null });
  }
  if (new_password.length < 6) {
    return res.render('change-password', { error: 'Password minimal 6 karakter', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('change-password', { error: 'Password baru tidak cocok', success: null });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(current_password, user.password)) {
    return res.render('change-password', { error: 'Password saat ini salah', success: null });
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE admin_users SET password = ? WHERE id = ?').run(hash, req.session.userId);

  logger.info(`Admin ${req.session.username} changed password`);
  res.render('change-password', { error: null, success: 'Password berhasil diubah!' });
});

module.exports = router;
