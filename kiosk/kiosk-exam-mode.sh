#!/bin/bash
# =============================================================================
# Switch the machine INTO exam mode: enable GDM autologin into the SecureLab
# kiosk session for the configured kiosk user. Run with sudo.
# =============================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }

# shellcheck disable=SC1091
. /opt/securelab-kiosk/kiosk.env
U="${SECURELAB_KIOSK_USER:?kiosk user not set in /opt/securelab-kiosk/kiosk.env}"

GDM_CONF=/etc/gdm3/custom.conf
mkdir -p /etc/gdm3
touch "$GDM_CONF"
cp -a "$GDM_CONF" "$GDM_CONF.securelab.bak" 2>/dev/null || true

# Ensure a [daemon] section exists.
grep -q '^\[daemon\]' "$GDM_CONF" || printf '[daemon]\n' >> "$GDM_CONF"

# Remove any existing autologin directives, then insert fresh ones right
# after the [daemon] header.
sed -i '/^[[:space:]]*AutomaticLoginEnable[[:space:]]*=/d; /^[[:space:]]*AutomaticLogin[[:space:]]*=/d' "$GDM_CONF"
awk -v u="$U" '
  /^\[daemon\]/ { print; print "AutomaticLoginEnable=true"; print "AutomaticLogin=" u; next }
  { print }
' "$GDM_CONF" > "$GDM_CONF.tmp" && mv "$GDM_CONF.tmp" "$GDM_CONF"

echo "EXAM MODE: autologin enabled for '$U'."
echo "Apply now with:  sudo systemctl restart gdm   (or reboot)"
