package monitor

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Blacklist of process names (comm) that must not run during an exam.
// Entries are matched case-insensitively against /proc/<pid>/comm.
var BlacklistedProcesses = []string{
	// Browsers
	"firefox", "firefox-esr", "firefox-bin",
	"google-chrome", "chrome", "chromium", "chromium-browser",
	"brave", "brave-browser",
	"vivaldi", "vivaldi-bin",
	"opera",
	"epiphany", "midori", "falkon",

	// AI / Chat applications
	"discord", "telegram-desktop", "signal-desktop",
	"slack", "teams", "element-desktop",

	// IDEs / Code editors (alternative editors)
	"code", "code-oss", "codium",
	"cursor",
	"zed", "zed-editor",
	"gedit", "kate", "mousepad", "xed",
	"sublime_text", "atom",

	// Terminal emulators
	"bash", "zsh", "fish", "sh", "dash",
	"gnome-terminal", "gnome-terminal-", // hyphenated variant
	"xterm", "xfce4-terminal",
	"alacritty", "kitty", "tilix",
	"konsole", "terminator",
	"rxvt", "urxvt",

	// Remote access
	"ssh", "scp", "sftp",
	"rdesktop", "xfreerdp", "remmina",
	"vnc", "vncviewer", "tigervnc",
	"teamviewer", "anydesk",

	// Screen capture / recording
	"obs", "obs-studio",
	"kazam", "simplescreenrecorder",
	"peek", "byzanz-record",
	"flameshot", "scrot", "gnome-screenshot",
	"recordmydesktop",

	// File managers (to block file browsing)
	"nautilus", "thunar", "dolphin", "nemo", "pcmanfm",

	// Miscellaneous
	"wireshark",
}

// ProcessMonitor scans /proc every second for blacklisted processes.
type ProcessMonitor struct {
	out  chan<- Violation
	stop chan struct{}
}

func NewProcessMonitor(out chan<- Violation) *ProcessMonitor {
	return &ProcessMonitor{out: out, stop: make(chan struct{})}
}

func (m *ProcessMonitor) Start() {
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-ticker.C:
				m.scan()
			}
		}
	}()
}

func (m *ProcessMonitor) Stop() { close(m.stop) }

func (m *ProcessMonitor) scan() {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid := entry.Name()
		// Skip non-numeric entries
		if pid[0] < '0' || pid[0] > '9' {
			continue
		}

		commPath := filepath.Join("/proc", pid, "comm")
		data, err := os.ReadFile(commPath)
		if err != nil {
			continue
		}
		comm := strings.TrimSpace(string(data))

		for _, bad := range BlacklistedProcesses {
			if strings.EqualFold(comm, bad) {
				m.out <- Violation{
					Kind:    "blacklisted_process",
					Reason:  "Blacklisted Application Detected",
					Details: comm + " (PID " + pid + ")",
					At:      time.Now(),
				}
				return // one violation per scan cycle is enough
			}
		}
	}
}
