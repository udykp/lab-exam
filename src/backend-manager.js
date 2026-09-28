const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let serverProcess = null;
let remoteServerUrl = process.env.REMOTE_SERVER_URL || '';

function initServerConfig(appDir) {
  const configPath = path.join(appDir, 'server-config.json');
  if (!remoteServerUrl && fs.existsSync(configPath)) {
    try {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (configData && configData.serverUrl) {
        remoteServerUrl = configData.serverUrl;
      }
    } catch (err) {
      console.warn('[Backend] Failed to parse server-config.json:', err.message);
    }
  }
}

function startGoBackend(appDir) {
  initServerConfig(appDir);

  if (remoteServerUrl) {
    console.log(`[Backend] Configured for remote server (${remoteServerUrl}). Skipping local Go backend spawn.`);
    return;
  }

  const isWin = process.platform === 'win32';
  const serverBinary = isWin ? 'server.exe' : 'server';
  const serverPath = path.join(appDir, 'bin', serverBinary);

  console.log(`[Backend] Starting Go backend from: ${serverPath}`);

  serverProcess = spawn(serverPath, [], {
    cwd: appDir,
    env: { ...process.env, LISTEN_ADDR: ':8080' }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Go Server]: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Go Server Error]: ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`[Go Server] Process exited with code ${code}`);
  });
}

function stopGoBackend() {
  if (serverProcess) {
    console.log('[Backend] Stopping Go backend...');
    const isWin = process.platform === 'win32';
    if (isWin) {
      spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
    } else {
      serverProcess.kill('SIGINT');
    }
    serverProcess = null;
  }
}

function getServerUrl() {
  return remoteServerUrl || 'http://localhost:8080';
}

function registerBackendIPC(ipcMain) {
  ipcMain.handle('get-server-url', () => getServerUrl());
}

module.exports = {
  startGoBackend,
  stopGoBackend,
  getServerUrl,
  registerBackendIPC
};
