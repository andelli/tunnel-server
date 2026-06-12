#!/bin/bash
# Tunnel VPN Gateway — Full Install
# Run as root: sudo bash install.sh

set -e

echo "================================================"
echo "  Tunnel VPN Gateway Server — Installer"
echo "================================================"

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/8] Installing system packages..."
apt-get update -qq
apt-get install -y -qq wireguard-tools openvpn easy-rsa strongswan xl2tpd ppp \
  iptables-persistent net-tools curl qrencode 2>&1 | tail -3

echo "[2/8] Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null
grep -q 'net.ipv4.ip_forward' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
grep -q 'net.ipv6.conf.all.forwarding' /etc/sysctl.conf || echo 'net.ipv6.conf.all.forwarding=1' >> /etc/sysctl.conf

echo "[3/8] Loading kernel modules..."
modprobe wireguard 2>/dev/null || echo "  (wireguard module may need kernel update)"
modprobe tun 2>/dev/null || true

echo "[4/8] Installing Node.js dependencies..."
npm install --production 2>&1 | tail -2

echo "[5/8] Initializing EasyRSA (OpenVPN PKI)..."
if [ ! -f easy-rsa/pki/ca.crt ]; then
  rm -rf easy-rsa 2>/dev/null
  make-cadir easy-rsa
  cd easy-rsa
  ./easyrsa init-pki >/dev/null 2>&1
  EASYRSA_BATCH=1 ./easyrsa build-ca nopass >/dev/null 2>&1
  EASYRSA_BATCH=1 ./easyrsa gen-dh >/dev/null 2>&1
  EASYRSA_BATCH=1 ./easyrsa build-server-full server nopass >/dev/null 2>&1
  cd "$SCRIPT_DIR"
  echo "  EasyRSA PKI ready"
fi

# Copy OpenVPN certs
mkdir -p configs/openvpn/server
cp easy-rsa/pki/ca.crt configs/openvpn/server/ 2>/dev/null || true
cp easy-rsa/pki/issued/server.crt configs/openvpn/server/ 2>/dev/null || true
cp easy-rsa/pki/private/server.key configs/openvpn/server/ 2>/dev/null || true
cp easy-rsa/pki/dh.pem configs/openvpn/server/ 2>/dev/null || true

# Generate OpenVPN ta.key if missing
[ -f configs/openvpn/server/ta.key ] || openvpn --genkey secret configs/openvpn/server/ta.key 2>/dev/null

echo "[6/8] Initializing database..."
node src/db/init.js

echo "[7/8] Installing systemd services..."
mkdir -p /etc/systemd/system

for unit in systemd/tunnel-*.service systemd/tunnel.target; do
  name="$(basename "$unit")"
  cp "$unit" "/etc/systemd/system/$name"
  echo "  installed $name"
done

# Enable all services
systemctl daemon-reload
systemctl enable tunnel-wireguard.service 2>/dev/null || true
systemctl enable tunnel-openvpn.service 2>/dev/null || true
systemctl enable tunnel-strongswan.service 2>/dev/null || true
systemctl enable tunnel-xl2tpd.service 2>/dev/null || true
systemctl enable tunnel-dashboard.service 2>/dev/null || true

# Start dashboard only now; user can start others
systemctl start tunnel-dashboard.service 2>&1 || true

echo "[8/8] Setup NAT rules (persistent)..."
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
netfilter-persistent save 2>/dev/null || true

SERVER_IP="$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

echo ""
echo "================================================"
echo "  INSTALLATION COMPLETE"
echo "================================================"
echo ""
echo "  Dashboard : http://$SERVER_IP:3000"
echo "  Login     : admin / admin123"
echo ""
echo "  Service management:"
echo "    systemctl start tunnel-wireguard.service"
echo "    systemctl start tunnel-openvpn.service"
echo "    systemctl start tunnel-strongswan.service"
echo "    systemctl start tunnel-xl2tpd.service"
echo "    systemctl {start|stop|restart} tunnel-dashboard.service"
echo ""
echo "  All services:"
echo "  systemctl start tunnel.target"
echo ""
echo "  WireGuard port :51820  |  OpenVPN port :1194"
echo "  L2TP/IPsec PSK :TunnelServerPSK2024"
echo ""
echo "  >>> Change the default password immediately! <<<"
echo "================================================"

# Write Windows L2TP instructions
cat > configs/l2tp/WINDOWS.txt << 'EOF'
=== L2TP/IPsec untuk Windows ===

1. Settings → Network & Internet → VPN
2. Add VPN connection:
   - VPN provider: Windows (built-in)
   - Connection name: Tunnel VPN
   - Server name/address: <SERVER_IP>
   - VPN type: L2TP/IPsec with pre-shared key
   - Pre-shared key: TunnelServerPSK2024
   - User name: (dari dashboard)
   - Password: (dari dashboard)
3. Save → Connect
EOF

echo "$(date) — Install complete" >> /var/log/tunnel-install.log
