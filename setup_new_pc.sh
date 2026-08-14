#!/bin/bash
set -e

echo "================================================="
echo "=== SECURELAB: COMPLETE SYSTEM SETUP SCRIPT ==="
echo "================================================="

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Update system package repository & install Node.js + NPM
echo "-------------------------------------------------"
echo "Step 1: Installing Node.js and NPM..."
echo "-------------------------------------------------"
sudo apt-get update -y
sudo apt-get install -y nodejs npm

# 2. Run the environment compiler & database installer
echo "-------------------------------------------------"
echo "Step 2: Installing compilers & databases..."
echo "-------------------------------------------------"
chmod +x "$APP_DIR/setup_env.sh"
"$APP_DIR/setup_env.sh"

# 3. Install Electron client node dependencies
echo "-------------------------------------------------"
echo "Step 3: Installing project node packages..."
echo "-------------------------------------------------"
cd "$APP_DIR"
npm install

# 4. Install the SecureLab app launcher and system commands
echo "-------------------------------------------------"
echo "Step 4: Registering launcher shortcut and CLI links..."
echo "-------------------------------------------------"
chmod +x "$APP_DIR/install_app.sh"
"$APP_DIR/install_app.sh"

echo "================================================="
echo "=== Setup Completed Successfully! ==="
echo "=== Search for 'SecureLab' in your applications! ==="
echo "=== Or type 'securelab' in the terminal! ==="
echo "================================================="
