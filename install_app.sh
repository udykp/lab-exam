#!/bin/bash
set -e

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
APP_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ICON_DIR="$HOME/.local/share/icons"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "==============================================="
echo "=== Installing SecureLab Desktop App Launcher ==="
echo "==============================================="

# 1. Ensure local icon & desktop directories exist
mkdir -p "$ICON_DIR"
mkdir -p "$DESKTOP_DIR"

# 2. Copy icon to local icon theme path
echo "Registering application icon..."
cp "$APP_DIR/icon.png" "$ICON_DIR/securelab.png"

NPM_BIN_DIR="$(dirname "$(which npm)")"

# 3. Create wrapper script in the app directory to handle PATH expansion & auto-update
echo "Creating wrapper launch script..."
cat <<EOF > "$APP_DIR/run.sh"
#!/bin/bash
export PATH="\$PATH:$NPM_BIN_DIR"
cd "$APP_DIR"

# Fast silent auto-update check (3-second timeout, skips if offline)
if [ -d ".git" ]; then
  OLD_PKG_HASH="\$(md5sum package.json 2>/dev/null | awk '{print \$1}')"
  timeout 4 git pull --ff-only origin main >/dev/null 2>&1 || true
  NEW_PKG_HASH="\$(md5sum package.json 2>/dev/null | awk '{print \$1}')"
  if [ "\$OLD_PKG_HASH" != "\$NEW_PKG_HASH" ]; then
    npm install --silent >/dev/null 2>&1 || true
  fi
fi

npm start
EOF
chmod +x "$APP_DIR/run.sh"

# 4. Create .desktop launcher file pointing to the wrapper script
echo "Creating desktop entry..."
cat <<EOF > "$DESKTOP_DIR/securelab.desktop"
[Desktop Entry]
Name=SecureLab
Comment=Secure MLExam Platform Client
Exec="$APP_DIR/run.sh"
Icon=$ICON_DIR/securelab.png
Type=Application
Terminal=false
Categories=Education;Development;Utility;
StartupNotify=true
EOF

# 5. Make .desktop launcher executable
chmod +x "$DESKTOP_DIR/securelab.desktop"

# 6. Create terminal commands (symlink run.sh & update.sh into ~/.local/bin)
echo "Creating terminal commands..."
mkdir -p "$HOME/.local/bin"
ln -sf "$APP_DIR/run.sh" "$HOME/.local/bin/securelab"
ln -sf "$APP_DIR/run.sh" "$HOME/.local/bin/SecureLab"
if [ -f "$APP_DIR/update.sh" ]; then
  chmod +x "$APP_DIR/update.sh"
  ln -sf "$APP_DIR/update.sh" "$HOME/.local/bin/securelab-update"
fi

# 7. Update Desktop Database to refresh app grid
echo "Refreshing system app registry..."
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo "==============================================="
echo "=== SecureLab Launcher Installed Successfully ==="
echo "=== Search for 'SecureLab' in your App Grid! ==="
echo "==============================================="
