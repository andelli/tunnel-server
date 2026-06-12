const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const config = require('../config');

let db = null;

function getDb() {
  if (db) return db;

  const dbPath = config.paths.db;
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migration
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Seed default admin if none exists
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (adminCount.count === 0) {
    const hash = bcrypt.hashSync(config.admin.password, 12);
    db.prepare('INSERT INTO admin_users (username, password, role) VALUES (?, ?, ?)').run(
      config.admin.username, hash, 'superadmin'
    );
    console.log(`[DB] Default admin created: ${config.admin.username} / ${config.admin.password}`);
  }

  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
