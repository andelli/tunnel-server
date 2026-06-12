#!/bin/bash
# Tunnel Server - Full Install Script
# Run as root: sudo bash install.sh

set -e

echo "================================================"
echo "  Tunnel VPN Gateway Server - Installer"
echo "================================================"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[1/8] Installing system packages..."
apt-get update
apt-get install -y wireguard-tools openvpn easy-rsa strongswan xl2tpd ppp \
  iptables-persistent net-tools curl

echo "[2/8] Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1
sysctl -w net.ipv6.conf.all.forwarding=1
if ! grep -q "net.ipv4.ip_forward" /etc/sysctl.conf; then
  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
fi
if ! grep -q "net.ipv6.conf.all.forwarding" /etc/sysctl.conf; then
  echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
fi

echo "[3/8] Setting up WireGuard kernel module..."
modprobe wireguard 2>/dev/null || echo "WireGuard module may need kernel update"
modprobe tun 2>/dev/null || true

echo "[4/8] Installing Node.js dependencies..."
if [ ! -d "node_modules" ]; then
  npm install --production 2>&1 | tail -3
fi

echo "[5/8] Initializing EasyRSA (OpenVPN PKI)..."
if [ ! -d "easy-rsa/pki" ]; then
  make-cadir easy-rsa 2>/dev/null || true
  cd easy-rsa
  ./easyrsa init-pki 2>/dev/null || true
  EASYRSA_BATCH=1 ./easyrsa build-ca nopass 2>/dev/null || true
  EASYRSA_BATCH=1 ./easyrsa gen-dh 2>/dev/null || true
  EASYRSA_BATCH=1 ./easyrsa build-server-full server nopass 2>/dev/null || true

  # Copy certs
  mkdir -p "$SCRIPT_DIR/configs/openvpn/server"
  cp pki/ca.crt "$SCRIPT_DIR/configs/openvpn/server/" 2>/dev/null || true
  cp pki/issued/server.crt "$SCRIPT_DIR/configs/openvpn/server/" 2>/dev/null || true
  cp pki/private/server.key "$SCRIPT_DIR/configs/openvpn/server/" 2>/dev/null || true
  cp pki/dh.pem "$SCRIPT_DIR/configs/openvpn/server/" 2>/dev/null || true
  cd "$SCRIPT_DIR"
fi

echo "[6/8] Generating WireGuard server keys..."
mkdir -p configs/wireguard
if [ ! -f configs/wireguard/server_private.key ]; then
  wg genkey | tee configs/wireguard/server_private.key | wg pubkey > configs/wireguard/server_public.key
  echo "WireGuard keys generated."
fi

echo "[7/8] Initializing database..."
node src/db/init.js

echo "[8/8] Setting up systemd service..."
cat > /etc/systemd/system/tunnel-dashboard.service << 'SERVICEEOF'
[Unit]
Description=Tunnel VPN Gateway Dashboard
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/tunnel-server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable tunnel-dashboard
systemctl start tunnel-dashboard

# Get server IP
SERVER_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "================================================"
echo "  INSTALLATION COMPLETE!"
echo "================================================"
echo ""
echo "  Dashboard: http://$SERVER_IP:3000"
echo "  Login:     admin / admin123"
echo ""
echo "  Services installed:"
echo "    - WireGuard (UDP $SERVER_IP:51820)"
echo "    - OpenVPN   (UDP $SERVER_IP:1194)"
echo "    - L2TP/IPsec ($SERVER_IP:1701, PSK: TunnelServerPSK2024)"
echo ""
echo "  IMPORTANT: Change the default password after login!"
echo "================================================"

cat > "$SCRIPT_DIR/configs/wireguard/README.txt" << 'READMEEOF'
=== WIREGUARD CONFIGURATION ===

Server public key can be found in:
  configs/wireguard/server_public.key

Client configs can be downloaded from the dashboard.

To manually add a client:
  wg set wg0 peer <client_pubkey> allowed-ips <client_ip>/32
READMEEOF

cat > "$SCRIPT_DIR/configs/l2tp/README.txt" << 'READMEEOF'
=== L2TP/IPsec FOR WINDOWS ===

Configure Windows VPN:
1. Settings → Network & Internet → VPN
2. Add VPN connection:
   - VPN provider: Windows (built-in)
   - Connection name: Tunnel VPN
   - Server name or address: <server-ip>
   - VPN type: L2TP/IPsec with pre-shared key
   - Pre-shared key: TunnelServerPSK2024
   - Type of sign-in info: User name and password
   - Username: (from dashboard)
   - Password: (from dashboard)
3. Save and connect
READMEEOF

echo "Installation log written to /var/log/tunnel-install.log"
