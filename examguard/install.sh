#!/usr/bin/env bash
# install.sh — Build and install the examguard daemon on Ubuntu.
# Run with: sudo bash install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
EXAMGUARD_DIR="$SCRIPT_DIR"

echo "=== ExamGuard Installer ==="

# ── 1. Build the Go binary ────────────────────────────────────────────────
echo "[1/5] Building examguard binary..."
cd "$EXAMGUARD_DIR"
go mod tidy
go build -ldflags="-s -w" -o "$ROOT_DIR/bin/examguard" .
echo "      Built → $ROOT_DIR/bin/examguard"

# ── 2. Install binary ─────────────────────────────────────────────────────
echo "[2/5] Installing binary to /usr/local/bin/examguard..."
install -m 755 "$ROOT_DIR/bin/examguard" /usr/local/bin/examguard

# ── 3. Install config ─────────────────────────────────────────────────────
echo "[3/5] Setting up /etc/examguard/..."
mkdir -p /etc/examguard
if [ ! -f /etc/examguard/config.json ]; then
    cp "$EXAMGUARD_DIR/config.example.json" /etc/examguard/config.json
    echo "      Default config written. Edit /etc/examguard/config.json before starting."
else
    echo "      Config already exists — skipping."
fi
chmod 600 /etc/examguard/config.json

# ── 4. Install systemd service ────────────────────────────────────────────
echo "[4/5] Installing systemd service..."
cp "$EXAMGUARD_DIR/examguard.service" /etc/systemd/system/examguard.service
systemctl daemon-reload
systemctl enable examguard
echo "      Service enabled (will auto-start on boot)."

# ── 5. Verify xdotool dependency ─────────────────────────────────────────
echo "[5/5] Checking dependencies..."
if ! command -v xdotool &>/dev/null; then
    echo "      Installing xdotool..."
    apt-get install -y xdotool >/dev/null 2>&1 || true
fi
if ! command -v xrandr &>/dev/null; then
    echo "      Installing x11-xserver-utils (xrandr)..."
    apt-get install -y x11-xserver-utils >/dev/null 2>&1 || true
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit /etc/examguard/config.json  (set student_roll, exam_id, server_url)"
echo "  2. sudo systemctl start examguard"
echo "  3. sudo systemctl status examguard"
echo ""
echo "To stop the daemon at end of exam:"
echo "  sudo systemctl stop examguard"
