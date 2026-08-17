#!/bin/bash
set -e

# Prevent running as root directly so NVM installs in the normal user's home folder
if [ "$EUID" -eq 0 ]; then
  echo "❌ ERROR: Please do NOT run this script as root/sudo directly."
  echo "NVM needs to be installed in the regular user's home directory so the node/npm commands are available to the user."
  echo "Please run it as a normal user: ./setup_new_pc.sh"
  exit 1
fi

echo "================================================="
echo "=== SECURELAB: COMPLETE SYSTEM SETUP SCRIPT ==="
echo "================================================="

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Update system package repository & install NVM + Node.js 22
echo "-------------------------------------------------"
echo "Step 1: Installing curl, NVM, and Node.js v22..."
echo "-------------------------------------------------"

# Ensure curl is installed
if ! command -v curl &> /dev/null; then
    echo "curl is not installed. Installing curl..."
    sudo apt-get update -y
    sudo apt-get install -y curl
fi

# Load NVM if it exists, or install it
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    echo "NVM is already installed. Loading..."
    source "$NVM_DIR/nvm.sh"
else
    echo "NVM is not installed. Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # Load NVM for this shell session
    source "$NVM_DIR/nvm.sh"
fi

# Install and set Node.js v22 as default
echo "Installing Node.js version 22..."
nvm install 22
nvm use 22
nvm alias default 22

# Verify node and npm paths
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

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
