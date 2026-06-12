#!/bin/bash
# Tunnel Server Cleanup
# Removes all VPN configurations and resets

set -e

echo "Cleaning up Tunnel Server..."

# Stop services
systemctl stop tunnel-dashboard 2>/dev/null || true
systemctl disable tunnel-dashboard 2>/dev/null || true

# Tear down WireGuard
wg-quick down wg0 2>/dev/null || true

# Stop OpenVPN
pkill openvpn 2>/dev/null || true

# Stop L2TP/IPsec
ipsec stop 2>/dev/null || true
pkill xl2tpd 2>/dev/null || true

# Clear iptables NAT rules
iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || true

echo "Cleanup complete. To remove all data: rm -rf /opt/tunnel-server/data"
