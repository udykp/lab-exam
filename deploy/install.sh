#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install.sh)"
  exit 1
fi

echo "=== Installing Secure MLExam Server ==="

mkdir -p /opt/securemlexam
mkdir -p /var/lib/securemlexam

cp server /opt/securemlexam/server
chmod +x /opt/securemlexam/server
if [ -d "web" ]; then
  cp -r web /opt/securemlexam/
fi

cp securemlexam.service /etc/systemd/system/securemlexam.service

systemctl daemon-reload
systemctl enable securemlexam
systemctl restart securemlexam

echo "=== Installation Complete ==="
echo "Status of securemlexam service:"
systemctl status securemlexam --no-pager
