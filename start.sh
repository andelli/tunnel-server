#!/bin/bash
# Tunnel Server - Quick Start
# Run this once to start the dashboard without full installation

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --production
fi

echo "Starting Tunnel VPN Gateway Dashboard..."
echo "Access at http://localhost:3000"
echo "Login: admin / admin123 (change after login)"
echo ""

node src/index.js
