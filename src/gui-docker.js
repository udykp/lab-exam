const { spawn } = require('child_process');
const path = require('path');

let activeWinId = null;
let lastBounds = { x: 300, y: 180, width: 480, height: 460 };
let activeDockerProcess = null;

function dockGuiProcess(mainWindow, pid, opts = {}) {
  if (!mainWindow || !pid) return;

  const scriptPath = path.join(__dirname, '..', 'scripts', 'dock_gui_window.py');
  let parentXid = 0;
  try {
    const handle = mainWindow.getNativeWindowHandle();
    if (handle && handle.length >= 4) {
      parentXid = handle.readUInt32LE(0);
    }
  } catch (err) {
    console.warn('[GuiDocker] Failed to get native window handle:', err.message);
  }

  const bounds = opts.bounds || lastBounds;
  const titleHint = opts.titleHint || opts.title || '';

  const args = [
    scriptPath,
    '--pid', String(pid),
    '--parent', String(parentXid),
    '--x', String(Math.round(bounds.x || 300)),
    '--y', String(Math.round(bounds.y || 180)),
    '--width', String(Math.round(bounds.width || 480)),
    '--height', String(Math.round(bounds.height || 460))
  ];

  if (titleHint) {
    args.push('--title-hint', titleHint);
  }

  console.log(`[GuiDocker] Launching docker script for PID ${pid} with parent ${parentXid}`);
  const py = spawn('python3', args);
  activeDockerProcess = py;

  let stdoutData = '';
  py.stdout.on('data', (d) => {
    stdoutData += d.toString();
  });

  py.stderr.on('data', (d) => {
    console.warn('[GuiDocker PY ERR]', d.toString().trim());
  });

  py.on('close', (code) => {
    activeDockerProcess = null;
    try {
      const res = JSON.parse(stdoutData.trim());
      if (res && res.success && res.win_id) {
        activeWinId = res.win_id;
        console.log(`[GuiDocker] Successfully docked GUI window ${activeWinId}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('gui-dock-attached', { winId: activeWinId });
        }
      }
    } catch (_) {}
  });
}

function refocusGuiWindow() {
  if (!activeWinId) return;
  const scriptPath = path.join(__dirname, '..', 'scripts', 'dock_gui_window.py');
  spawn('python3', [scriptPath, '--refocus', String(activeWinId)]);
}

function updateBounds(bounds) {
  if (bounds) {
    lastBounds = { ...lastBounds, ...bounds };
  }
}

function stopGuiSession() {
  activeWinId = null;
  if (activeDockerProcess) {
    try { activeDockerProcess.kill(); } catch (_) {}
    activeDockerProcess = null;
  }
}

function registerGuiDockerIPC(ipcMain) {
  ipcMain.on('gui-docker-refocus', () => {
    refocusGuiWindow();
  });
  ipcMain.on('gui-docker-bounds', (event, bounds) => {
    updateBounds(bounds);
  });
}

module.exports = {
  dockGuiProcess,
  refocusGuiWindow,
  updateBounds,
  stopGuiSession,
  registerGuiDockerIPC
};
