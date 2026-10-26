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

# Optional: pass --autologin to also arm GDM autologin into the kiosk session.
# Without it the kiosk session is installed and set as the default, but you
# still log in through the GDM greeter (recommended until you verify it works).
KIOSK_AUTOLOGIN=0
for arg in "$@"; do
  case "$arg" in
    --autologin) KIOSK_AUTOLOGIN=1 ;;
  esac
done

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

# 5. Install the locked kiosk exam session (Xorg + openbox)
echo "-------------------------------------------------"
echo "Step 5: Installing locked kiosk exam session..."
echo "-------------------------------------------------"
if [ -f "$APP_DIR/kiosk/install-kiosk.sh" ]; then
  chmod +x "$APP_DIR/kiosk/install-kiosk.sh"
  KIOSK_ARGS=""
  [ "$KIOSK_AUTOLOGIN" -eq 1 ] && KIOSK_ARGS="--autologin"
  if sudo bash "$APP_DIR/kiosk/install-kiosk.sh" $KIOSK_ARGS; then
    echo "Kiosk session installed."
  else
    echo "⚠  Kiosk session install hit an error (see above). Retry later with:"
    echo "   sudo bash \"$APP_DIR/kiosk/install-kiosk.sh\""
  fi
else
  echo "⚠  kiosk/install-kiosk.sh not found — skipping kiosk session setup."
fi

echo "================================================="
echo "=== Setup Completed Successfully! ==="
echo "=== Search for 'SecureLab' in your applications! ==="
echo "=== Or type 'securelab' in the terminal! ==="
echo "-------------------------------------------------"
echo "Locked exam session installed: 'SecureLab Exam (Kiosk)'."
echo "Log out / reboot, then at the GDM login screen it is the"
echo "default session for this user (pick others via the gear icon)."
if [ "$KIOSK_AUTOLOGIN" -eq 1 ]; then
  echo "Autologin is ARMED. Apply with:  sudo systemctl restart gdm"
else
  echo "To boot straight into the exam (autologin), once verified run:"
  echo "   sudo /opt/securelab-kiosk/kiosk-exam-mode.sh && sudo systemctl restart gdm"
fi
echo "================================================="
