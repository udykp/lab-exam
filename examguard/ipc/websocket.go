package ipc

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

// ViolationEvent is the JSON payload sent to the exam server.
type ViolationEvent struct {
	Type    string `json:"type"`    // always "violation"
	Student string `json:"student"` // roll number
	ExamID  string `json:"exam_id"`
	Kind    string `json:"kind"`    // machine-readable category
	Reason  string `json:"reason"`  // human-readable summary
	Details string `json:"details"` // extra context
	Time    string `json:"time"`    // HH:MM:SS
}

// Client maintains a persistent WebSocket connection to the exam server
// and exposes SendViolation to ship violation events.
type Client struct {
	serverURL   string
	studentRoll string
	examID      string
	conn        *websocket.Conn
	send        chan []byte
}

func NewClient(serverURL, studentRoll, examID string) *Client {
	return &Client{
		serverURL:   serverURL,
		studentRoll: studentRoll,
		examID:      examID,
		send:        make(chan []byte, 64),
	}
}

// Connect starts the reconnecting send loop in a goroutine.
func (c *Client) Connect() {
	go c.sendLoop()
}

// SendViolation enqueues a violation event for delivery to the server.
func (c *Client) SendViolation(kind, reason, details string) {
	payload := ViolationEvent{
		Type:    "violation",
		Student: c.studentRoll,
		ExamID:  c.examID,
		Kind:    kind,
		Reason:  reason,
		Details: details,
		Time:    time.Now().Format("15:04:05"),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
		log.Println("[ipc] send buffer full, dropping violation")
	}
}

// sendLoop maintains the WebSocket connection and drains the send channel.
func (c *Client) sendLoop() {
	for {
		conn, _, err := websocket.DefaultDialer.Dial(c.serverURL, nil)
		if err != nil {
			log.Printf("[ipc] cannot connect to %s: %v — retrying in 3s", c.serverURL, err)
			time.Sleep(3 * time.Second)
			continue
		}
		c.conn = conn
		log.Printf("[ipc] connected to %s", c.serverURL)

		// Drain queue and forward to server
		disconnected := make(chan struct{})
		go func() {
			// Keep-alive reader: detect server-side disconnect
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					close(disconnected)
					return
				}
			}
		}()

	drain:
		for {
			select {
			case msg := <-c.send:
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					log.Printf("[ipc] write error: %v", err)
					break drain
				}
			case <-disconnected:
				break drain
			}
		}

		conn.Close()
		c.conn = nil
		log.Println("[ipc] disconnected — reconnecting in 3s")
		time.Sleep(3 * time.Second)
	}
}
