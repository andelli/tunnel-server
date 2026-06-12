require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000'),
  sessionSecret: process.env.SESSION_SECRET || 'tunnel-server-secret',
  nodeEnv: process.env.NODE_ENV || 'production',

  paths: {
    root: path.resolve(__dirname, '..'),
    db: path.resolve(__dirname, '..', process.env.DB_PATH || 'data/tunnel.db'),
    logs: path.resolve(__dirname, '..', process.env.LOG_DIR || 'data/logs'),
    configs: path.resolve(__dirname, '..', process.env.CONFIG_DIR || 'configs'),
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  vpn: {
    publicIp: process.env.SERVER_PUBLIC_IP || '',
    dns: (process.env.DNS_SERVERS || '8.8.8.8,8.8.4.4').split(',').map(s => s.trim()),
    wireguard: {
      port: parseInt(process.env.WG_PORT || '51820'),
      subnet: process.env.WG_SUBNET || '10.0.0.0/24',
      interface: 'wg0',
    },
    openvpn: {
      port: parseInt(process.env.OVPN_PORT || '1194'),
      subnet: process.env.OVPN_SUBNET || '10.0.1.0/24',
      proto: process.env.OVPN_PROTO || 'udp',
      managementPort: 7505,
    },
    l2tp: {
      subnet: process.env.L2TP_SUBNET || '10.0.2.0/24',
      ipsecPsk: process.env.L2TP_IPSEC_PSK || 'TunnelServerPSK2024',
      port: 1701,
    },
  },
};

module.exports = config;
