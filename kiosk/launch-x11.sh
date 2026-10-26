#!/bin/sh
# =============================================================================
# SecureLab kiosk launcher — X11 fallback (stripped Openbox)
# -----------------------------------------------------------------------------
# Used only if the cage/Wayland session misbehaves on a given machine. GDM
# starts an Xorg server and runs this as the session. We launch Openbox with a
# locked config (openbox-rc.xml) that has ALL keyboard and mouse bindings
# removed, then the exam app. Touchpad "workspace swipe" gestures are a GNOME
# Shell feature and do not exist here; Alt+Tab/Alt+F4/run-dialog are stripped
# from Openbox; and there is only one app, so there is nothing to switch to.
#
# NOTE: Ctrl+Alt+F* VT switching is an X-server feature Openbox cannot block.
# On dedicated exam machines you may harden it further — see kiosk/README.md.
# =============================================================================
set -eu

if [ -r /opt/securelab-kiosk/kiosk.env ]; then
  # shellcheck disable=SC1091
  . /opt/securelab-kiosk/kiosk.env
fi
APP_DIR="${SECURELAB_APP_DIR:-$HOME/Desktop/Lab Exam}"

export ELECTRON_OZONE_PLATFORM_HINT=x11
LOG="$HOME/securelab-kiosk.log"
echo "=== $(date) : starting SecureLab X11 kiosk ===" >>"$LOG" 2>&1

# Minimal window manager for reliable fullscreen; all shortcuts removed.
openbox --config-file /opt/securelab-kiosk/openbox-rc.xml >>"$LOG" 2>&1 &
OB_PID=$!

# Compositor so the FRAMELESS Electron window actually paints (without a
# compositor a frame:false window renders black). xrender backend needs no GPU.
picom --backend xrender >>"$LOG" 2>&1 &
PICOM_PID=$!

# Tear down the compositor + WM and end the session when the exam app exits.
cleanup() { kill "$PICOM_PID" "$OB_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Run in the foreground (not exec) so the trap fires on exit.
/bin/bash "$APP_DIR/run.sh" >>"$LOG" 2>&1
