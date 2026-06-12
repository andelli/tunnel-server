const { execSync, exec } = require('child_process');
const config = require('../config');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000, ...opts }).trim();
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${e.stderr || e.message}`);
  }
}

function getMainInterface() {
  try {
    const routes = run('ip route show default');
    const match = routes.match(/dev\s+(\S+)/);
    return match ? match[1] : 'eth0';
  } catch {
    return 'eth0';
  }
}

function enableIpForward() {
  run('sysctl -w net.ipv4.ip_forward=1');
  run('sysctl -w net.ipv6.conf.all.forwarding=1');
}

function setupNAT(interface) {
  const iface = interface || getMainInterface();
  run(`iptables -t nat -C POSTROUTING -o ${iface} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o ${iface} -j MASQUERADE`);
  run(`iptables -C FORWARD -i ${config.vpn.wireguard.interface} -j ACCEPT 2>/dev/null || iptables -A FORWARD -i ${config.vpn.wireguard.interface} -j ACCEPT`);
  run(`iptables -C FORWARD -o ${config.vpn.wireguard.interface} -j ACCEPT 2>/dev/null || iptables -A FORWARD -o ${config.vpn.wireguard.interface} -j ACCEPT`);
}

function teardownNAT(interface) {
  const iface = interface || getMainInterface();
  run(`iptables -t nat -D POSTROUTING -o ${iface} -j MASQUERADE 2>/dev/null || true`);
  run(`iptables -D FORWARD -i ${config.vpn.wireguard.interface} -j ACCEPT 2>/dev/null || true`);
  run(`iptables -D FORWARD -o ${config.vpn.wireguard.interface} -j ACCEPT 2>/dev/null || true`);
}

function isInterfaceUp(name) {
  try {
    return run(`ip link show ${name} up 2>/dev/null | grep -q ${name}`) === '';
  } catch {
    return false;
  }
}

module.exports = { run, getMainInterface, enableIpForward, setupNAT, teardownNAT, isInterfaceUp };
