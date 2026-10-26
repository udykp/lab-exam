# SecureLab Kiosk Session

This directory turns a lab machine into a **true single-application kiosk** for
exams. It is the real fix for the problem that students can switch away from the
exam window with keyboard shortcuts or touchpad gestures.

## Why this exists (read this first)

The in-app lockdown in [`src/kiosk.js`](../src/kiosk.js) tries to block shortcuts
and gestures from *inside* the Electron app. On **Wayland + GNOME Shell** this can
never be fully effective:

- `before-input-event` only fires while the app has focus — it cannot block the
  gesture/shortcut that *takes* focus away.
- Touchpad workspace-switch gestures are handled entirely by GNOME Shell / mutter.
  The app never receives them, so it cannot cancel them.
- A Wayland client cannot grab global input or veto window/workspace switches.
  The compositor owns input routing by design.

So instead of fighting the compositor, we **remove GNOME Shell from the exam
session entirely**. The exam app becomes the only client of a minimal kiosk
compositor. There is no overview, no workspaces, no Alt+Tab target, and no
gesture handler — **there is nothing to switch to.**

The existing `examguard` daemon stays as a *detection/audit* layer (USB, rogue
processes, violation log); prevention now lives at the session layer where it is
actually enforceable.

## What gets installed

| Session (pick at GDM gear icon)          | Backend           | Role      |
|------------------------------------------|-------------------|-----------|
| **SecureLab Exam (Kiosk)**               | `cage` (Wayland)  | Primary   |
| **SecureLab Exam (Kiosk X11 fallback)**  | `openbox` (X11)   | Fallback  |

Both sessions run your existing [`run.sh`](../run.sh) (git auto-update +
`npm start`) unchanged — just wrapped so that it is the only thing on screen.

Files installed to `/opt/securelab-kiosk/`:
- `launch-cage.sh` / `launch-x11.sh` — session entry points
- `openbox-rc.xml` — locked Openbox config (all WM shortcuts removed)
- `kiosk.env` — records the repo path and kiosk user
- `kiosk-exam-mode.sh` / `kiosk-admin-mode.sh` — autologin toggles

GDM session entries:
- `/usr/share/wayland-sessions/securelab-kiosk-cage.desktop`
- `/usr/share/xsessions/securelab-kiosk-x11.desktop`

## Install

Run from the **exam user's** account (the one that already has the repo, Node,
the Python venv and the MySQL `exam_user`):

```bash
sudo bash kiosk/install-kiosk.sh            # install, autologin OFF
# ...verify it works (see below), then:
sudo /opt/securelab-kiosk/kiosk-exam-mode.sh   # arm autologin
sudo systemctl restart gdm
```

Or install and arm autologin in one shot:

```bash
sudo bash kiosk/install-kiosk.sh --autologin
sudo systemctl restart gdm
```

## Verify before arming autologin

1. `sudo systemctl restart gdm` (or reboot).
2. At the GDM greeter, select the exam user; the default session is now
   **SecureLab Exam (Kiosk)**. Log in.
3. The exam app should fill the screen. Confirm you **cannot**:
   - Alt+Tab / Super / overview to anything,
   - 3- or 4-finger swipe to another workspace,
   - minimize, move, or close to a desktop.
4. Exit the app normally → you should land back at the GDM greeter.

If cage has trouble on some hardware (blank screen, GPU quirk), pick
**SecureLab Exam (Kiosk X11 fallback)** at the gear icon instead.

## Maintenance escape hatch

With autologin on, VT switching is locked under cage, so to get back to a normal
desktop for updates/imaging:

```bash
# From another machine:
ssh adminuser@lab-pc
sudo /opt/securelab-kiosk/kiosk-admin-mode.sh   # disables autologin
sudo systemctl restart gdm
# At the greeter, gear icon -> "Ubuntu"
```

Re-arm exam mode afterwards with `sudo /opt/securelab-kiosk/kiosk-exam-mode.sh`.

A backup of every file we edit is written next to it with a `.securelab.bak`
suffix (`/etc/gdm3/custom.conf.securelab.bak`,
`/var/lib/AccountsService/users/<user>.securelab.bak`).

## Notes & limitations

- **cage / openbox** come from Ubuntu's `universe` repo; the installer runs
  `apt-get install cage openbox`.
- The **X11 fallback cannot block Ctrl+Alt+F* VT switching** (that is an X-server
  feature, not a WM one). For dedicated exam machines you can harden it by
  dropping a file at `/etc/X11/xorg.conf.d/10-securelab-novt.conf` containing:
  ```
  Section "ServerFlags"
      Option "DontVTSwitch" "true"
      Option "DontZap" "true"
  EndSection
  ```
  This affects all X11 sessions on the machine, so only do it where the admin
  logs in via the Wayland "Ubuntu" session. The primary **cage** session already
  blocks VT switching with no extra config.
- The in-app GUI runner (student Swing/tkinter/Qt code) uses its own private
  `Xvfb` display, so it is unaffected by whether the outer session is cage or X11.
