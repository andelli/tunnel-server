const crypto = require('crypto');
const { execSync } = require('child_process');

function generateWireGuardKeyPair() {
  try {
    const privateKey = execSync('wg genkey', { encoding: 'utf8' }).trim();
    const publicKey = execSync(`echo "${privateKey}" | wg pubkey`, { encoding: 'utf8' }).trim();
    return { privateKey, publicKey };
  } catch {
    // Fallback: crypto-based generation
    const buf = crypto.randomBytes(32);
    const privateKey = buf.toString('base64');
    return { privateKey, publicKey: crypto.createHash('sha256').update(buf).digest('base64') };
  }
}

function generatePresharedKey() {
  return crypto.randomBytes(32).toString('base64');
}

function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  return Array.from(crypto.randomFillSync(new Uint32Array(length)))
    .map(v => chars[v % chars.length])
    .join('');
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

function intToIp(int) {
  return [(int >>> 24), (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.');
}

function getNextIp(subnet, usedIps) {
  const [base, mask] = subnet.split('/');
  const baseInt = ipToInt(base);
  const range = Math.pow(2, 32 - parseInt(mask));
  const usedInts = new Set(usedIps.map(ip => ipToInt(ip)));
  // Start from .2 (skip .1 for gateway)
  for (let i = 2; i < range - 1; i++) {
    const ip = intToIp(baseInt + i);
    if (!usedInts.has(ipToInt(ip))) return ip;
  }
  return null;
}

module.exports = {
  generateWireGuardKeyPair,
  generatePresharedKey,
  generatePassword,
  ipToInt,
  intToIp,
  getNextIp,
};
