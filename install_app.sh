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
echo "Configuring launch script (run.sh)..."
if [ ! -f "$APP_DIR/run.sh" ]; then
  cat <<'EOF' > "$APP_DIR/run.sh"
#!/bin/bash
# Dynamically load NVM / Node if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
fi
for node_bin in "$HOME"/.nvm/versions/node/*/bin; do
  if [ -d "$node_bin" ]; then
    export PATH="$PATH:$node_bin"
  fi
done

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
cd "$SCRIPT_DIR"

# Fast auto-update check (safely syncs with remote main, skips if offline)
if [ -d ".git" ]; then
  OLD_LOCK_HASH=""
  [ -f "package-lock.json" ] && OLD_LOCK_HASH="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}')"

  FETCH_OK=0
  if timeout 8 git fetch origin main >/dev/null 2>&1; then
    FETCH_OK=1
  elif timeout 8 git fetch https://github.com/udykp/lab-exam.git main >/dev/null 2>&1; then
    FETCH_OK=1
  fi

  if [ "$FETCH_OK" -eq 1 ]; then
    LOCAL_REV="$(git rev-parse HEAD 2>/dev/null || true)"
    REMOTE_REV="$(git rev-parse FETCH_HEAD 2>/dev/null || true)"

    if [ -n "$REMOTE_REV" ] && [ "$LOCAL_REV" != "$REMOTE_REV" ]; then
      git reset --hard FETCH_HEAD >/dev/null 2>&1 || true

      NEW_LOCK_HASH=""
      [ -f "package-lock.json" ] && NEW_LOCK_HASH="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}')"

      if [ "$OLD_LOCK_HASH" != "$NEW_LOCK_HASH" ]; then
        npm install --silent >/dev/null 2>&1 || true
      fi

      chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true
    fi
  fi
fi

npm start
EOF
fi
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
