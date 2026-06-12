require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const { getDb, closeDb } = require('./db/database');
const logger = require('./utils/logger');
const { requireAuth, csrfProtect, csrfToken } = require('./middlewares/auth');
const network = require('./utils/network');
const wgService = require('./services/wireguard');
const ovpnService = require('./services/openvpn');
const l2tpService = require('./services/l2tp');
const monitor = require('./services/monitor');

// Log all uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`, { stack: err.stack });
});

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');
app.use(expressLayouts);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// HTTP request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim()),
    log: logger.info.bind(logger),
  },
}));

// Session
const sessionConfig = {
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
};

// Use SQLite-backed session store if better-sqlite3-session-store is available
try {
  const SQLiteStore = require('better-sqlite3-session-store')(session);
  sessionConfig.store = new SQLiteStore({
    client: getDb(),
    expired: {
      clear: true,
      intervalMs: 900000, // 15 min cleanup
    },
  });
} catch {
  // Fallback to memory store (session will reset on restart)
  logger.warn('SQLite session store not available, using memory store');
}

app.use(session(sessionConfig));

// CSRF token for all views
app.use(csrfToken);

// Rate limiter for login
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const usersRoutes = require('./routes/users');
const configsRoutes = require('./routes/configs');
const sessionsRoutes = require('./routes/sessions');
const logsRoutes = require('./routes/logs');

app.use('/', loginLimiter, authRoutes);
app.use('/', requireAuth, dashboardRoutes);
app.use('/users', requireAuth, usersRoutes);
app.use('/configs', requireAuth, csrfProtect, configsRoutes);
app.use('/sessions', requireAuth, sessionsRoutes);
app.use('/logs', requireAuth, logsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('login', { error: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Express error: ${err.message}`, { stack: err.stack });
  res.status(500).send('Internal Server Error');
});

// Initialize everything
async function init() {
  logger.info('=== Tunnel VPN Gateway Server ===');
  logger.info(`Node.js version: ${process.version}`);

  // Initialize database
  getDb();
  logger.info('Database initialized');

  // Enable IP forwarding
  try {
    network.enableIpForward();
    logger.info('IP forwarding enabled');
  } catch (e) {
    logger.warn(`Could not enable IP forwarding: ${e.message}`);
  }

  // Setup NAT
  try {
    network.setupNAT();
    logger.info('NAT rules configured');
  } catch (e) {
    logger.warn(`Could not setup NAT: ${e.message}`);
  }

  // Initialize VPN services
  if (wgService.isInstalled()) {
    wgService.initServer();
    wgService.start();
  } else {
    logger.warn('WireGuard not installed. Run install.sh to set up.');
  }

  if (ovpnService.isInstalled()) {
    ovpnService.initServer();
    ovpnService.start();
  } else {
    logger.warn('OpenVPN not installed. Run install.sh to set up.');
  }

  if (l2tpService.isInstalled()) {
    l2tpService.initServer();
    l2tpService.start();
  } else {
    logger.warn('L2TP/IPsec not installed. Run install.sh to set up.');
  }

  // Clean stale sessions on startup
  monitor.cleanupStaleSessions();

  // Start session monitoring
  monitor.startMonitoring(15000);

  // Start server
  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Dashboard: http://0.0.0.0:${config.port}`);
    logger.info(`Login: ${config.admin.username} / ${config.admin.password}`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  monitor.stopMonitoring();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  monitor.stopMonitoring();
  closeDb();
  process.exit(0);
});

init().catch(err => {
  logger.error(`Init failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});

module.exports = app;
