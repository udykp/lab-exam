#!/bin/bash
# =============================================================================
# Switch the machine OUT of exam mode: disable GDM autologin so an admin can
# reach the login screen and pick a normal desktop session. Run with sudo.
#
# This is the maintenance escape hatch. If the machine is sitting in an
# autologin kiosk session and you cannot reach a terminal, SSH into the
# machine and run this script, then restart
# GDM. After logging into a normal "Ubuntu" session you can update the repo,
# re-image, etc. Re-arm exam mode later with kiosk-exam-mode.sh.
# =============================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }

GDM_CONF=/etc/gdm3/custom.conf
if [ -f "$GDM_CONF" ]; then
  cp -a "$GDM_CONF" "$GDM_CONF.securelab.bak" 2>/dev/null || true
  # Turn autologin off (handles true/True/yes spacing variants).
  sed -i 's/^[[:space:]]*AutomaticLoginEnable[[:space:]]*=.*/AutomaticLoginEnable=false/I' "$GDM_CONF"
fi

echo "ADMIN MODE: autologin disabled."
echo "Apply now with:  sudo systemctl restart gdm"
echo "At the login screen choose the gear icon -> 'Ubuntu' for a normal session."
