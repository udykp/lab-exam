#!/bin/bash
set -e

echo "=== Building Server for Linux (amd64) ==="
mkdir -p deploy
GOOS=linux GOARCH=amd64 go build -o deploy/server ./cmd/server
echo "Server binary built successfully at: deploy/server"
