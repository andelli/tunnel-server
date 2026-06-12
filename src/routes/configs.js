const express = require('express');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

// Server config page
router.get('/', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM server_settings').all();
  const config = {};
  settings.forEach(s => { config[s.key] = s.value; });
  res.render('configs', { config });
});

// Update settings
router.post('/', (req, res) => {
  const db = getDb();
  const allowed = [
    'server_public_ip', 'wg_port', 'wg_subnet', 'dns_servers',
    'ovpn_port', 'ovpn_proto', 'ovpn_subnet',
    'l2tp_ipsec_psk', 'l2tp_subnet',
  ];

  const upsert = db.prepare(`
    INSERT INTO server_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const transaction = db.transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      if (allowed.includes(key)) {
        upsert.run(key, String(value));
      }
    }
  });

  transaction(req.body);

  logger.info('Server settings updated');
  res.redirect('/configs');
});

// Restart VPN service
router.post('/restart/:protocol', (req, res) => {
  const { protocol } = req.params;
  try {
    if (protocol === 'wireguard') {
      require('../services/wireguard').restart();
    } else if (protocol === 'openvpn') {
      require('../services/openvpn').restart();
    } else if (protocol === 'l2tp') {
      require('../services/l2tp').restart();
    }
    logger.info(`Service restarted: ${protocol}`);
    res.json({ success: true, message: `${protocol} restarted` });
  } catch (e) {
    logger.error(`Failed to restart ${protocol}: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
