require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { getDb } = require('./database');

console.log('[Init] Initializing database...');
getDb();
console.log('[Init] Database initialized successfully.');
process.exit(0);
