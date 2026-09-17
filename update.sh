#!/bin/bash
set -e

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
APP_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
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

# 5.5 Fast Python self-healing check (pre-caches packages if missing)
if ! python3 -c "import numpy, pandas, matplotlib, scipy, sklearn" >/dev/null 2>&1; then
  echo "Pre-caching missing Python packages in ~/.securemlexam-venv..."
  VENV_PATH="$HOME/.securemlexam-venv"
  if [ ! -d "$VENV_PATH" ]; then
    python3 -m venv --system-site-packages "$VENV_PATH" 2>/dev/null || true
  fi
  if [ -f "$VENV_PATH/bin/pip" ]; then
    "$VENV_PATH/bin/pip" install --quiet --no-warn-script-location numpy pandas matplotlib scipy scikit-learn openpyxl 2>/dev/null || true
  fi
fi

# 6. Refresh desktop launcher and links
if [ -f "$APP_DIR/install_app.sh" ]; then
  "$APP_DIR/install_app.sh" >/dev/null 2>&1 || true
fi

echo "==============================================="
echo "=== ✅ Update Completed Successfully! ==="
echo "==============================================="
