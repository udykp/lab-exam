package monitor

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// KeyboardMonitor reads raw evdev input events from all keyboard devices
// under /dev/input/event* (requires root or membership in the 'input' group).
// It intercepts blocked key combos and emits a Violation for each one.
type KeyboardMonitor struct {
	out  chan<- Violation
	stop chan struct{}
}

func NewKeyboardMonitor(out chan<- Violation) *KeyboardMonitor {
	return &KeyboardMonitor{out: out, stop: make(chan struct{})}
}

func (m *KeyboardMonitor) Start() {
	keyboards := findKeyboardDevices()
	if len(keyboards) == 0 {
		return // no evdev access — skip silently
	}
	for _, dev := range keyboards {
		go m.readDevice(dev)
	}
}

func (m *KeyboardMonitor) Stop() { close(m.stop) }

// findKeyboardDevices returns /dev/input/event* paths whose sysfs name
// contains "keyboard" or "kbd".
func findKeyboardDevices() []string {
	var result []string
	matches, _ := filepath.Glob("/dev/input/event*")
	for _, dev := range matches {
		// /dev/input/eventN  →  /sys/class/input/eventN/device/name
		base := filepath.Base(dev) // e.g. "event3"
		namePath := filepath.Join("/sys/class/input", base, "device/name")
		data, err := os.ReadFile(namePath)
		if err != nil {
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(string(data)))
		if strings.Contains(lower, "keyboard") || strings.Contains(lower, "kbd") {
			result = append(result, dev)
		}
	}
	return result
}

// Linux input_event (struct) layout on 64-bit:
//   time_t  sec   (8 bytes)
//   time_t  usec  (8 bytes)
//   __u16   type  (2 bytes)
//   __u16   code  (2 bytes)
//   __s32   value (4 bytes)
// Total = 24 bytes
const inputEventSize = 24

const (
	evKey   = 1
	keyDown = 1

	// Key codes (Linux input event codes)
	keyEsc      = 1
	keyTab      = 15
	keyT        = 20
	keyF2       = 60
	keyF4       = 62
	keyF5       = 63
	keyDelete   = 111
	keyLCtrl    = 29
	keyRCtrl    = 97
	keyLShift   = 42
	keyRShift   = 54
	keyLAlt     = 56
	keyRAlt     = 100
	keyLMeta    = 125 // Super / Windows key
	keyRMeta    = 126
)

func (m *KeyboardMonitor) readDevice(devPath string) {
	f, err := os.Open(devPath)
	if err != nil {
		return
	}
	defer f.Close()

	pressed := make(map[uint16]bool)
	buf := make([]byte, inputEventSize)

	for {
		select {
		case <-m.stop:
			return
		default:
		}

		// 1s read deadline so we can honour the stop channel
		f.SetReadDeadline(time.Now().Add(time.Second))
		n, err := f.Read(buf)
		if err != nil || n != inputEventSize {
			continue
		}

		evType := uint16(buf[16]) | uint16(buf[17])<<8
		code := uint16(buf[18]) | uint16(buf[19])<<8
		value := int32(buf[20]) | int32(buf[21])<<8 | int32(buf[22])<<16 | int32(buf[23])<<24

		if evType != evKey {
			continue
		}

		switch value {
		case 1: // key down
			pressed[code] = true
		case 0: // key up
			delete(pressed, code)
		}

		if value != keyDown {
			continue
		}

		reason := blockedCombo(code, pressed)
		if reason != "" {
			m.out <- Violation{
				Kind:    "blocked_shortcut",
				Reason:  "Blocked Keyboard Shortcut",
				Details: reason,
				At:      time.Now(),
			}
		}
	}
}

// blockedCombo returns a human-readable description if the current key-press
// matches a blocked combination, or "" if it is allowed.
func blockedCombo(code uint16, pressed map[uint16]bool) string {
	alt := pressed[keyLAlt] || pressed[keyRAlt]
	ctrl := pressed[keyLCtrl] || pressed[keyRCtrl]
	shift := pressed[keyLShift] || pressed[keyRShift]

	switch {
	case code == keyLMeta || code == keyRMeta:
		return "Super / Windows key (window manager shortcut)"
	case alt && code == keyTab:
		return "Alt+Tab (window switcher)"
	case alt && code == keyF2:
		return "Alt+F2 (run dialog)"
	case alt && code == keyF4:
		return "Alt+F4 (close window)"
	case ctrl && alt && code == keyT:
		return "Ctrl+Alt+T (open terminal)"
	case ctrl && shift && code == keyEsc:
		return "Ctrl+Shift+Esc (task manager)"
	case ctrl && alt && code == keyDelete:
		return "Ctrl+Alt+Delete"
	case code == keyF5:
		return "F5 (page reload)"
	}
	return ""
}
