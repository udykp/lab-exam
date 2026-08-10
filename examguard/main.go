package main

import (
	"examguard/config"
	"examguard/ipc"
	"examguard/monitor"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	log.SetPrefix("[examguard] ")
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Println("============================================================")
	log.Println("  ExamGuard — Secure Exam Monitoring Daemon")
	log.Println("============================================================")

	// ── Configuration ────────────────────────────────────────────────────
	cfgPath := "/etc/examguard/config.json"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	log.Printf("config loaded from %s", cfgPath)
	log.Printf("student=%s  exam=%s  server=%s", cfg.StudentRoll, cfg.ExamID, cfg.ServerURL)

	// Set display env for X11 tools used by child goroutines
	if cfg.Display != "" {
		os.Setenv("DISPLAY", cfg.Display)
	}
	if cfg.XAuthority != "" {
		os.Setenv("XAUTHORITY", cfg.XAuthority)
	}

	// ── Violation channel ────────────────────────────────────────────────
	// All monitors write here; the dispatch goroutine reads and forwards.
	violations := make(chan monitor.Violation, 128)

	// ── IPC client ───────────────────────────────────────────────────────
	client := ipc.NewClient(cfg.ServerURL, cfg.StudentRoll, cfg.ExamID)
	client.Connect()

	// ── Optional: network lock-down ──────────────────────────────────────
	var netGuard *monitor.NetworkGuard
	if cfg.BlockNetwork && cfg.AllowedServerIP != "" {
		netGuard = monitor.NewNetworkGuard(cfg.AllowedServerIP)
		if err := netGuard.Enforce(); err != nil {
			log.Printf("network guard: %v", err)
		}
	}

	// ── Start all monitors ───────────────────────────────────────────────
	monitors := []interface{ Stop() }{
		startAndReturn(monitor.NewFocusMonitor(cfg.AppWindowTitle, cfg.Display, violations)),
		startAndReturn(monitor.NewUSBMonitor(violations)),
		startAndReturn(monitor.NewProcessMonitor(violations)),
		startAndReturn(monitor.NewDisplayMonitor(cfg.Display, violations)),
		startAndReturn(monitor.NewKeyboardMonitor(violations)),
	}
	log.Println("all monitors started")

	// ── Launch exam client (optional) ────────────────────────────────────
	var appCmd *exec.Cmd
	if cfg.ExamAppBinary != "" {
		appCmd = exec.Command(cfg.ExamAppBinary, cfg.ExamAppArgs...)
		appCmd.Stdout = os.Stdout
		appCmd.Stderr = os.Stderr
		if err := appCmd.Start(); err != nil {
			log.Printf("could not launch exam app: %v", err)
		} else {
			log.Printf("exam app started  PID=%d", appCmd.Process.Pid)
			// Watchdog: if the student kills the app, report it and
			// optionally restart it.
			go watchApp(appCmd, violations, cfg)
		}
	}

	// ── Violation dispatch loop ───────────────────────────────────────────
	go dispatchViolations(violations, client)

	// ── OS signal handling ────────────────────────────────────────────────
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	<-sigs

	log.Println("shutting down...")
	for _, m := range monitors {
		m.Stop()
	}
	if appCmd != nil && appCmd.Process != nil {
		_ = appCmd.Process.Kill()
	}
	if netGuard != nil {
		netGuard.Release()
	}
	log.Println("done.")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type starter interface {
	Start()
	Stop()
}

func startAndReturn(m starter) starter {
	m.Start()
	return m
}

// dispatchViolations reads from the violation channel, de-duplicates rapid
// repeats (same kind within 10 s), logs each one, and forwards to the IPC
// client.
func dispatchViolations(violations <-chan monitor.Violation, client *ipc.Client) {
	last := make(map[string]time.Time)
	for v := range violations {
		if t, ok := last[v.Kind]; ok && time.Since(t) < 10*time.Second {
			continue // suppress duplicates
		}
		last[v.Kind] = time.Now()
		log.Printf("⚠  VIOLATION  [%-22s]  %s — %s", v.Kind, v.Reason, v.Details)
		client.SendViolation(v.Kind, v.Reason, v.Details)
	}
}

// watchApp waits for the exam app process to exit, then sends a violation.
// If the config specifies a binary, it will attempt to restart the app
// (watchdog behaviour — mirrors antivirus mutual-watch patterns).
func watchApp(cmd *exec.Cmd, violations chan<- monitor.Violation, cfg *config.Config) {
	_ = cmd.Wait()

	violations <- monitor.Violation{
		Kind:    "app_closed",
		Reason:  "Exam Application Closed",
		Details: "Process exited unexpectedly",
		At:      time.Now(),
	}
	log.Println("exam app exited — restarting in 2 s (watchdog)")
	time.Sleep(2 * time.Second)

	restarted := exec.Command(cfg.ExamAppBinary, cfg.ExamAppArgs...)
	restarted.Stdout = os.Stdout
	restarted.Stderr = os.Stderr
	if err := restarted.Start(); err != nil {
		log.Printf("watchdog: restart failed: %v", err)
		return
	}
	log.Printf("watchdog: exam app restarted  PID=%d", restarted.Process.Pid)
	go watchApp(restarted, violations, cfg) // recursive watchdog
}
