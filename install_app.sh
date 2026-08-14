#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# 3. Create wrapper script in the app directory to handle PATH expansion
echo "Creating wrapper launch script..."
cat <<EOF > "$APP_DIR/run.sh"
#!/bin/bash
export PATH="\$PATH:$NPM_BIN_DIR"
cd "$APP_DIR"
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

# 6. Create terminal commands (symlink run.sh into ~/.local/bin)
echo "Creating terminal commands..."
mkdir -p "$HOME/.local/bin"
ln -sf "$APP_DIR/run.sh" "$HOME/.local/bin/securelab"
ln -sf "$APP_DIR/run.sh" "$HOME/.local/bin/SecureLab"

# 5. Update Desktop Database to refresh app grid
echo "Refreshing system app registry..."
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo "==============================================="
echo "=== SecureLab Launcher Installed Successfully ==="
echo "=== Search for 'SecureLab' in your App Grid! ==="
echo "==============================================="
