package monitor

import "time"

// Violation represents a detected integrity breach.
type Violation struct {
	Kind    string    // machine-readable category
	Reason  string    // human-readable summary
	Details string    // extra context
	At      time.Time // when it occurred
}
