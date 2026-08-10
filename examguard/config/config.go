package config

import (
	"encoding/json"
	"os"
	"time"
)

// Config holds all examguard runtime configuration.
type Config struct {
	// Exam server WebSocket URL for sending violation events.
	ServerURL string `json:"server_url"`

	// Student roll number attached to every violation report.
	StudentRoll string `json:"student_roll"`

	// Exam ID attached to every violation report.
	ExamID string `json:"exam_id"`

	// The window title that must remain focused during the exam.
	AppWindowTitle string `json:"app_window_title"`

	// DISPLAY environment variable for X11 tools (e.g. ":0").
	Display string `json:"display"`

	// Path to the XAUTHORITY file, needed when running as root.
	XAuthority string `json:"xauthority"`

	// Interval for focus and process polling.
	PollInterval duration `json:"poll_interval_ms"`

	// When true, iptables rules are applied to block non-exam traffic.
	BlockNetwork bool `json:"block_network"`

	// IP address of the exam server (used for iptables allow-list).
	AllowedServerIP string `json:"allowed_server_ip"`

	// Full path to the exam client binary to launch and watch.
	ExamAppBinary string `json:"exam_app_binary"`

	// Arguments passed to the exam client binary.
	ExamAppArgs []string `json:"exam_app_args"`
}

// duration is a time.Duration that marshals from milliseconds in JSON.
type duration struct{ time.Duration }

func (d *duration) UnmarshalJSON(b []byte) error {
	var ms int64
	if err := json.Unmarshal(b, &ms); err != nil {
		return err
	}
	d.Duration = time.Duration(ms) * time.Millisecond
	return nil
}

// Load reads config from path; missing file returns sensible defaults.
func Load(path string) (*Config, error) {
	cfg := &Config{
		ServerURL:      "ws://localhost:8080/api/v1/ws",
		AppWindowTitle: "SecureMLExam",
		Display:        ":0",
		PollInterval:   duration{500 * time.Millisecond},
		BlockNetwork:   false,
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}
	defer f.Close()
	if err := json.NewDecoder(f).Decode(cfg); err != nil {
		return nil, err
	}
	if cfg.PollInterval.Duration == 0 {
		cfg.PollInterval = duration{500 * time.Millisecond}
	}
	return cfg, nil
}
