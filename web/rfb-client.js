/**
 * Minimal Standalone RFB (VNC) Canvas Client for SecureLab Virtual Display
 * Implements RFC 6143 (Protocol 3.8, Security: None, Raw Encoding).
 * Provides interactive mouse clicks and keyboard forwarding to X11/Xvfb.
 */
class SecureLabRfbClient {
  constructor(canvasEl, options = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { alpha: false });
    this.options = options;
    this.ws = null;
    this.state = 'DISCONNECTED'; // HANDSHAKE_VERSION, HANDSHAKE_SECURITY, CLIENT_INIT, SERVER_INIT, NORMAL
    this.width = 0;
    this.height = 0;
    this.bpp = 32;
    this.depth = 24;
    this.rxBuffer = new Uint8Array(0);
    this.mouseButtonMask = 0;
    this.active = false;
    this.reqPending = false;

    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
  }

  connect(wsUrl) {
    this.disconnect();
    this.active = true;
    this.state = 'HANDSHAKE_VERSION';

    try {
      this.ws = new WebSocket(wsUrl, ['binary']);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[RFB] Connected to virtual display bridge:', wsUrl);
        if (this.options.onConnected) this.options.onConnected();
      };

      this.ws.onmessage = (event) => {
        if (!this.active) return;
        const incoming = new Uint8Array(event.data);
        this._appendBuffer(incoming);
        this._processPackets();
      };

      this.ws.onerror = (err) => {
        console.warn('[RFB] WebSocket connection notice:', err);
      };

      this.ws.onclose = () => {
        console.log('[RFB] Virtual display bridge closed.');
        this._detachInputListeners();
        if (this.options.onDisconnected) this.options.onDisconnected();
      };

      this._attachInputListeners();
    } catch (err) {
      console.error('[RFB] Failed to initialize WebSocket:', err);
    }
  }

  disconnect() {
    this.active = false;
    this._detachInputListeners();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.rxBuffer = new Uint8Array(0);
    this.state = 'DISCONNECTED';
  }

  _appendBuffer(chunk) {
    const combined = new Uint8Array(this.rxBuffer.length + chunk.length);
    combined.set(this.rxBuffer, 0);
    combined.set(chunk, this.rxBuffer.length);
    this.rxBuffer = combined;
  }

  _consumeBytes(count) {
    const slice = this.rxBuffer.slice(0, count);
    this.rxBuffer = this.rxBuffer.slice(count);
    return slice;
  }

  _processPackets() {
    while (this.active && this.rxBuffer.length > 0) {
      // Step 1: Version Handshake (Server sends 12 bytes: "RFB 003.008\n")
      if (this.state === 'HANDSHAKE_VERSION') {
        if (this.rxBuffer.length < 12) return;
        const verBytes = this._consumeBytes(12);
        const verStr = String.fromCharCode(...verBytes);
        console.log('[RFB] Server protocol version:', verStr.trim());
        // Reply with RFB 003.008\n
        const reply = new TextEncoder().encode('RFB 003.008\n');
        this.ws.send(reply);
        this.state = 'HANDSHAKE_SECURITY';
        continue;
      }

      // Step 2: Security Types Handshake
      if (this.state === 'HANDSHAKE_SECURITY') {
        if (this.rxBuffer.length < 1) return;
        const count = this.rxBuffer[0];
        if (this.rxBuffer.length < 1 + count) return;
        this._consumeBytes(1 + count);
        // Select SecurityType = None (1)
        this.ws.send(new Uint8Array([1]));
        this.state = 'SECURITY_RESULT';
        continue;
      }

      // Step 3: Security Result (4 bytes: 0 = OK)
      if (this.state === 'SECURITY_RESULT') {
        if (this.rxBuffer.length < 4) return;
        const res = this._consumeBytes(4);
        const code = (res[0] << 24) | (res[1] << 16) | (res[2] << 8) | res[3];
        if (code !== 0) {
          console.error('[RFB] Security handshake rejected with code:', code);
          this.disconnect();
          return;
        }
        // Send ClientInit (1 byte: shared-flag = 1)
        this.ws.send(new Uint8Array([1]));
        this.state = 'SERVER_INIT';
        continue;
      }

      // Step 4: ServerInit
      if (this.state === 'SERVER_INIT') {
        if (this.rxBuffer.length < 24) return; // 2+2+16+4 = 24 bytes header
        const view = new DataView(this.rxBuffer.buffer, this.rxBuffer.byteOffset, 24);
        const width = view.getUint16(0);
        const height = view.getUint16(2);
        const bpp = this.rxBuffer[4];
        const depth = this.rxBuffer[5];
        const nameLen = view.getUint32(20);

        if (this.rxBuffer.length < 24 + nameLen) return;
        this._consumeBytes(24 + nameLen);

        this.width = width;
        this.height = height;
        this.bpp = bpp;
        this.depth = depth;
        console.log(`[RFB] Server initialized: ${width}x${height}, BPP:${bpp}, Depth:${depth}`);

        this.canvas.width = width;
        this.canvas.height = height;

        // Send SetEncodings: [0] (Raw Encoding)
        const encodingsMsg = new Uint8Array([
          2, 0, // type = 2, padding = 0
          0, 1, // count = 1
          0, 0, 0, 0 // Raw = 0
        ]);
        this.ws.send(encodingsMsg);

        // Request full initial screen update
        this._sendUpdateRequest(0, 0, 0, this.width, this.height);
        this.state = 'NORMAL';
        if (this.options.onReady) this.options.onReady(this.width, this.height);
        continue;
      }

      // Step 5: Normal Operation (FramebufferUpdate)
      if (this.state === 'NORMAL') {
        if (this.rxBuffer.length < 4) return;
        const msgType = this.rxBuffer[0];

        if (msgType === 0) {
          // FramebufferUpdate
          const view = new DataView(this.rxBuffer.buffer, this.rxBuffer.byteOffset, 4);
          const numRects = view.getUint16(2);

          let offset = 4;
          let parsedAll = true;

          for (let r = 0; r < numRects; r++) {
            if (this.rxBuffer.length < offset + 12) {
              parsedAll = false;
              break;
            }
            const rView = new DataView(this.rxBuffer.buffer, this.rxBuffer.byteOffset + offset, 12);
            const rx = rView.getUint16(0);
            const ry = rView.getUint16(2);
            const rw = rView.getUint16(4);
            const rh = rView.getUint16(6);
            const enc = rView.getInt32(8);

            const bytesPerPixel = Math.max(1, Math.floor(this.bpp / 8));
            const dataLen = rw * rh * bytesPerPixel;

            if (this.rxBuffer.length < offset + 12 + dataLen) {
              parsedAll = false;
              break;
            }

            if (enc === 0 && rw > 0 && rh > 0) {
              // Raw Encoding: copy pixels
              const pixelData = this.rxBuffer.subarray(offset + 12, offset + 12 + dataLen);
              this._renderRawRect(rx, ry, rw, rh, pixelData);
            }

            offset += 12 + dataLen;
          }

          if (!parsedAll) return; // Wait for complete packet

          this._consumeBytes(offset);
          this.reqPending = false;
          // Request next incremental update
          this._sendUpdateRequest(1, 0, 0, this.width, this.height);
          continue;
        } else {
          // Unknown or unhandled message type: drop leading byte to recover
          this._consumeBytes(1);
        }
      }
    }
  }

  _renderRawRect(rx, ry, rw, rh, data) {
    try {
      const imgData = this.ctx.createImageData(rw, rh);
      const dst = imgData.data;
      const totalPixels = rw * rh;

      if (this.bpp === 32) {
        let srcIdx = 0;
        let dstIdx = 0;
        for (let i = 0; i < totalPixels; i++) {
          // X11 BGRX format to HTML5 RGBA
          const b = data[srcIdx];
          const g = data[srcIdx + 1];
          const r = data[srcIdx + 2];
          dst[dstIdx] = r;
          dst[dstIdx + 1] = g;
          dst[dstIdx + 2] = b;
          dst[dstIdx + 3] = 255;
          srcIdx += 4;
          dstIdx += 4;
        }
      } else {
        // Fallback copy
        for (let i = 0; i < data.length && i < dst.length; i++) {
          dst[i] = data[i];
        }
      }

      this.ctx.putImageData(imgData, rx, ry);
    } catch (err) {
      console.warn('[RFB] Draw error:', err.message);
    }
  }

  _sendUpdateRequest(incremental, x, y, w, h) {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const req = new Uint8Array([
      3, incremental, // type 3, incremental flag
      (x >> 8) & 0xFF, x & 0xFF,
      (y >> 8) & 0xFF, y & 0xFF,
      (w >> 8) & 0xFF, w & 0xFF,
      (h >> 8) & 0xFF, h & 0xFF
    ]);
    this.ws.send(req);
    this.reqPending = true;
  }

  _attachInputListeners() {
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('keydown', this._onKeyDown);
    this.canvas.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  _detachInputListeners() {
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('keydown', this._onKeyDown);
    this.canvas.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
  }

  _getCanvasCoordinates(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const x = Math.max(0, Math.min(this.width - 1, Math.round((e.clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(this.height - 1, Math.round((e.clientY - rect.top) * scaleY)));
    return { x, y };
  }

  _handleMouseDown(e) {
    this.canvas.focus();
    if (e.button === 0) this.mouseButtonMask |= 1; // Left
    if (e.button === 1) this.mouseButtonMask |= 2; // Middle
    if (e.button === 2) this.mouseButtonMask |= 4; // Right
    const { x, y } = this._getCanvasCoordinates(e);
    this._sendPointerEvent(x, y, this.mouseButtonMask);
  }

  _handleMouseUp(e) {
    if (e.button === 0) this.mouseButtonMask &= ~1;
    if (e.button === 1) this.mouseButtonMask &= ~2;
    if (e.button === 2) this.mouseButtonMask &= ~4;
    const { x, y } = this._getCanvasCoordinates(e);
    this._sendPointerEvent(x, y, this.mouseButtonMask);
  }

  _handleMouseMove(e) {
    const { x, y } = this._getCanvasCoordinates(e);
    this._sendPointerEvent(x, y, this.mouseButtonMask);
  }

  _getKeySym(e) {
    if (e.key === 'Backspace') return 0xff08;
    if (e.key === 'Tab') return 0xff09;
    if (e.key === 'Enter') return 0xff0d;
    if (e.key === 'Escape') return 0xff1b;
    if (e.key === 'Delete') return 0xffff;
    if (e.key === 'ArrowLeft') return 0xff51;
    if (e.key === 'ArrowUp') return 0xff52;
    if (e.key === 'ArrowRight') return 0xff53;
    if (e.key === 'ArrowDown') return 0xff54;
    if (e.key.length === 1) return e.key.charCodeAt(0);
    return null;
  }

  _handleKeyDown(e) {
    const keysym = this._getKeySym(e);
    if (keysym !== null) {
      this._sendKeyEvent(1, keysym);
      if (['Backspace', 'Tab', 'Enter', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
      }
    }
  }

  _handleKeyUp(e) {
    const keysym = this._getKeySym(e);
    if (keysym !== null) {
      this._sendKeyEvent(0, keysym);
    }
  }

  _sendKeyEvent(downFlag, keysym) {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = new Uint8Array([
      4, downFlag, 0, 0,
      (keysym >> 24) & 0xFF,
      (keysym >> 16) & 0xFF,
      (keysym >> 8) & 0xFF,
      keysym & 0xFF
    ]);
    this.ws.send(msg);
  }

  _sendPointerEvent(x, y, buttonMask) {
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = new Uint8Array([
      5, buttonMask, // type = 5, buttonMask
      (x >> 8) & 0xFF, x & 0xFF,
      (y >> 8) & 0xFF, y & 0xFF
    ]);
    this.ws.send(msg);
  }
}

if (typeof window !== 'undefined') {
  window.SecureLabRfbClient = SecureLabRfbClient;
}
