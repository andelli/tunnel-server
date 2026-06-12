-- Tunnel Server Database Schema
-- Managed by src/db/init.js and src/db/database.js

CREATE TABLE IF NOT EXISTS admin_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'admin',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vpn_users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password        TEXT,
    enabled         INTEGER DEFAULT 1,
    allowed_ips     TEXT DEFAULT '0.0.0.0/0',
    wg_enabled      INTEGER DEFAULT 1,
    wg_private_key  TEXT,
    wg_public_key   TEXT,
    wg_preshared_key TEXT,
    wg_address      TEXT,
    ovpn_enabled    INTEGER DEFAULT 1,
    ovpn_cert_serial TEXT,
    l2tp_enabled    INTEGER DEFAULT 1,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_handshake  DATETIME,
    total_bytes_sent   INTEGER DEFAULT 0,
    total_bytes_recv   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL,
    protocol        TEXT NOT NULL,
    client_ip       TEXT,
    assigned_ip     TEXT,
    connected_at    DATETIME,
    disconnected_at DATETIME,
    bytes_sent      INTEGER DEFAULT 0,
    bytes_recv      INTEGER DEFAULT 0,
    disconnect_reason TEXT
);

CREATE TABLE IF NOT EXISTS active_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL,
    protocol        TEXT NOT NULL,
    client_ip       TEXT,
    assigned_ip     TEXT UNIQUE,
    peer_pubkey     TEXT,
    bytes_sent      INTEGER DEFAULT 0,
    bytes_recv      INTEGER DEFAULT 0,
    connected_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS server_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    level       TEXT NOT NULL DEFAULT 'info',
    category    TEXT NOT NULL DEFAULT 'system',
    message     TEXT NOT NULL,
    details     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_log_username ON sessions_log(username);
CREATE INDEX IF NOT EXISTS idx_sessions_log_protocol ON sessions_log(protocol);
CREATE INDEX IF NOT EXISTS idx_active_sessions_username ON active_sessions(username);
CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_event_log_category ON event_log(category);
