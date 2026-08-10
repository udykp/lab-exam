package monitor

import (
	"bufio"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// USBMonitor listens for USB mass-storage devices being inserted.
// It uses a Linux netlink socket (AF_NETLINK, NETLINK_KOBJECT_UEVENT)
// to receive udev kernel events in real time.  If that fails (e.g. the
// process does not run as root), it falls back to polling lsblk every
// two seconds.
type USBMonitor struct {
	out  chan<- Violation
	stop chan struct{}
}

func NewUSBMonitor(out chan<- Violation) *USBMonitor {
	return &USBMonitor{out: out, stop: make(chan struct{})}
}

func (m *USBMonitor) Start() { go m.listen() }
func (m *USBMonitor) Stop()  { close(m.stop) }

// NETLINK_KOBJECT_UEVENT = 15
const netlinkKobjectUevent = 15

func (m *USBMonitor) listen() {
	fd, err := syscall.Socket(syscall.AF_NETLINK, syscall.SOCK_DGRAM|syscall.SOCK_CLOEXEC, netlinkKobjectUevent)
	if err != nil {
		m.pollFallback()
		return
	}
	defer syscall.Close(fd)

	addr := &syscall.SockaddrNetlink{
		Family: syscall.AF_NETLINK,
		Groups: 1, // UDEV multicast group
	}
	if err := syscall.Bind(fd, addr); err != nil {
		m.pollFallback()
		return
	}

	buf := make([]byte, 8192)
	for {
		select {
		case <-m.stop:
			return
		default:
		}

		// 1-second read timeout so we can check the stop channel
		tv := syscall.Timeval{Sec: 1, Usec: 0}
		syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)

		n, _, err := syscall.Recvfrom(fd, buf, 0)
		if err != nil {
			continue // timeout or transient error
		}

		msg := string(buf[:n])
		if m.isStorageInsert(msg) {
			m.out <- Violation{
				Kind:    "usb_storage",
				Reason:  "USB Storage Device Connected",
				Details: m.extractModel(msg),
				At:      time.Now(),
			}
		}
	}
}

// isStorageInsert returns true when the udev event signals a new USB
// mass-storage device being added.
func (m *USBMonitor) isStorageInsert(msg string) bool {
	hasAdd := strings.Contains(msg, "ACTION=add")
	isUsb := strings.Contains(msg, "SUBSYSTEM=usb") ||
		strings.Contains(msg, "ID_BUS=usb")
	isMass := strings.Contains(msg, "ID_USB_DRIVER=usb-storage") ||
		strings.Contains(msg, "DEVTYPE=usb_device")
	return hasAdd && isUsb && isMass
}

func (m *USBMonitor) extractModel(msg string) string {
	for _, part := range strings.Split(msg, "\x00") {
		if strings.HasPrefix(part, "ID_MODEL=") {
			return strings.TrimPrefix(part, "ID_MODEL=")
		}
		if strings.HasPrefix(part, "ID_VENDOR=") {
			return strings.TrimPrefix(part, "ID_VENDOR=")
		}
	}
	return "Unknown USB Device"
}

// pollFallback watches lsblk output for newly appearing removable disks.
func (m *USBMonitor) pollFallback() {
	known := m.currentRemovable()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			current := m.currentRemovable()
			for dev := range current {
				if _, exists := known[dev]; !exists {
					m.out <- Violation{
						Kind:    "usb_storage",
						Reason:  "USB Storage Device Connected",
						Details: dev,
						At:      time.Now(),
					}
				}
			}
			known = current
		}
	}
}

func (m *USBMonitor) currentRemovable() map[string]struct{} {
	result := make(map[string]struct{})
	out, err := exec.Command("lsblk", "-o", "NAME,RM,TYPE", "--pairs").Output()
	if err != nil {
		return result
	}
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, `RM="1"`) && strings.Contains(line, `TYPE="disk"`) {
			result[line] = struct{}{}
		}
	}
	return result
}
