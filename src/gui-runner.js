const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

let activeXvfbProc = null;
let activeWmProc = null;
let activeVncProc = null;
let activeWsServer = null;
let activeDisplay = null;
let activeWsPort = null;
let activeRfbPort = null;
let onActivityCallback = null;

function setActivityCallback(cb) {
  onActivityCallback = cb;
}

function notifyActivity() {
  if (typeof onActivityCallback === 'function') {
    try { onActivityCallback(); } catch (_) {}
  }
}

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

function getAvailableWm() {
  for (const wm of ['openbox', 'fluxbox', 'twm', 'mwm']) {
    try {
      execSync(`which ${wm}`, { stdio: 'ignore' });
      return wm;
    } catch (_) {}
  }
  return null;
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

/**
 * Pure Node.js RFC 6455 WebSocket-to-TCP bridge.
 * Bridges HTML5 browser WebSocket to the local x11vnc RFB TCP socket.
 */
function startWebSocketBridge(wsPort, targetRfbPort) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SecureLab Virtual Display Bridge');
  });

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto.createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      'Sec-WebSocket-Protocol: binary\r\n\r\n'
    );

    const tcp = net.connect(targetRfbPort, '127.0.0.1');

    tcp.on('data', (chunk) => {
      const len = chunk.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x82, len]);
      } else if (len <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      try {
        socket.write(Buffer.concat([header, chunk]));
      } catch (_) {}
    });

    let rxBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      notifyActivity();
      rxBuf = Buffer.concat([rxBuf, chunk]);

      while (rxBuf.length >= 2) {
        const byte1 = rxBuf[0];
        const byte2 = rxBuf[1];
        const opcode = byte1 & 0x0F;
        const isMasked = (byte2 & 0x80) !== 0;
        let payloadLen = byte2 & 0x7F;
        let offset = 2;

        if (opcode === 0x08) { // Close
          socket.end();
          tcp.end();
          return;
        }

        if (payloadLen === 126) {
          if (rxBuf.length < 4) return;
          payloadLen = rxBuf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (rxBuf.length < 10) return;
          payloadLen = Number(rxBuf.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = isMasked ? 4 : 0;
        if (rxBuf.length < offset + maskLen + payloadLen) return;

        let payload = rxBuf.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (isMasked) {
          const mask = rxBuf.subarray(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
          }
        }

        rxBuf = rxBuf.subarray(offset + maskLen + payloadLen);
        try {
          tcp.write(payload);
        } catch (_) {}
      }
    });

    tcp.on('error', () => { socket.destroy(); });
    socket.on('error', () => { tcp.destroy(); });
    tcp.on('close', () => { socket.destroy(); });
    socket.on('close', () => { tcp.destroy(); });
  });

  return new Promise((resolve, reject) => {
    server.listen(wsPort, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
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

    // Clean any residual lock/socket before spawning
    const lockFile = `/tmp/.X${displayNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${displayNum}`;
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) {}
    try { if (fs.existsSync(socketFile)) fs.unlinkSync(socketFile); } catch (_) {}

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
    let socketReady = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(socketFile)) {
        socketReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if (!socketReady) {
      throw new Error(`Xvfb socket failed to initialize at ${socketFile}`);
    }

    // 2. Spawn lightweight window manager if installed (openbox / fluxbox / twm)
    const wmCmd = getAvailableWm();
    if (wmCmd) {
      console.log(`[GuiRunner] Starting window manager (${wmCmd}) on ${displayStr}...`);
      activeWmProc = spawn(wmCmd, wmCmd === 'openbox' ? ['--sm-disable'] : [], {
        env: { ...process.env, DISPLAY: displayStr },
        detached: true,
        stdio: 'ignore'
      });
      activeWmProc.on('error', (err) => {
        console.warn('[GuiRunner] Window manager notice:', err.message);
      });
    }

    // 3. Spawn x11vnc listening on TCP rfbPort
    activeVncProc = spawn('x11vnc', [
      '-display', displayStr,
      '-rfbport', String(rfbPort),
      '-nopw',
      '-forever',
      '-shared',
      '-quiet'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    activeVncProc.on('error', (err) => {
      console.warn('[GuiRunner] x11vnc process error:', err.message);
    });

    // Wait for x11vnc TCP port to become available
    let vncReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        await new Promise((res, rej) => {
          const testSock = net.connect(rfbPort, '127.0.0.1', () => {
            testSock.destroy();
            res();
          });
          testSock.on('error', rej);
        });
        vncReady = true;
        break;
      } catch (_) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // 4. Start pure Node.js WebSocket bridge
    activeWsServer = await startWebSocketBridge(wsPort, rfbPort);
    console.log(`[GuiRunner] WebSocket bridge active on port ${wsPort} -> RFB ${rfbPort}`);

    activeDisplay = displayStr;
    activeWsPort = wsPort;
    activeRfbPort = rfbPort;

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
  if (activeWsServer) {
    try { activeWsServer.close(); } catch (_) {}
    activeWsServer = null;
  }

  if (activeWmProc) {
    try {
      if (activeWmProc.pid) process.kill(-activeWmProc.pid, 'SIGKILL');
    } catch (_) {
      try { activeWmProc.kill('SIGKILL'); } catch (_) {}
    }
    activeWmProc = null;
  }

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
  stopGuiSession,
  setActivityCallback
};
