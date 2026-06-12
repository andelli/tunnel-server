require('dotenv').config();
const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const { getDb, closeDb } = require('./db/database');
const logger = require('./utils/logger');
const { requireAuth, csrfProtect, csrfToken } = require('./middlewares/auth');
const network = require('./utils/network');
const monitor = require('./services/monitor');

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
});
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`, { stack: err.stack });
});

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');
app.use(expressLayouts);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// Session
const sessionConfig = {
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 },
};

try {
  const SQLiteStore = require('better-sqlite3-session-store')(session);
  const db = getDb();
  sessionConfig.store = new SQLiteStore({
    client: db,
    expired: { clear: true, intervalMs: 900000 },
  });
} catch {
  logger.warn('SQLite session store not available, using memory store');
}

app.use(session(sessionConfig));
app.use(csrfToken);

// Routes
app.use('/', require('./routes/auth'));
app.use('/', requireAuth, require('./routes/dashboard'));
app.use('/users', requireAuth, require('./routes/users'));
app.use('/configs', requireAuth, csrfProtect, require('./routes/configs'));
app.use('/sessions', requireAuth, require('./routes/sessions'));
app.use('/logs', requireAuth, require('./routes/logs'));

app.use((req, res) => {
  res.status(404).render('login', { layout: false, error: 'Page not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Express error: ${err.message}`, { stack: err.stack });
  res.status(500).send('Internal Server Error');
});

async function init() {
  logger.info('=== WireGuard Tunnel Dashboard ===');
  logger.info(`Node.js v${process.version}`);

  getDb();
  logger.info('Database initialized');

  try {
    network.enableIpForward();
    network.setupNAT();
    logger.info('Network forwarding & NAT configured');
  } catch (e) {
    logger.warn(`Network setup: ${e.message}`);
  }

  monitor.cleanupStaleSessions();
  monitor.startMonitoring(15000);

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Dashboard: http://0.0.0.0:${config.port}`);
    logger.info(`Login: ${config.admin.username} / ${config.admin.password}`);
  });
}

process.on('SIGINT', () => { logger.info('Shutting down...'); monitor.stopMonitoring(); closeDb(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('Shutting down...'); monitor.stopMonitoring(); closeDb(); process.exit(0); });

init().catch(err => {
  logger.error(`Init failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});

module.exports = app;
