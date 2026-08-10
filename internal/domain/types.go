package domain

import "time"

type Role string

const (
	RoleStudent Role = "student"
	RoleFaculty Role = "faculty"
)

type Student struct {
	ID           string    `json:"id"`
	RollNumber   string    `json:"roll_number"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type Faculty struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type Exam struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Course    string    `json:"course"`
	Duration  int       `json:"duration_minutes"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	CreatedBy string    `json:"created_by"`
	Status    string    `json:"status"`
}

type Question struct {
	ID          string            `json:"id"`
	ExamID      string            `json:"exam_id"`
	Number      int               `json:"number"`
	Title       string            `json:"title"`
	Prompt      string            `json:"prompt"`
	Language    string            `json:"language"`
	HiddenTests []string          `json:"-"`
	Meta        map[string]string `json:"meta,omitempty"`
}

type Assignment struct {
	StudentID      string `json:"student_id"`
	ExamID         string `json:"exam_id"`
	QuestionID     string `json:"question_id"`
	QuestionNumber int    `json:"question_number"`
}

type Autosave struct {
	ID         string    `json:"id"`
	StudentID  string    `json:"student_id"`
	ExamID     string    `json:"exam_id"`
	QuestionID string    `json:"question_id"`
	Code       string    `json:"code"`
	SavedAt    time.Time `json:"saved_at"`
}

type Submission struct {
	ID          string    `json:"id"`
	StudentID   string    `json:"student_id"`
	ExamID      string    `json:"exam_id"`
	QuestionID  string    `json:"question_id"`
	Code        string    `json:"code"`
	SubmittedAt time.Time `json:"submitted_at"`
	Status      string    `json:"status"`
	Marks       float64   `json:"marks"`
}

type Violation struct {
	ID         string    `json:"id"`
	StudentID  string    `json:"student_id"`
	ExamID     string    `json:"exam_id"`
	Kind       string    `json:"kind"`
	Details    string    `json:"details"`
	OccurredAt time.Time `json:"occurred_at"`
}

type StudentStatus struct {
	StudentID string    `json:"student_id"`
	ExamID    string    `json:"exam_id"`
	State     string    `json:"state"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RealtimeEvent struct {
	Type    string      `json:"type"`
	Subject string      `json:"subject"`
	Data    interface{} `json:"data"`
	At      time.Time   `json:"at"`
}
