#!/bin/bash
export PATH="$PATH:/home/crrao2/.nvm/versions/node/v22.23.2/bin"
cd "/home/crrao2/Desktop/Lab Exam"

# Fast silent auto-update check (3-second timeout, skips if offline)
if [ -d ".git" ]; then
  timeout 3 git pull --ff-only origin main >/dev/null 2>&1 || true
fi

npm start
