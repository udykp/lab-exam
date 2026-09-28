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

# Fast silent auto-update check (3-second timeout, skips if offline)
if [ -d ".git" ]; then
  OLD_PKG_HASH="$(md5sum package.json 2>/dev/null | awk '{print $1}')"
  timeout 4 git pull --ff-only origin main >/dev/null 2>&1 || true
  NEW_PKG_HASH="$(md5sum package.json 2>/dev/null | awk '{print $1}')"
  if [ "$OLD_PKG_HASH" != "$NEW_PKG_HASH" ]; then
    npm install --silent >/dev/null 2>&1 || true
  fi
fi

npm start
