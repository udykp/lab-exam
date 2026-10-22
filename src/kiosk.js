const { exec } = require('child_process');
const { screen, clipboard } = require('electron');
const path = require('path');

let focusLockInterval = null;

function disableSuperKey() {
  exec("gsettings set org.gnome.mutter overlay-key ''", (err) => {
    if (err) console.warn('[ExamGuard] Could not disable GNOME Super key:', err.message);
    else console.log('[ExamGuard] Super/Windows key disabled at OS level.');
  });
  exec("gsettings set org.gnome.shell.keybindings toggle-overview \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings panel-run-dialog \"[]\"", () => {});

  // Disable Show Desktop (Win+D, Super+D, Super+H, Ctrl+Alt+D)
  exec("gsettings set org.gnome.desktop.wm.keybindings show-desktop \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings minimize \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings hide-window \"[]\"", () => {});
  exec("gsettings set org.gnome.shell.keybindings toggle-application-view \"[]\"", () => {});
  exec("gsettings set org.gnome.shell.keybindings toggle-message-tray \"[]\"", () => {});
  exec("gsettings set org.gnome.shell.keybindings focus-active-notification \"[]\"", () => {});

  // Disable Alt+Tab
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-applications \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-windows \"[]\"", () => {});

  // Disable Alt+Backtick
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-group \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings switch-group-backward \"[]\"", () => {});

  // Disable Alt+Esc
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-windows \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-windows-backward \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-panels \"[]\"", () => {});
  exec("gsettings set org.gnome.desktop.wm.keybindings cycle-panels-backward \"[]\"", () => {});

  // Disable Hot Corners
  exec("gsettings set org.gnome.desktop.interface enable-hot-corners false", () => {});

  // Disable tiling / snapping
  exec("gsettings set org.gnome.mutter.keybindings toggle-tiled-left \"[]\"", () => {});
  exec("gsettings set org.gnome.mutter.keybindings toggle-tiled-right \"[]\"", () => {});

  // Disable maximization / snapping
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

  // Block 3-finger swipe workspace switching by collapsing to a single workspace
  exec("gsettings set org.gnome.mutter dynamic-workspaces false", () => {});
  exec("gsettings set org.gnome.desktop.wm.preferences num-workspaces 1", () => {});

  // Disable GNOME Shell swipe trackers at compositor level
  const disableSwipeJs = [
    "try { Main.overview._swipeTracker.enabled = false; } catch(e) {}",
    "try { Main.wm._workspaceAnimation._swipeTracker.enabled = false; } catch(e) {}",
    "try { Main.overview._swipeTracker._touchpadGesture.enabled = false; } catch(e) {}",
  ].join(" ");
  exec(`gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "${disableSwipeJs}"`, (err) => {
    if (err) console.warn('[ExamGuard] Could not disable GNOME Shell swipe trackers:', err.message);
    else console.log('[ExamGuard] GNOME Shell swipe trackers disabled — 3-finger gestures blocked.');
  });
}

function restoreSuperKey() {
  exec("gsettings reset org.gnome.mutter overlay-key", (err) => {
    if (err) console.warn('[ExamGuard] Could not reset GNOME Super key:', err.message);
    else console.log('[ExamGuard] Super/Windows key restored to default.');
  });
  exec("gsettings reset org.gnome.shell.keybindings toggle-overview", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings panel-run-dialog", () => {});

  exec("gsettings reset org.gnome.desktop.wm.keybindings show-desktop", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings minimize", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings hide-window", () => {});
  exec("gsettings reset org.gnome.shell.keybindings toggle-application-view", () => {});
  exec("gsettings reset org.gnome.shell.keybindings toggle-message-tray", () => {});
  exec("gsettings reset org.gnome.shell.keybindings focus-active-notification", () => {});

  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-applications", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-windows", () => {});

  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-group", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings switch-group-backward", () => {});

  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-windows", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-windows-backward", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-panels", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings cycle-panels-backward", () => {});

  exec("gsettings reset org.gnome.desktop.interface enable-hot-corners", () => {});

  exec("gsettings reset org.gnome.mutter.keybindings toggle-tiled-left", () => {});
  exec("gsettings reset org.gnome.mutter.keybindings toggle-tiled-right", () => {});

  exec("gsettings reset org.gnome.desktop.wm.keybindings maximize", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings unmaximize", () => {});
  exec("gsettings reset org.gnome.desktop.wm.keybindings toggle-maximized", () => {});

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

  exec("gsettings set org.gnome.mutter dynamic-workspaces true", () => {});
  exec("gsettings reset org.gnome.desktop.wm.preferences num-workspaces", () => {});

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

function lockExamWindow(mainWindow) {
  if (!mainWindow) return;
  try {
    clipboard.clear();
    console.log('[ExamGuard] Clipboard cleared successfully on exam lock.');
  } catch (err) {
    console.error('[ExamGuard] Error clearing clipboard:', err);
  }
  mainWindow._examLocked = true;
  mainWindow.setResizable(false);
  mainWindow.setMovable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setFullScreen(true);
  mainWindow.setKiosk(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  disableSuperKey();

  if (focusLockInterval) clearInterval(focusLockInterval);
  focusLockInterval = setInterval(() => {
    if (mainWindow && mainWindow._examLocked) {
      if (!mainWindow.isKiosk() || !mainWindow.isFullScreen()) {
        console.log('[ExamGuard] Enforcing fullscreen kiosk mode...');
        mainWindow.setFullScreen(true);
        mainWindow.setKiosk(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }
  }, 2000);

  console.log('[ExamGuard] Window locked to fullscreen kiosk screen-saver layer.');
}

function unlockExamWindow(mainWindow) {
  if (!mainWindow) return;
  mainWindow._examLocked = false;
  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setResizable(true);
  mainWindow.setMovable(true);
  mainWindow.setMinimizable(true);
  restoreSuperKey();

  if (focusLockInterval) {
    clearInterval(focusLockInterval);
    focusLockInterval = null;
  }
}

function setupWindowGuards(mainWindow, appDir) {
  mainWindow.on('close', (e) => {
    if (mainWindow && mainWindow._examLocked) {
      e.preventDefault();
      console.warn('[ExamGuard] Intercepted close event. Close action blocked while exam is locked.');
    }
  });

  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow._examLocked) {
      exec("gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \"Main.overview.hide();\"", () => {});

      setTimeout(() => {
        if (mainWindow && mainWindow._examLocked && !mainWindow.isFocused()) {
          console.log('[ExamGuard] Focus lost. Reclaiming window focus...');
          mainWindow.focus();
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
          exec("gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \"Main.overview.hide();\"", () => {});
        }
      }, 150);
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

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow._examLocked) {
      if (input.control && input.shift && input.key.toLowerCase() === 'd') {
        event.preventDefault();
        console.log('[Demo Mode] Loading local demo.html via Ctrl+Shift+D shortcut.');
        mainWindow.loadFile(path.join(appDir, 'web', 'demo.html'));
      }
      return;
    }

    const key = input.key.toLowerCase();
    const isStandaloneSuper = input.key === 'Meta' || input.key === 'Super' || input.key === 'OS';

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

    if (isStandaloneSuper || isSuperComboSwitching || isDevToolsOrReload || isAltTabSwitching) {
      event.preventDefault();

      if (isSuperComboSwitching || isAltTabSwitching) {
        console.warn('[ExamGuard] Window/tab switching key combination detected! Intercepted & blocked.');
        mainWindow.webContents.send('window-focus-changed', { focused: false });
      } else if (isStandaloneSuper) {
        console.log('[ExamGuard] Standalone Super key tapped — blocked silently.');
      }
    }
  });
}

function registerKioskIPC(ipcMain, getMainWindow, onExitApp) {
  ipcMain.on('request-fullscreen', (event, fullscreen) => {
    const win = getMainWindow();
    if (win) {
      if (typeof fullscreen === 'boolean') {
        win.setFullScreen(fullscreen);
      } else {
        win.setFullScreen(!win.isFullScreen());
      }
    }
  });

  ipcMain.on('toggle-maximize', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isFullScreen()) {
        win.setFullScreen(false);
      }
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('lock-exam-window', () => {
    const win = getMainWindow();
    if (win) lockExamWindow(win);
  });

  ipcMain.on('unlock-exam-window', () => {
    const win = getMainWindow();
    if (win) unlockExamWindow(win);
  });

  ipcMain.on('minimize-app', () => {
    const win = getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.on('exit-app', () => {
    restoreSuperKey();
    if (typeof onExitApp === 'function') {
      onExitApp();
    }
  });
}

module.exports = {
  disableSuperKey,
  restoreSuperKey,
  lockExamWindow,
  unlockExamWindow,
  setupWindowGuards,
  registerKioskIPC
};
