#!/bin/sh
# =============================================================================
# SecureLab kiosk launcher — X11 + Openbox (the locked exam session)
# -----------------------------------------------------------------------------
# GDM starts an Xorg server and runs this as the whole session. We launch
# Openbox with a locked config (openbox-rc.xml) that has ALL keyboard and mouse
# bindings removed, then the exam app. Touchpad "workspace swipe" gestures are a
# GNOME Shell feature and do not exist here; Alt+Tab/Alt+F4/run-dialog are
# stripped from Openbox; and there is only one app, so there is nothing to
# switch to.
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
# Tell the app it is in the locked kiosk session so it owns its own fullscreen.
export SECURELAB_KIOSK=1
LOG="$HOME/securelab-kiosk.log"
echo "=== $(date) : starting SecureLab X11 kiosk ===" >>"$LOG" 2>&1

# GDM remembers the last session you logged into and makes it your default, so
# once an invigilator picks "SecureLab Exam (Kiosk)" from the login gear the
# machine keeps defaulting to the kiosk on every later login -- even after the
# exam. To hand the laptop back to normal use, we reset the stored default to
# the ordinary Ubuntu desktop as soon as the exam app exits. AccountsService
# lets a user set their OWN default session with no root, so this runs as the
# exam user with no sudo. Override the target on odd machines by setting
# SECURELAB_NORMAL_SESSION (e.g. "ubuntu-xorg") in kiosk.env.
NORMAL_SESSION="${SECURELAB_NORMAL_SESSION:-ubuntu}"
reset_default_session() {
  uid=$(id -u)
  gdbus call --system \
    --dest org.freedesktop.Accounts \
    --object-path "/org/freedesktop/Accounts/User$uid" \
    --method org.freedesktop.Accounts.User.SetSession "$NORMAL_SESSION" >>"$LOG" 2>&1 \
    && echo "reset default session -> $NORMAL_SESSION" >>"$LOG" 2>&1 \
    || echo "WARNING: could not reset default session to $NORMAL_SESSION" >>"$LOG" 2>&1
}

# Minimal window manager for reliable fullscreen; all shortcuts removed.
# Use the copy install-kiosk.sh placed in /opt. openbox is started BEFORE
# run.sh's git auto-update runs, so reading a repo copy here could load a
# pre-update or half-written config. The /opt copy is written explicitly by the
# installer; update the WM config by re-running install-kiosk.sh.
openbox --config-file /opt/securelab-kiosk/openbox-rc.xml >>"$LOG" 2>&1 &
OB_PID=$!

# A compositor is only needed if the window comes up black. Electron now owns
# its own fullscreen (SECURELAB_KIOSK=1), which paints on bare X without
# compositing — and picom's overlay can swallow mouse clicks, so it is OFF by
# default. If a specific machine still shows a black screen, set
#   SECURELAB_USE_PICOM=1
# in /opt/securelab-kiosk/kiosk.env and it will start here.
PICOM_PID=""
if [ "${SECURELAB_USE_PICOM:-0}" = "1" ]; then
  picom --backend xrender >>"$LOG" 2>&1 &
  PICOM_PID=$!
fi

# Tear down the compositor + WM and end the session when the exam app exits.
cleanup() { kill $PICOM_PID "$OB_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Run in the foreground (not exec) so the trap fires on exit.
/bin/bash "$APP_DIR/run.sh" >>"$LOG" 2>&1 || true

# Exam app has exited: hand the machine back to the normal Ubuntu desktop so the
# next login does not land in the kiosk again. Done here (session still fully
# active) rather than in the EXIT trap, where polkit may already reject it.
reset_default_session
