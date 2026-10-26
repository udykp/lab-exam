const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Disable GPU hardware acceleration to prevent rendering and input thread freezes on Linux Intel Mesa drivers
app.disableHardwareAcceleration();

// Rendering and GPU stability switches for Linux Mesa / Intel UHD Graphics
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
// Stable WM_CLASS so the kiosk window manager can target the exam window only
// (openbox strips decorations from it, while student GUI program windows keep
// their normal title bar + close button).
app.commandLine.appendSwitch('class', 'SecureLabExam');
//app.commandLine.appendSwitch('enable-font-antialiasing');

const kiosk = require('./src/kiosk');
const runner = require('./src/runner');
const virtualSql = require('./src/virtual-sql');
const backendManager = require('./src/backend-manager');
const fileUtils = require('./src/file-utils');

let mainWindow = null;

function createWindow() {
  // In the locked kiosk session (set by kiosk/launch-*.sh) the app must own
  // its fullscreen so the real window size matches Electron's view — otherwise
  // a minimal WM force-resizes the frameless window and mouse clicks land on
  // the wrong coordinates.
  const isKioskSession = process.env.SECURELAB_KIOSK === '1';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Secure MLExam Platform',
    frame: false,
    fullscreen: isKioskSession,
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
runner.registerRunnerIPC(ipcMain, kiosk, () => mainWindow);
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
