#!/bin/bash
# WireGuard Tunnel Server — Installer
# Run as root: sudo bash install.sh

set -e

echo "================================================"
echo "  WireGuard Tunnel Server — Install"
echo "================================================"

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/5] Installing system packages..."
apt-get update -qq
apt-get install -y -qq wireguard-tools iptables-persistent net-tools curl qrencode 2>&1 | tail -2

echo "[2/5] Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1 >/dev/null
grep -q 'net.ipv4.ip_forward' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

echo "[3/5] Loading kernel module..."
modprobe wireguard 2>/dev/null || echo "  (wireguard module may need kernel update)"

echo "[4/5] Installing Node.js dependencies..."
npm install --production 2>&1 | tail -2

echo "[5/5] Installing systemd services..."
for unit in systemd/tunnel-*.service systemd/tunnel.target; do
  cp "$unit" "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload
systemctl enable tunnel-dashboard.service 2>/dev/null || true
systemctl start tunnel-dashboard.service 2>&1 || true

SERVER_IP="$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

echo ""
echo "================================================"
echo "  INSTALLATION COMPLETE"
echo "================================================"
echo "  Dashboard : http://$SERVER_IP:3000"
echo "  Login     : admin / admin123"
echo ""
echo "  Start WireGuard: systemctl start tunnel-wireguard"
echo "  Start Dashboard: systemctl start tunnel-dashboard"
echo ""
echo "  >>> Change default password after login! <<<"
echo "================================================"
