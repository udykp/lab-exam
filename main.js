const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess = null;

// Determine Go backend binary path
const isWin = process.platform === 'win32';
const serverBinary = isWin ? 'server.exe' : 'server';
const serverPath = path.join(__dirname, 'bin', serverBinary);

const fs = require('fs');

// Check if a remote server configuration exists or environment variable is set
let remoteServerUrl = process.env.REMOTE_SERVER_URL || '';
const configPath = path.join(__dirname, 'server-config.json');
if (!remoteServerUrl && fs.existsSync(configPath)) {
  try {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData && configData.serverUrl) {
      remoteServerUrl = configData.serverUrl;
    }
  } catch (err) {
    console.warn('Failed to parse server-config.json:', err.message);
  }
}

function startGoBackend() {
  if (remoteServerUrl) {
    console.log(`Configured for remote server (${remoteServerUrl}). Skipping local Go backend spawn.`);
    return;
  }

  console.log(`Starting Go backend from: ${serverPath}`);
  
  // Spawn the server
  serverProcess = spawn(serverPath, [], {
    cwd: __dirname,
    env: { ...process.env, LISTEN_ADDR: ':8080' }
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Go Server]: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Go Server Error]: ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Go server process exited with code ${code}`);
  });
}

function stopGoBackend() {
  if (serverProcess) {
    console.log('Stopping Go backend...');
    if (isWin) {
      spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
    } else {
      serverProcess.kill('SIGINT');
    }
    serverProcess = null;
  }
}

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
    },
  });

  mainWindow.webContents.session.clearCache();

  // Target server URL (remote server or local Go server)
  const targetServerUrl = remoteServerUrl || 'http://localhost:8080';
  
  if (remoteServerUrl) {
    console.log(`Connecting directly to remote server: ${remoteServerUrl}`);
    mainWindow.loadURL(remoteServerUrl);
  } else {
    // Poll local server until it responds, then load URL
    const checkInterval = setInterval(() => {
      http.get(`${targetServerUrl}/healthz`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkInterval);
          mainWindow.loadURL(targetServerUrl);
        }
      }).on('error', () => {
        console.log('Waiting for Go server to start...');
      });
    }, 200);

    // If server takes too long (e.g. 10s), fallback to loading index.html file directly
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      console.warn('Go server timeout, loading HTML directly.');
      mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));
    }, 10000);

    mainWindow.on('ready-to-show', () => {
      clearTimeout(timeout);
    });
  }

  // Fullscreen configuration — starts windowed; locked to fullscreen once exam begins
  mainWindow.setFullScreen(false);

  // Focus & Blur events to detect cheating
  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow._examLocked) {
      // Immediately close GNOME Activities Overview if triggered by 3-finger swipe
      // This works on Wayland via GNOME Shell's D-Bus interface
      exec("gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \"Main.overview.hide();\"", () => {});

      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
          mainWindow.focus();
          // Close overview again after a short delay in case it re-opened
          exec("gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \"Main.overview.hide();\"", () => {});
        }
      }, 200);
    }
    mainWindow.webContents.send('window-focus-changed', { focused: false });
  });

  mainWindow.on('focus', () => {
    mainWindow.webContents.send('window-focus-changed', { focused: true });
  });

  const enforceFullscreen = () => {
    if (mainWindow && mainWindow._examLocked) {
      const displayBounds = screen.getPrimaryDisplay().bounds;
      const windowBounds = mainWindow.getBounds();
      
      if (windowBounds.width !== displayBounds.width || windowBounds.height !== displayBounds.height || windowBounds.x !== displayBounds.x || windowBounds.y !== displayBounds.y) {
        console.warn('[ExamGuard] Window bounds mismatch (snapping attempt)! Forcing fullscreen kiosk...');
        mainWindow.setBounds(displayBounds);
        mainWindow.setFullScreen(true);
        mainWindow.setKiosk(true);
      }
    }
  };

  mainWindow.on('resize', enforceFullscreen);
  mainWindow.on('move', enforceFullscreen);
  mainWindow.on('moved', enforceFullscreen);
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && mainWindow._examLocked) {
      setTimeout(enforceFullscreen, 50);
    }
  });

  // Block dangerous keyboard shortcuts during the exam
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow._examLocked) return; // only enforce during active exam

    const key = input.key.toLowerCase();
    const isMetaModifier = input.meta || input.key === 'Meta' || input.key === 'Super' || input.key === 'OS';

    // Check if it's a standalone Super/Meta key press vs an actual combination shortcut
    const isStandaloneSuper = isMetaModifier && (input.key === 'Meta' || input.key === 'Super' || input.key === 'OS');
    
    // Combinations used for workspace/tab/window switching
    const isSuperComboSwitching = input.meta && (
      key === 'tab' ||
      key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown' ||
      key === 'd' || key === 'm' || key === 'l'
    );

    const isDevToolsOrReload =
      (input.control && input.shift && key === 'i') ||
      (input.meta && input.alt && key === 'i') ||
      key === 'f12' ||
      (input.control && key === 'r') ||
      (input.meta && key === 'r') ||
      key === 'f5';

    const isAltTabSwitching =
      (input.alt && key === 'tab') ||
      (input.alt && key === 'f4') ||
      (input.alt && key === 'escape');

    if (isMetaModifier || isDevToolsOrReload || isAltTabSwitching) {
      // ALWAYS block the shortcut from taking effect in the OS/Browser
      event.preventDefault();

      if (isSuperComboSwitching || isAltTabSwitching) {
        console.warn('[ExamGuard] Window/tab switching key combination detected! Intercepted & blocked.');
        mainWindow.webContents.send('window-focus-changed', { focused: false });
      } else if (isStandaloneSuper) {
        console.log('[ExamGuard] Standalone Super key tapped — blocked silently.');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle hooks
app.whenReady().then(() => {
  startGoBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopGoBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopGoBackend();
});

// IPC communication endpoints
ipcMain.on('request-fullscreen', (event, fullscreen) => {
  if (mainWindow) {
    mainWindow.setFullScreen(fullscreen);
  }
});

// Disable Super/Windows key at the OS (WM) level.
// Running as root lets us modify gsettings for the active user session.
const { exec } = require('child_process');

function disableSuperKey() {
  // GNOME: clear the overlay-key so Super stops opening Activities/launcher
  exec("gsettings set org.gnome.mutter overlay-key ''", (err) => {
    if (err) console.warn('[ExamGuard] Could not disable GNOME Super key:', err.message);
    else console.log('[ExamGuard] Super/Windows key disabled at OS level.');
  });
  // Also disable GNOME Shell Super key shortcuts
  exec("gsettings set org.gnome.shell.keybindings toggle-overview \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings panel-run-dialog \"[]\"", () => {});

  // Disable Alt+Tab (switching applications and windows)
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-applications \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-windows \"[]\"", () => {});

  // Disable Alt+Backtick (switching windows of the same group)
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-group \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-group-backward \"[]\"", () => {});

  // Disable Alt+Esc cycle windows/panels
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-windows \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-windows-backward \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-panels \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-panels-backward \"[]\"", () => {});

  // Disable Hot Corners (mouse gestures to open activities)
  exec("gsettings set org.gnome.desktop.interface enable-hot-corners false", () => {});

  // Disable tiling / snapping (Super + Left/Right)
  exec("gsettings set org.gnome.mutter.keybindings toggle-tiled-left \"[]\"", () => {});
  exec("gsettings set org.gnome.mutter.keybindings toggle-tiled-right \"[]\"", () => {});

  // Disable maximization / snapping (Super + Up/Down)
  exec("gsettings set org.gnome.desktop.wm.keybindings maximize \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings unmaximize \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings toggle-maximized \"[]\"", () => {});

  // Disable workspace switching keybindings
  const wsKeys = [
    'switch-to-workspace-left', 'switch-to-workspace-right',
    'switch-to-workspace-up', 'switch-to-workspace-down',
    'switch-to-workspace-last',
    'switch-to-workspace-1', 'switch-to-workspace-2',
    'switch-to-workspace-3', 'switch-to-workspace-4'
  ];
  wsKeys.forEach(k => {
    exec(`gsettings set org.gnome.desktop.wm.keybindings ${k} "[]"`, () => {});
  });

  // Block 3-finger swipe workspace switching by collapsing to a single workspace.
  // The gesture still fires but has nowhere to go — touchpad remains fully usable.
  exec("gsettings set org.gnome.mutter dynamic-workspaces false", () => {});
  exec("gsettings set org.gnome.desktop.wm.preferences num-workspaces 1", () => {});

  // Directly disable GNOME Shell's swipe gesture trackers at the compositor level.
  // This kills both the Activities Overview swipe (3-finger up) and workspace
  // switching swipe (3-finger left/right) — works on Wayland without touching the touchpad.
  const disableSwipeJs = [
    "try { Main.overview._swipeTracker.enabled = false; } catch(e) {}",
    "try { Main.wm._workspaceAnimation._swipeTracker.enabled = false; } catch(e) {}",
    "try { Main.overview._swipeTracker._touchpadGesture.enabled = false; } catch(e) {}",
  ].join(" ");
  exec(`gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "${disableSwipeJs}"`, (err, stdout) => {
    if (err) console.warn('[ExamGuard] Could not disable GNOME Shell swipe trackers:', err.message);
    else console.log('[ExamGuard] GNOME Shell swipe trackers disabled — 3-finger gestures blocked at compositor level.');
  });
}

function restoreSuperKey() {
  exec("gsettings reset org.gnome.mutter overlay-key", (err) => {
    if (err) console.warn('[ExamGuard] Could not reset GNOME Super key:', err.message);
    else console.log('[ExamGuard] Super/Windows key restored to default.');
  });
  exec("gsettings reset org.gnome.shell.keybindings toggle-overview", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings panel-run-dialog", () => {});

  // Restore Alt+Tab
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-applications", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-windows", () => {});

  // Restore Alt+Backtick
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-group", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-group-backward", () => {});

  // Restore Alt+Esc
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-windows", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-windows-backward", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-panels", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-panels-backward", () => {});

  // Restore Hot Corners
  exec("gsettings reset org.gnome.desktop.interface enable-hot-corners", () => {});

  // Restore tiling / snapping
  exec("gsettings reset org.gnome.mutter.keybindings toggle-tiled-left", () => {});
  exec("gsettings reset org.gnome.mutter.keybindings toggle-tiled-right", () => {});

  // Restore maximization
  exec("gsettings reset org.gnome.desktop.wm.keybindings maximize", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings unmaximize", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings toggle-maximized", () => {});

  // Restore workspace switching keybindings
  const wsKeys = [
    'switch-to-workspace-left', 'switch-to-workspace-right',
    'switch-to-workspace-up', 'switch-to-workspace-down',
    'switch-to-workspace-last',
    'switch-to-workspace-1', 'switch-to-workspace-2',
    'switch-to-workspace-3', 'switch-to-workspace-4'
  ];
  wsKeys.forEach(k => {
    exec(`gsettings reset org.gnome.desktop.wm.keybindings ${k}`, () => {});
  });

  // Restore workspaces to dynamic
  exec("gsettings set org.gnome.mutter dynamic-workspaces true", () => {});
  exec("gsettings reset org.gnome.desktop.wm.preferences num-workspaces", () => {});

  // Re-enable GNOME Shell swipe trackers
  const enableSwipeJs = [
    "try { Main.overview._swipeTracker.enabled = true; } catch(e) {}",
    "try { Main.wm._workspaceAnimation._swipeTracker.enabled = true; } catch(e) {}",
    "try { Main.overview._swipeTracker._touchpadGesture.enabled = true; } catch(e) {}",
  ].join(" ");
  exec(`gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "${enableSwipeJs}"`, (err) => {
    if (err) console.warn('[ExamGuard] Could not restore GNOME Shell swipe trackers:', err.message);
    else console.log('[ExamGuard] GNOME Shell swipe trackers restored.');
  });
}

ipcMain.on('lock-exam-window', () => {
  if (mainWindow) {
    mainWindow._examLocked = true;
    mainWindow.setResizable(false);
    mainWindow.setMovable(false);
    mainWindow.setMinimizable(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setFullScreen(true);
    mainWindow.setKiosk(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    disableSuperKey();  // Block Windows key at OS level
    console.log('[ExamGuard] Window locked to fullscreen kiosk screen-saver layer.');
  }
});

// Unlock window (called after exam ends voluntarily or on exit)
ipcMain.on('unlock-exam-window', () => {
  if (mainWindow) {
    mainWindow._examLocked = false;
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setResizable(true);
    mainWindow.setMovable(true);
    mainWindow.setMinimizable(true);
    restoreSuperKey();  // Restore Windows key to system defaults
  }
});

// IPC Handler to save code locally on the student's Desktop
ipcMain.handle('save-local-file', async (event, folderName, fileName, content) => {
  try {
    const desktopPath = app.getPath('desktop');
    const studentFolder = path.join(desktopPath, folderName);
    if (!fs.existsSync(studentFolder)) {
      fs.mkdirSync(studentFolder, { recursive: true });
    }
    const filePath = path.join(studentFolder, fileName);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[ExamGuard] File successfully saved locally: ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    console.error('[ExamGuard] Failed to save file locally:', err);
    return { success: false, error: err.message };
  }
});

// Exit exam - called after student voluntarily ends or is terminated
// Since the app can run as root, app.quit() has full OS privileges to
// forcibly close the window and stop the embedded Go server cleanly.
ipcMain.on('exit-app', () => {
  restoreSuperKey();  // Always restore Super key on exit
  stopGoBackend();
  setTimeout(() => {
    app.exit(0);
  }, 800);
});

// Ensure OS Super key is restored on app quit or unhandled crash
app.on('will-quit', () => {
  restoreSuperKey();
  stopGoBackend();
});

process.on('SIGINT', () => {
  restoreSuperKey();
  process.exit(0);
});

process.on('SIGTERM', () => {
  restoreSuperKey();
  process.exit(0);
});

