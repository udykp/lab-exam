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
