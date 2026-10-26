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

# ── SecureLab control commands ──────────────────────────────────────────────
# `securelab` with no args launches the exam app (default behaviour below).
# These flags instead switch the machine between exam and admin modes.
KIOSK_DIR="/opt/securelab-kiosk"
case "${1:-}" in
  --autologin|--exam)
    if [ ! -x "$KIOSK_DIR/kiosk-exam-mode.sh" ]; then
      echo "Kiosk session is not installed yet."
      echo "Run once:  sudo bash \"$SCRIPT_DIR/kiosk/install-kiosk.sh\""
      exit 1
    fi
    echo "This will ENABLE exam autologin and REBOOT into the locked exam session."
    printf "Continue? [y/N] "
    read -r _ans
    case "$_ans" in
      y|Y|yes|YES) ;;
      *) echo "Cancelled."; exit 0 ;;
    esac
    sudo "$KIOSK_DIR/kiosk-exam-mode.sh" || { echo "Failed to arm autologin."; exit 1; }
    echo "Rebooting now..."
    sudo systemctl reboot
    exit 0
    ;;
  --no-autologin|--admin|--off)
    if [ ! -x "$KIOSK_DIR/kiosk-admin-mode.sh" ]; then
      echo "Kiosk session is not installed yet."
      exit 1
    fi
    sudo "$KIOSK_DIR/kiosk-admin-mode.sh" || { echo "Failed to disable autologin."; exit 1; }
    echo "Autologin disabled. Reboot or run:  sudo systemctl restart gdm"
    exit 0
    ;;
  --status)
    if [ -f /etc/gdm3/custom.conf ] && grep -qiE '^[[:space:]]*AutomaticLoginEnable[[:space:]]*=[[:space:]]*true' /etc/gdm3/custom.conf; then
      echo "Mode: EXAM (autologin ON)"
      grep -iE '^[[:space:]]*AutomaticLogin[[:space:]]*=' /etc/gdm3/custom.conf 2>/dev/null || true
    else
      echo "Mode: ADMIN (autologin OFF — normal GDM login screen)"
    fi
    exit 0
    ;;
  --help|-h)
    echo "Usage: securelab [option]"
    echo "  (no option)      launch the exam app (auto-updates first)"
    echo "  --autologin      arm exam autologin and REBOOT into the locked session"
    echo "  --no-autologin   disable autologin, return to the normal login screen"
    echo "  --status         show the current mode"
    exit 0
    ;;
esac

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
