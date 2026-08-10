package monitor

import (
	"os/exec"
	"strings"
	"time"
)

// DisplayMonitor polls xrandr every 3 seconds and emits a violation
// when more than one display is connected (second monitor / projector).
type DisplayMonitor struct {
	display string
	out     chan<- Violation
	stop    chan struct{}
}

func NewDisplayMonitor(display string, out chan<- Violation) *DisplayMonitor {
	return &DisplayMonitor{display: display, out: out, stop: make(chan struct{})}
}

func (m *DisplayMonitor) Start() {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
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

func (m *DisplayMonitor) Stop() { close(m.stop) }

func (m *DisplayMonitor) check() {
	count, names, err := m.connectedDisplays()
	if err != nil || count <= 1 {
		return
	}
	m.out <- Violation{
		Kind:    "multi_display",
		Reason:  "Multiple Monitors Detected",
		Details: strings.Join(names, ", "),
		At:      time.Now(),
	}
}

// connectedDisplays parses xrandr --query output and returns the number
// of connected outputs and their names.
func (m *DisplayMonitor) connectedDisplays() (int, []string, error) {
	cmd := exec.Command("xrandr", "--query")
	cmd.Env = []string{"DISPLAY=" + m.display}
	out, err := cmd.Output()
	if err != nil {
		// Try without DISPLAY override in case we're in a normal session
		out, err = exec.Command("xrandr", "--query").Output()
		if err != nil {
			return 0, nil, err
		}
	}

	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, " connected") {
			parts := strings.Fields(line)
			if len(parts) > 0 {
				names = append(names, parts[0])
			}
		}
	}
	return len(names), names, nil
}
