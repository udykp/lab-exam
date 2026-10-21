#!/usr/bin/env python3
"""
Dedicated Native GUI Window Docker for SecureLab
Positions, docks, strips minimize/decorations, and keeps native GUI windows (Java Swing, Tkinter)
pinned cleanly inside the Electron kiosk application without leaving or breaking the exam.
"""

import sys
import os
import time
import argparse
import subprocess
import ctypes
from ctypes import POINTER, c_void_p, c_ulong, c_int, c_uint, c_char_p, Structure, c_long, byref

# Load libX11
try:
    x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
    x11.XOpenDisplay.restype = c_void_p
    x11.XDefaultRootWindow.restype = c_ulong
    x11.XInternAtom.restype = c_ulong
    x11.XInternAtom.argtypes = [c_void_p, c_char_p, c_int]
    x11.XSetTransientForHint.argtypes = [c_void_p, c_ulong, c_ulong]
    x11.XRaiseWindow.argtypes = [c_void_p, c_ulong]
    x11.XSetInputFocus.argtypes = [c_void_p, c_ulong, c_int, c_ulong]
    x11.XFlush.argtypes = [c_void_p]
    x11.XCloseDisplay.argtypes = [c_void_p]

    class XClientMessageEvent(Structure):
        _fields_ = [
            ('type', c_int),
            ('serial', c_ulong),
            ('send_event', c_int),
            ('display', c_void_p),
            ('window', c_ulong),
            ('message_type', c_ulong),
            ('format', c_int),
            ('data', c_long * 5)
        ]

    class XEvent(ctypes.Union):
        _fields_ = [
            ('type', c_int),
            ('xclient', XClientMessageEvent),
            ('pad', c_long * 24)
        ]

    x11.XSendEvent.argtypes = [c_void_p, c_ulong, c_int, c_long, POINTER(XEvent)]
    x11.XSendEvent.restype = c_int

except Exception as e:
    sys.stderr.write(f"[GUI Docker] Failed to load libX11: {e}\n")
    x11 = None


def find_gui_window(pid, title_hint=None, max_wait_sec=5.0):
    start = time.time()
    while time.time() - start < max_wait_sec:
        try:
            out = subprocess.check_output(['xwininfo', '-root', '-tree'], stderr=subprocess.DEVNULL).decode('utf-8', errors='ignore')
            candidates = []
            for line in out.splitlines():
                line_clean = line.strip()
                if not line_clean.startswith('0x') or 'mutter' in line_clean:
                    continue
                parts = line_clean.split()
                if len(parts) >= 2:
                    try:
                        win_id = int(parts[0], 16)
                        candidates.append((win_id, line_clean))
                    except ValueError:
                        continue

            # Prioritize matching title hint or java/tk class
            for win_id, line_str in candidates:
                if title_hint and title_hint.lower() in line_str.lower():
                    # Validate that window is viewable and has reasonable size
                    try:
                        winfo = subprocess.check_output(['xwininfo', '-id', hex(win_id)], stderr=subprocess.DEVNULL).decode('utf-8', errors='ignore')
                        if 'Map State: IsViewable' in winfo:
                            return win_id
                    except Exception:
                        pass

            # Check for any newly mapped java or tk window
            for win_id, line_str in candidates:
                lower = line_str.lower()
                if 'java' in lower or 'swing' in lower or 'tk' in lower or 'frame' in lower:
                    try:
                        winfo = subprocess.check_output(['xwininfo', '-id', hex(win_id)], stderr=subprocess.DEVNULL).decode('utf-8', errors='ignore')
                        if 'Map State: IsViewable' in winfo:
                            w_val = int([l.split()[-1] for l in winfo.splitlines() if 'Width:' in l][0])
                            h_val = int([l.split()[-1] for l in winfo.splitlines() if 'Height:' in l][0])
                            if w_val >= 100 and h_val >= 100:
                                return win_id
                    except Exception:
                        pass

        except Exception:
            pass
        time.sleep(0.15)
    return None


def activate_window(win_id):
    if not x11 or not win_id:
        return False
    d = x11.XOpenDisplay(None)
    if not d:
        return False
    try:
        root = x11.XDefaultRootWindow(d)
        net_active = x11.XInternAtom(d, b'_NET_ACTIVE_WINDOW', 0)
        ev = XEvent()
        ev.type = 33
        ev.xclient.window = win_id
        ev.xclient.message_type = net_active
        ev.xclient.format = 32
        ev.xclient.data[0] = 1
        ev.xclient.data[1] = 0
        x11.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), byref(ev))
        x11.XRaiseWindow(d, win_id)
        x11.XFlush(d)
        return True
    finally:
        x11.XCloseDisplay(d)


def dock_window(win_id, parent_xid, x, y, width, height):
    if not x11 or not win_id:
        return False

    # 1. Strip decorations (remove minimize, maximize, and titlebar)
    try:
        subprocess.call([
            'xprop', '-id', hex(win_id),
            '-f', '_MOTIF_WM_HINTS', '32c',
            '-set', '_MOTIF_WM_HINTS', '2, 0, 0, 0, 0'
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    d = x11.XOpenDisplay(None)
    if not d:
        return False

    try:
        root = x11.XDefaultRootWindow(d)

        # 2. Set _NET_WM_STATE_ABOVE (keep pinned on top of Electron)
        net_wm_state = x11.XInternAtom(d, b'_NET_WM_STATE', 0)
        net_wm_state_above = x11.XInternAtom(d, b'_NET_WM_STATE_ABOVE', 0)

        ev_above = XEvent()
        ev_above.type = 33
        ev_above.xclient.window = win_id
        ev_above.xclient.message_type = net_wm_state
        ev_above.xclient.format = 32
        ev_above.xclient.data[0] = 1 # _NET_WM_STATE_ADD
        ev_above.xclient.data[1] = net_wm_state_above
        ev_above.xclient.data[2] = 0
        ev_above.xclient.data[3] = 1
        ev_above.xclient.data[4] = 0
        x11.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), byref(ev_above))

        # 3. Set Transient For parent (Electron)
        if parent_xid:
            try:
                x11.XSetTransientForHint(d, win_id, parent_xid)
            except Exception:
                pass

        # 4. Move and resize to docked viewport position
        if width > 0 and height > 0:
            net_moveresize = x11.XInternAtom(d, b'_NET_MOVERESIZE_WINDOW', 0)
            ev_resize = XEvent()
            ev_resize.type = 33
            ev_resize.xclient.window = win_id
            ev_resize.xclient.message_type = net_moveresize
            ev_resize.xclient.format = 32
            ev_resize.xclient.data[0] = 0x0f00 | (1 << 12) # source application, gravity 0
            ev_resize.xclient.data[1] = int(x)
            ev_resize.xclient.data[2] = int(y)
            ev_resize.xclient.data[3] = int(width)
            ev_resize.xclient.data[4] = int(height)
            x11.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), byref(ev_resize))

        # 5. Activate and Raise
        net_active = x11.XInternAtom(d, b'_NET_ACTIVE_WINDOW', 0)
        ev_act = XEvent()
        ev_act.type = 33
        ev_act.xclient.window = win_id
        ev_act.xclient.message_type = net_active
        ev_act.xclient.format = 32
        ev_act.xclient.data[0] = 1
        ev_act.xclient.data[1] = 0
        x11.XSendEvent(d, root, 0, (1 << 20) | (1 << 19), byref(ev_act))
        x11.XRaiseWindow(d, win_id)

        x11.XFlush(d)
        return True
    finally:
        x11.XCloseDisplay(d)


def main():
    parser = argparse.ArgumentParser(description="SecureLab GUI Window Docker")
    parser.add_argument('--pid', type=int, default=0, help="PID of the spawned GUI process")
    parser.add_argument('--parent', type=lambda s: int(s, 0), default=0, help="Parent Electron window XID")
    parser.add_argument('--x', type=int, default=100, help="Target X coordinate")
    parser.add_argument('--y', type=int, default=100, help="Target Y coordinate")
    parser.add_argument('--width', type=int, default=450, help="Target width")
    parser.add_argument('--height', type=int, default=450, help="Target height")
    parser.add_argument('--title-hint', type=str, default="", help="Window title hint to match")
    parser.add_argument('--refocus', type=lambda s: int(s, 0), default=0, help="Refocus existing window ID")

    args = parser.parse_args()

    if args.refocus:
        success = activate_window(args.refocus)
        print(f'{{"success": {str(success).lower()}, "win_id": "{hex(args.refocus)}"}}')
        return

    win_id = find_gui_window(args.pid, args.title_hint)
    if not win_id:
        print('{"success": false, "error": "Window not found"}')
        sys.exit(1)

    ok = dock_window(win_id, args.parent, args.x, args.y, args.width, args.height)
    print(f'{{"success": {str(ok).lower()}, "win_id": "{hex(win_id)}"}}')


if __name__ == '__main__':
    main()
