package monitor

import (
	"fmt"
	"log"
	"os/exec"
)

// NetworkGuard uses iptables to restrict outbound traffic to the exam
// server only.  Call Enforce() at startup and Release() on exit.
// Requires root privileges.
type NetworkGuard struct {
	serverIP string
}

func NewNetworkGuard(serverIP string) *NetworkGuard {
	return &NetworkGuard{serverIP: serverIP}
}

// Enforce applies iptables OUTPUT rules:
//  1. Allow loopback
//  2. Allow exam server (by IP)
//  3. Drop everything else
func (g *NetworkGuard) Enforce() error {
	if g.serverIP == "" {
		return fmt.Errorf("network guard: allowed_server_ip is empty")
	}

	rules := [][]string{
		// Allow loopback traffic
		{"-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"},
		// Allow established/related connections
		{"-A", "OUTPUT", "-m", "state", "--state", "ESTABLISHED,RELATED", "-j", "ACCEPT"},
		// Allow DNS so the server hostname resolves
		{"-A", "OUTPUT", "-p", "udp", "--dport", "53", "-j", "ACCEPT"},
		// Allow the exam server
		{"-A", "OUTPUT", "-d", g.serverIP, "-j", "ACCEPT"},
		// Drop everything else
		{"-A", "OUTPUT", "-j", "DROP"},
	}

	for _, args := range rules {
		cmd := exec.Command("iptables", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("iptables %v: %v — %s", args, err, string(out))
		}
	}
	log.Printf("[network] outbound traffic locked to %s", g.serverIP)
	return nil
}

// Release flushes the OUTPUT chain, restoring normal network access.
func (g *NetworkGuard) Release() {
	if err := exec.Command("iptables", "-F", "OUTPUT").Run(); err != nil {
		log.Printf("[network] failed to flush iptables OUTPUT: %v", err)
	} else {
		log.Println("[network] iptables OUTPUT chain flushed — network restored")
	}
}
