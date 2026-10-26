#!/bin/sh
# =============================================================================
# SecureLab kiosk launcher — Wayland single-application compositor (cage)
# -----------------------------------------------------------------------------
# GDM runs this as the whole login session. cage is a tiny wlroots compositor
# that hosts exactly ONE client (the exam app) fullscreen. Because GNOME Shell
# is NOT running here, there is no overview, no workspaces, no Alt+Tab target
# and no touchpad workspace-switch gesture — there is physically nothing to
# switch to. When the app exits, cage exits and the session returns to GDM.
#
# VT switching (Ctrl+Alt+F1..F6) stays DISABLED because we do NOT pass cage's
# `-s` flag, so students cannot drop to a text console either.
# =============================================================================
set -eu

# Repo location + kiosk user are recorded by install-kiosk.sh.
if [ -r /opt/securelab-kiosk/kiosk.env ]; then
  # shellcheck disable=SC1091
  . /opt/securelab-kiosk/kiosk.env
fi
APP_DIR="${SECURELAB_APP_DIR:-$HOME/Desktop/Lab Exam}"
LOG="$HOME/securelab-kiosk.log"

# Force Electron onto the Wayland backend (cage provides WAYLAND_DISPLAY).
export ELECTRON_OZONE_PLATFORM_HINT=wayland
# Common cures for blank/black screens on lab GPUs under wlroots/cage.
export WLR_NO_HARDWARE_CURSORS=1
# Tell the app it is in the locked kiosk session so it owns its own fullscreen.
export SECURELAB_KIOSK=1

{
  echo "=== $(date) : starting SecureLab cage kiosk ==="
  echo "APP_DIR=$APP_DIR"
  command -v cage >/dev/null 2>&1 || echo "WARNING: 'cage' not found in PATH"
} >>"$LOG" 2>&1

# Hand cage the existing launcher (git auto-update + `npm start`).
#   -d : don't draw client-side decorations.
#   (no -s) : keep VT switching disabled.
# All output is captured to $LOG for troubleshooting a black screen.
exec cage -d -- /bin/bash "$APP_DIR/run.sh" >>"$LOG" 2>&1
