const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');

let activeXvfbProc = null;
let activeVncProc = null;
let activeDisplay = null;
let activeWsPort = null;
let activeRfbPort = null;

function isGuiCode(language, code) {
  if (!code) return false;
  const lang = (language || '').toLowerCase();

  if (lang.includes('java')) {
    return /import\s+(javax\.swing|java\.awt)|extends\s+(JFrame|Frame|JPanel|Applet|JApplet|JDialog|Window)|new\s+(JFrame|Frame)/i.test(code);
  }
  if (lang.includes('python')) {
    return /import\s+(tkinter|PyQt5|PyQt6|PySide2|PySide6|wx)|from\s+(tkinter|PyQt5|PyQt6|PySide2|PySide6|wx)/i.test(code);
  }
  if (lang === 'c' || lang === 'cpp') {
    return /<gtk\/gtk\.h>|<QApplication>|<GL\/glut\.h>|<SDL2\/SDL\.h>/i.test(code);
  }
  return false;
}

function hasGuiTools() {
  try {
    execSync('which Xvfb && which x11vnc', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startGuiSession(event) {
  stopGuiSession(); // Cleanup any stale session

  if (!hasGuiTools()) {
    console.warn('[GuiRunner] Xvfb or x11vnc is missing on system.');
    return null;
  }

  // Allocate a virtual display number between :90 and :180
  const displayNum = Math.floor(90 + Math.random() * 90);
  const displayStr = `:${displayNum}`;

  try {
    const wsPort = await getFreePort();
    const rfbPort = await getFreePort();

    console.log(`[GuiRunner] Starting Xvfb on ${displayStr} (RFB:${rfbPort}, WS:${wsPort})...`);

    // 1. Spawn Xvfb with standard 24-bit 800x600 virtual screen
    activeXvfbProc = spawn('Xvfb', [
      displayStr,
      '-screen', '0', '800x600x24',
      '-ac',
      '+extension', 'GLX',
      '+render',
      '-noreset'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    activeXvfbProc.on('error', (err) => {
      console.warn('[GuiRunner] Xvfb process error:', err.message);
    });

    // Wait for Xvfb socket to establish
    const socketPath = `/tmp/.X11-unix/X${displayNum}`;
    let socketReady = false;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(socketPath)) {
        socketReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if (!socketReady) {
      throw new Error(`Xvfb socket failed to initialize at ${socketPath}`);
    }

    // 2. Spawn x11vnc with WebSocket bridge enabled
    activeVncProc = spawn('x11vnc', [
      '-display', displayStr,
      '-rfbport', String(rfbPort),
      '-websock', String(wsPort),
      '-nopw',
      '-forever',
      '-shared',
      '-solid', '#18181b',
      '-quiet'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    activeVncProc.on('error', (err) => {
      console.warn('[GuiRunner] x11vnc process error:', err.message);
    });

    activeDisplay = displayStr;
    activeWsPort = wsPort;
    activeRfbPort = rfbPort;

    // Allow x11vnc to bind port and connect to Xvfb
    await new Promise(r => setTimeout(r, 500));

    if (event && event.sender) {
      event.sender.send('gui-session-start', {
        wsPort,
        display: displayStr,
        width: 800,
        height: 600
      });
    }

    return {
      display: displayStr,
      wsPort,
      rfbPort
    };
  } catch (err) {
    console.error('[GuiRunner] Failed to initialize virtual display:', err.message);
    stopGuiSession();
    return null;
  }
}

function stopGuiSession(event) {
  if (activeVncProc) {
    try {
      if (activeVncProc.pid) process.kill(-activeVncProc.pid, 'SIGKILL');
    } catch (_) {
      try { activeVncProc.kill('SIGKILL'); } catch (_) {}
    }
    activeVncProc = null;
  }

  if (activeXvfbProc) {
    try {
      if (activeXvfbProc.pid) process.kill(-activeXvfbProc.pid, 'SIGKILL');
    } catch (_) {
      try { activeXvfbProc.kill('SIGKILL'); } catch (_) {}
    }
    activeXvfbProc = null;
  }

  if (activeDisplay) {
    const lockNum = activeDisplay.replace(':', '');
    const lockFile = `/tmp/.X${lockNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${lockNum}`;
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) {}
    try { if (fs.existsSync(socketFile)) fs.unlinkSync(socketFile); } catch (_) {}
  }

  activeDisplay = null;
  activeWsPort = null;
  activeRfbPort = null;

  if (event && event.sender) {
    event.sender.send('gui-session-stop');
  }
}

module.exports = {
  isGuiCode,
  hasGuiTools,
  startGuiSession,
  stopGuiSession
};
