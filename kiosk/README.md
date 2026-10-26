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
- A Wayland client cannot grab global input or veto window/workspace switches.

So instead of fighting the compositor, we **remove GNOME Shell from the exam
session entirely**. The exam app becomes the only client of a minimal X11 +
openbox session. There is no overview, no workspaces, no Alt+Tab target, and no
gesture handler — **there is nothing to switch to.**

The `examguard` daemon stays as a *detection/audit* layer (USB, rogue processes,
violation log); prevention lives at the session layer where it is enforceable.

## What gets installed

A single GDM session, **"SecureLab Exam (Kiosk)"**, built on **Xorg + openbox**.
Electron renders reliably on X11; the exam app owns its own fullscreen
(`SECURELAB_KIOSK=1`) and openbox strips its decorations (matched by the
`SecureLabExam` WM class). It runs your existing [`run.sh`](../run.sh) (git
auto-update + `npm start`) unchanged — just as the only thing on screen.

Files installed to `/opt/securelab-kiosk/`:
- `launch-x11.sh` — the session entry point
- `kiosk.env` — records the repo path and kiosk user
- `openbox-rc.xml` — fallback copy of the locked WM config (the launcher
  prefers the repo copy so WM tweaks ship via `git pull`)
- `kiosk-exam-mode.sh` / `kiosk-admin-mode.sh` — autologin toggles

GDM session entry: `/usr/share/xsessions/securelab-kiosk-x11.desktop`.

## Install

Run from the **exam user's** account (the one that already has the repo, Node,
the Python venv and the MySQL `exam_user`):

```bash
sudo bash kiosk/install-kiosk.sh            # install, autologin OFF
# ...verify it works (see below), then:
sudo /opt/securelab-kiosk/kiosk-exam-mode.sh   # arm autologin
sudo systemctl restart gdm
```

Or in one shot: `sudo bash kiosk/install-kiosk.sh --autologin`.

Normally you do not run this directly — `bash setup_new_pc.sh` runs it for you as
the last step of provisioning a machine.

## Verify before arming autologin

1. `sudo systemctl restart gdm` (or reboot).
2. At the GDM greeter, select the exam user; the default session is now
   **SecureLab Exam (Kiosk)**. Log in.
3. The exam app should fill the screen with working mouse + keyboard. Confirm you
   cannot Alt+Tab / swipe / minimize to anything.
4. Exit the app → you should land back at the GDM greeter.

## Student GUI programs

Java Swing/AWT, Python Tkinter/Qt and C/C++ GUI programs open as **real native
windows** on top of the exam app (the exam window steps aside while they run;
see `enterGuiMode`/`exitGuiMode` in [`src/kiosk.js`](../src/kiosk.js)). This is
safe because the session is locked — there is nothing to switch to. Student
windows keep a normal title bar + close button; the exam app stays bare.

## Maintenance escape hatch

With autologin on, VT switching is restricted, so to get back to a normal desktop
for updates/imaging:

```bash
ssh adminuser@lab-pc
sudo /opt/securelab-kiosk/kiosk-admin-mode.sh   # disables autologin
sudo systemctl restart gdm
# At the greeter, gear icon -> "Ubuntu"
```

Re-arm exam mode with `sudo /opt/securelab-kiosk/kiosk-exam-mode.sh`.

A backup of every file we edit is written next to it with a `.securelab.bak`
suffix (`/etc/gdm3/custom.conf.securelab.bak`, the AccountsService user file).

## Notes & limitations

- `xserver-xorg`, `xinit`, `openbox` and `picom` come from Ubuntu's repos; the
  installer (and `setup_env.sh`) install them.
- **picom is off by default.** Electron owns its own fullscreen, which paints on
  bare X without a compositor, and picom's overlay can swallow mouse clicks. If a
  specific machine comes up black, set `SECURELAB_USE_PICOM=1` in
  `/opt/securelab-kiosk/kiosk.env`.
- **Ctrl+Alt+F* VT switching** is an X-server feature openbox cannot block. For
  dedicated exam machines you can harden it with
  `/etc/X11/xorg.conf.d/10-securelab-novt.conf`:
  ```
  Section "ServerFlags"
      Option "DontVTSwitch" "true"
      Option "DontZap" "true"
  EndSection
  ```
  This affects all X11 sessions on the machine, so only apply it where the admin
  logs in via the Wayland "Ubuntu" session.
