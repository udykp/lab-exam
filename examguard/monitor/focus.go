package monitor

import (
	"os/exec"
	"strings"
	"time"
)

// FocusMonitor polls the active window name on X11/GNOME Wayland
// and emits a Violation whenever the exam application is not in focus.
type FocusMonitor struct {
	appTitle string
	display  string
	out      chan<- Violation
	stop     chan struct{}
}

func NewFocusMonitor(appTitle, display string, out chan<- Violation) *FocusMonitor {
	return &FocusMonitor{
		appTitle: appTitle,
		display:  display,
		out:      out,
		stop:     make(chan struct{}),
	}
}

func (m *FocusMonitor) Start() {
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-ticker.C:
				m.check()
			}
		}
	}()
}

func (m *FocusMonitor) Stop() { close(m.stop) }

func (m *FocusMonitor) check() {
	name, err := m.getActiveWindowName()
	if err != nil || name == "" {
		return
	}
	if !strings.Contains(strings.ToLower(name), strings.ToLower(m.appTitle)) {
		m.out <- Violation{
			Kind:    "focus_lost",
			Reason:  "Application Lost Focus",
			Details: "Active window: " + name,
			At:      time.Now(),
		}
	}
}

// getActiveWindowName tries xdotool (X11) first, then gdbus (GNOME Wayland).
func (m *FocusMonitor) getActiveWindowName() (string, error) {
	env := []string{"DISPLAY=" + m.display}

	// X11 path via xdotool
	cmd := exec.Command("xdotool", "getactivewindow", "getwindowname")
	cmd.Env = append(cmd.Env, env...)
	if out, err := cmd.Output(); err == nil {
		return strings.TrimSpace(string(out)), nil
	}

	// GNOME Wayland path via gdbus
	cmd2 := exec.Command("gdbus", "call", "--session",
		"--dest", "org.gnome.Shell",
		"--object-path", "/org/gnome/Shell",
		"--method", "org.gnome.Shell.Eval",
		"global.display.focus_window ? global.display.focus_window.get_title() : ''",
	)
	cmd2.Env = append(cmd2.Env, env...)
	if out, err := cmd2.Output(); err == nil {
		// gdbus returns: ('result', true)\n — strip wrapper
		s := strings.TrimSpace(string(out))
		s = strings.Trim(s, "()'\" ,\n\r")
		return s, nil
	}

	return "", nil
}
