const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Disable GPU hardware acceleration to prevent rendering and input thread freezes on Linux Intel Mesa drivers
app.disableHardwareAcceleration();

// Rendering and GPU stability switches for Linux Mesa / Intel UHD Graphics
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
//app.commandLine.appendSwitch('enable-font-antialiasing');

const kiosk = require('./src/kiosk');
const runner = require('./src/runner');
const virtualSql = require('./src/virtual-sql');
const backendManager = require('./src/backend-manager');
const fileUtils = require('./src/file-utils');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Secure MLExam Platform',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.webContents.session.clearCache();

  const isDemo = process.argv.includes('--demo') || process.argv.includes('demo');
  if (isDemo) {
    console.log('[Demo Mode] Loading local demo.html directly from CLI argument.');
    mainWindow.loadFile(path.join(__dirname, 'web', 'demo.html'));
  } else {
    console.log('Loading local student workspace (index.html)...');
    mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));
  }

  // Setup kiosk mode, input event filters, focus recovery, and resize guards
  kiosk.setupWindowGuards(mainWindow, __dirname);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle Hooks ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  backendManager.startGoBackend(__dirname);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function handleExitApp() {
  kiosk.restoreSuperKey();
  backendManager.stopGoBackend();
  setTimeout(() => {
    app.exit(0);
  }, 800);
}

// ── Register Modular IPC Endpoints ───────────────────────────────────────────
runner.registerRunnerIPC(ipcMain);
virtualSql.registerVirtualSqlIPC(ipcMain);
fileUtils.registerFileUtilsIPC(ipcMain, app);
backendManager.registerBackendIPC(ipcMain);
kiosk.registerKioskIPC(ipcMain, () => mainWindow, handleExitApp);

// ── Safety & Cleanup Hooks ───────────────────────────────────────────────────
app.on('window-all-closed', () => {
  backendManager.stopGoBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  kiosk.restoreSuperKey();
  backendManager.stopGoBackend();
});

process.on('SIGINT', () => {
  kiosk.restoreSuperKey();
  process.exit(0);
});

process.on('SIGTERM', () => {
  kiosk.restoreSuperKey();
  process.exit(0);
});
