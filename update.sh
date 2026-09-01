#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "==============================================="
echo "=== SECURELAB: UPDATING FROM GITHUB ==="
echo "==============================================="

# 1. Ensure git repository exists
if [ ! -d ".git" ]; then
  echo "❌ Error: Not a git repository ($APP_DIR)."
  exit 1
fi

# 2. Check if git remote is configured
REMOTE_URL="$(git config --get remote.origin.url || true)"
if [ -z "$REMOTE_URL" ]; then
  echo "❌ Error: No remote origin URL configured."
  exit 1
fi

echo "Remote: $REMOTE_URL"
echo "Fetching latest changes..."

# Record package-lock.json hash before pull to detect dependency changes
OLD_LOCK_HASH=""
if [ -f "package-lock.json" ]; then
  OLD_LOCK_HASH="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}')"
fi

# 3. Pull latest changes
git fetch origin main
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  git pull --ff-only origin "$CURRENT_BRANCH"
else
  echo "Note: Currently on branch '$CURRENT_BRANCH'. Pulling origin/$CURRENT_BRANCH..."
  git pull --ff-only origin "$CURRENT_BRANCH" || true
fi

# 4. Check if dependencies changed
NEW_LOCK_HASH=""
if [ -f "package-lock.json" ]; then
  NEW_LOCK_HASH="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}')"
fi

if [ "$OLD_LOCK_HASH" != "$NEW_LOCK_HASH" ]; then
  echo "-----------------------------------------------"
  echo "Dependencies updated. Running npm install..."
  echo "-----------------------------------------------"
  if ! command -v npm &>/dev/null && [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
  fi
  npm install
fi

# 5. Ensure scripts are executable
chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

# 6. Refresh desktop launcher and links
if [ -f "$APP_DIR/install_app.sh" ]; then
  "$APP_DIR/install_app.sh" >/dev/null 2>&1 || true
fi

echo "==============================================="
echo "=== ✅ Update Completed Successfully! ==="
echo "==============================================="
