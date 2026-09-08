#!/bin/bash
export PATH="$PATH:/home/crrao2/.nvm/versions/node/v22.23.2/bin"
cd "/home/crrao2/Desktop/Lab Exam"

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
