const config = require('../config');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session.role !== role && req.session.role !== 'superadmin') {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

function csrfProtect(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const token = req.headers['x-csrf-token'] || req.body?._csrf;
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'CSRF token mismatch' });
    }
  }
  next();
}

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.session = req.session;
  next();
}

module.exports = { requireAuth, requireRole, csrfProtect, csrfToken };
