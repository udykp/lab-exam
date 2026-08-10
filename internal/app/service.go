package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fmt"
	"github.com/gorilla/websocket"
	"securemlexam/internal/auth"
	"securemlexam/internal/config"
	"securemlexam/internal/domain"
	"securemlexam/internal/realtime"
	"securemlexam/internal/roster"
	"securemlexam/internal/store"
)

type Service struct {
	store        store.Store
	hub          *realtime.Hub
	config       config.Config
	log          *log.Logger
	tokens       *auth.TokenManager
	runProcessesMu sync.Mutex
	runProcesses   map[string]*exec.Cmd
}

func NewService(store store.Store, hub *realtime.Hub, cfg config.Config, logger *log.Logger) *Service {
	return &Service{
		store:        store,
		hub:          hub,
		config:       cfg,
		log:          logger,
		tokens:       auth.NewTokenManager(cfg.TokenSecret),
		runProcesses: make(map[string]*exec.Cmd),
	}
}

func (s *Service) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		http.FileServer(http.Dir("web")).ServeHTTP(w, r)
	})))
	mux.HandleFunc("/styles.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		http.ServeFile(w, r, "web/styles.css")
	})
	mux.HandleFunc("/assets/styles.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		http.ServeFile(w, r, "web/styles.css")
	})
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("/api/v1/auth/me", s.handleMe)
	mux.HandleFunc("/api/v1/ws", s.handleWS)
	mux.HandleFunc("/api/v1/faculty/students", s.requireRole(domain.RoleFaculty, s.handleFacultyStudents))
	mux.HandleFunc("/api/v1/faculty/students/import", s.requireRole(domain.RoleFaculty, s.handleFacultyStudentsImport))
	mux.HandleFunc("/api/v1/faculty/exams/", s.requireRole(domain.RoleFaculty, s.handleFacultyExamSubroutes))
	mux.HandleFunc("/api/v1/student/exam", s.requireRole(domain.RoleStudent, s.handleStudentExam))
	mux.HandleFunc("/api/v1/student/questions", s.requireRole(domain.RoleStudent, s.handleStudentQuestions))
	mux.HandleFunc("/api/v1/student/select_question", s.requireRole(domain.RoleStudent, s.handleStudentSelectQuestion))
	mux.HandleFunc("/api/v1/student/autosave", s.requireRole(domain.RoleStudent, s.handleAutosave))
	mux.HandleFunc("/api/v1/student/submit", s.requireRole(domain.RoleStudent, s.handleSubmit))
	mux.HandleFunc("/api/v1/student/violation", s.requireRole(domain.RoleStudent, s.handleViolation))
	mux.HandleFunc("/api/v1/student/run", s.requireRole(domain.RoleStudent, s.handleRunCode))
	mux.HandleFunc("/api/v1/student/run/ws", s.handleInteractiveRun)
	mux.HandleFunc("/api/v1/faculty/exams", s.requireRole(domain.RoleFaculty, s.handleFacultyExams))
	return s.withLogging(mux)
}

func (s *Service) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	http.ServeFile(w, r, "web/index.html")
}

func (s *Service) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		s.log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started))
	})
}

type loginRequest struct {
	Role       string `json:"role"`
	Name       string `json:"name"`
	RollNumber string `json:"roll_number"`
	ExamID     string `json:"exam_id"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Identifier string `json:"identifier"`
	Secret     string `json:"secret"`
}

func (s *Service) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx := r.Context()
	var (
		subject string
		role    domain.Role
		name    string
		result  map[string]any
	)
	result = map[string]any{}
	switch strings.ToLower(req.Role) {
	case string(domain.RoleStudent):
		studentName := req.Name
		if studentName == "" {
			studentName = req.Identifier
		}
		rollNumber := req.RollNumber
		if rollNumber == "" {
			rollNumber = req.Secret
		}
		student, err := s.store.AuthenticateStudent(ctx, studentName, rollNumber)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		subject = student.ID
		role = domain.RoleStudent
		name = student.Name
		examID := req.ExamID
		if examID == "" {
			examID = "exam-1"
		}
		if assignments, err := s.store.GetAssignments(ctx, student.ID, examID); err == nil && len(assignments) > 0 {
			if exam, eErr := s.store.GetExam(ctx, examID); eErr == nil {
				result["exam"] = exam
			}
			var assignedQuestions []domain.Question
			for _, a := range assignments {
				if q, qErr := s.store.GetQuestion(ctx, a.QuestionID); qErr == nil {
					assignedQuestions = append(assignedQuestions, *q)
				}
			}
			result["assignments"] = assignments
			result["questions"] = assignedQuestions
		}
	case string(domain.RoleFaculty):
		facultyEmail := req.Email
		if facultyEmail == "" {
			facultyEmail = req.Identifier
		}
		facultyPassword := req.Password
		if facultyPassword == "" {
			facultyPassword = req.Secret
		}
		faculty, err := s.store.AuthenticateFaculty(ctx, facultyEmail, facultyPassword)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		subject = faculty.ID
		role = domain.RoleFaculty
		name = faculty.Name
	default:
		http.Error(w, "unsupported role", http.StatusBadRequest)
		return
	}
	token, err := s.tokens.Sign(auth.Claims{Subject: subject, Role: string(role), Expiry: time.Now().Add(8 * time.Hour)})
	if err != nil {
		http.Error(w, "failed to sign token", http.StatusInternalServerError)
		return
	}
	result["token"] = token
	result["role"] = role
	result["name"] = name
	writeJSON(w, http.StatusOK, result)
}

func (s *Service) handleFacultyStudents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	students, err := s.store.ListStudents(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, students)
}

func (s *Service) handleFacultyStudentsImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		http.Error(w, "invalid multipart form", http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	students, err := roster.ParseExcelStudents(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.store.UpsertStudents(r.Context(), students); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": len(students)})
}

func (s *Service) handleWS(w http.ResponseWriter, r *http.Request) {
	if _, ok := claimsFromRequest(r, s.tokens); !ok {
		if token := r.URL.Query().Get("token"); token != "" {
			if _, err := s.tokens.Verify(token); err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	s.hub.ServeHTTP(w, r)
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, claims)
}

func (s *Service) handleStudentExam(w http.ResponseWriter, r *http.Request) {
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	examID := r.URL.Query().Get("exam_id")
	if examID == "" {
		examID = "exam-1"
	}
	if s.isStudentTerminated(r.Context(), claims.Subject, examID) {
		http.Error(w, "exam terminated due to security violation", http.StatusForbidden)
		return
	}
	assignments, err := s.store.GetAssignments(r.Context(), claims.Subject, examID)
	if err != nil || len(assignments) == 0 {
		// Auto-assign first two questions if no explicit assignment exists yet
		questions, qErr := s.store.ListQuestions(r.Context(), examID)
		if qErr != nil || len(questions) == 0 {
			http.Error(w, "no questions available for exam", http.StatusNotFound)
			return
		}
		
		maxAssign := 2
		if len(questions) < 2 {
			maxAssign = len(questions)
		}
		
		assignments = nil
		for i := 0; i < maxAssign; i++ {
			newAssignment := domain.Assignment{
				StudentID:      claims.Subject,
				ExamID:         examID,
				QuestionID:     questions[i].ID,
				QuestionNumber: questions[i].Number,
			}
			_ = s.store.AssignQuestion(r.Context(), newAssignment)
			assignments = append(assignments, newAssignment)
		}

		_ = s.store.UpdateStudentStatus(r.Context(), domain.StudentStatus{
			StudentID: claims.Subject,
			ExamID:    examID,
			State:     "assigned",
			UpdatedAt: time.Now().UTC(),
		})
	}

	exam, err := s.store.GetExam(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	var assignedQuestions []domain.Question
	for _, a := range assignments {
		q, qErr := s.store.GetQuestion(r.Context(), a.QuestionID)
		if qErr == nil {
			assignedQuestions = append(assignedQuestions, *q)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"exam":        exam,
		"questions":   assignedQuestions,
		"assignments": assignments,
	})
}

func (s *Service) handleStudentQuestions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	examID := r.URL.Query().Get("exam_id")
	if examID == "" {
		examID = "exam-1"
	}
	questions, err := s.store.ListQuestions(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, questions)
}

func (s *Service) handleStudentSelectQuestion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		ExamID         string `json:"exam_id"`
		QuestionNumber int    `json:"question_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.ExamID == "" {
		req.ExamID = "exam-1"
	}

	question, err := s.store.GetQuestionByNumber(r.Context(), req.ExamID, req.QuestionNumber)
	if err != nil {
		http.Error(w, "question not found: "+err.Error(), http.StatusNotFound)
		return
	}

	assignment := domain.Assignment{
		StudentID:      claims.Subject,
		ExamID:         req.ExamID,
		QuestionID:     question.ID,
		QuestionNumber: question.Number,
	}
	if err := s.store.AssignQuestion(r.Context(), assignment); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var rollNumber string = claims.Subject
	if students, err := s.store.ListStudents(r.Context()); err == nil {
		for _, student := range students {
			if student.ID == claims.Subject {
				rollNumber = student.RollNumber
				break
			}
		}
	}

	s.hub.Publish(domain.RealtimeEvent{
		Type:    "chit_assigned",
		Subject: req.ExamID,
		Data: map[string]any{
			"roll_number":     rollNumber,
			"question_number": question.Number,
			"assignment":      assignment,
			"question":         question,
		},
		At: time.Now().UTC(),
	})

	exam, err := s.store.GetExam(r.Context(), req.ExamID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "assigned",
		"exam":       exam,
		"question":   question,
		"assignment": assignment,
	})
}

func (s *Service) handleFacultyChits(w http.ResponseWriter, r *http.Request, examID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		RollNumber     string `json:"roll_number"`
		QuestionNumber int    `json:"question_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	assignment, err := s.store.AssignQuestionByRollNumber(r.Context(), examID, req.RollNumber, req.QuestionNumber)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	question, qErr := s.store.GetQuestionByNumber(r.Context(), examID, req.QuestionNumber)
	if qErr == nil {
		s.hub.Publish(domain.RealtimeEvent{Type: "chit_assigned", Subject: examID, Data: map[string]any{"roll_number": req.RollNumber, "question_number": req.QuestionNumber, "assignment": assignment, "question": question}, At: time.Now().UTC()})
	} else {
		s.hub.Publish(domain.RealtimeEvent{Type: "chit_assigned", Subject: examID, Data: map[string]any{"roll_number": req.RollNumber, "question_number": req.QuestionNumber, "assignment": assignment}, At: time.Now().UTC()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "assigned", "assignment": assignment})
}

func (s *Service) handleAutosave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		ExamID     string `json:"exam_id"`
		QuestionID string `json:"question_id"`
		Code       string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if s.isStudentTerminated(r.Context(), claims.Subject, req.ExamID) {
		http.Error(w, "exam terminated due to security violation", http.StatusForbidden)
		return
	}
	if err := s.store.SaveAutosave(r.Context(), domain.Autosave{StudentID: claims.Subject, ExamID: req.ExamID, QuestionID: req.QuestionID, Code: req.Code}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.hub.Publish(domain.RealtimeEvent{Type: "autosave", Subject: req.ExamID, Data: req, At: time.Now().UTC()})
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Service) handleSubmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		ExamID     string `json:"exam_id"`
		QuestionID string `json:"question_id"`
		Code       string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if s.isStudentTerminated(r.Context(), claims.Subject, req.ExamID) {
		http.Error(w, "exam terminated due to security violation", http.StatusForbidden)
		return
	}
	if err := s.store.SaveSubmission(r.Context(), domain.Submission{StudentID: claims.Subject, ExamID: req.ExamID, QuestionID: req.QuestionID, Code: req.Code}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.hub.Publish(domain.RealtimeEvent{Type: "submission", Subject: req.ExamID, Data: req, At: time.Now().UTC()})
	writeJSON(w, http.StatusOK, map[string]string{"status": "submitted"})
}

func (s *Service) handleViolation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		ExamID  string `json:"exam_id"`
		Kind    string `json:"kind"`
		Details string `json:"details"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := s.store.RecordViolation(r.Context(), domain.Violation{StudentID: claims.Subject, ExamID: req.ExamID, Kind: req.Kind, Details: req.Details}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if req.Kind == "exam-ended" {
		s.cleanupMySQLDatabase(r.Context(), claims.Subject)
	}

	s.hub.Publish(domain.RealtimeEvent{Type: "violation", Subject: req.ExamID, Data: req, At: time.Now().UTC()})
	writeJSON(w, http.StatusOK, map[string]string{"status": "recorded"})
}

func (s *Service) handleFacultyExams(w http.ResponseWriter, r *http.Request) {
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method == http.MethodGet {
		exams, err := s.store.ListFacultyExams(r.Context(), claims.Subject)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, exams)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Title    string `json:"title"`
		Course   string `json:"course"`
		Duration int    `json:"duration_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	exam, err := s.store.CreateExam(r.Context(), domain.Exam{Title: req.Title, Course: req.Course, Duration: req.Duration, CreatedBy: claims.Subject, Status: "draft"})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, exam)
}

func (s *Service) handleFacultyExamSubroutes(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/faculty/exams/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	examID := parts[0]
	if len(parts) == 1 {
		s.handleFacultyExam(w, r, examID)
		return
	}
	switch parts[1] {
	case "questions":
		s.handleFacultyQuestions(w, r, examID)
	case "chits":
		s.handleFacultyChits(w, r, examID)
	case "assignments":
		s.handleFacultyAssignments(w, r, examID)
	case "submissions":
		s.handleFacultySubmissions(w, r, examID)
	case "violations":
		s.handleFacultyViolations(w, r, examID)
	case "status":
		s.handleFacultyStatus(w, r, examID)
	default:
		http.NotFound(w, r)
	}
}

func (s *Service) handleFacultyExam(w http.ResponseWriter, r *http.Request, examID string) {
	exam, err := s.store.GetExam(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, exam)
}

func (s *Service) handleFacultyQuestions(w http.ResponseWriter, r *http.Request, examID string) {
	if r.Method == http.MethodGet {
		questions, err := s.store.ListQuestions(r.Context(), examID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, questions)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Number   int               `json:"number"`
		Title    string            `json:"title"`
		Prompt   string            `json:"prompt"`
		Language string            `json:"language"`
		Meta     map[string]string `json:"meta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	question, err := s.store.UpsertQuestion(r.Context(), domain.Question{ExamID: examID, Number: req.Number, Title: req.Title, Prompt: req.Prompt, Language: req.Language, Meta: req.Meta})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, question)
}

func (s *Service) handleFacultyAssignments(w http.ResponseWriter, r *http.Request, examID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		StudentID      string `json:"student_id"`
		QuestionID     string `json:"question_id"`
		QuestionNumber int    `json:"question_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if err := s.store.AssignQuestion(r.Context(), domain.Assignment{StudentID: req.StudentID, ExamID: examID, QuestionID: req.QuestionID, QuestionNumber: req.QuestionNumber}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "assigned"})
}

func (s *Service) handleFacultySubmissions(w http.ResponseWriter, r *http.Request, examID string) {
	submissions, err := s.store.ListSubmissions(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, submissions)
}

func (s *Service) handleFacultyViolations(w http.ResponseWriter, r *http.Request, examID string) {
	violations, err := s.store.ListViolations(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, violations)
}

func (s *Service) handleFacultyStatus(w http.ResponseWriter, r *http.Request, examID string) {
	statuses, err := s.store.ListStudentStatuses(r.Context(), examID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, statuses)
}

func (s *Service) requireRole(role domain.Role, handler func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := claimsFromRequest(r, s.tokens)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if claims.Role != string(role) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		handler(w, r)
	}
}

func claimsFromRequest(r *http.Request, tokens *auth.TokenManager) (*auth.Claims, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return nil, false
	}
	claims, err := tokens.Verify(strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
	if err != nil {
		return nil, false
	}
	return claims, true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Service) handleRunCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := claimsFromRequest(r, s.tokens)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Code          string `json:"code"`
		Language      string `json:"language"`
		QuestionIndex *int   `json:"question_index"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	lang := strings.ToLower(req.Language)
	if lang == "" {
		lang = "python"
	}

	// Create temp directory for code execution inside the workspace
	tmpDir, absErr := filepath.Abs(filepath.Join(".", "tmp_run"))
	if absErr != nil {
		http.Error(w, "failed to get absolute path for execution: "+absErr.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		http.Error(w, "failed to create execution folder: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Capture list of pre-existing files in tmpDir to detect new output files later
	preFiles := make(map[string]bool)
	if entries, err := os.ReadDir(tmpDir); err == nil {
		for _, entry := range entries {
			preFiles[entry.Name()] = true
		}
	}

	// Make a unique file name per student
	var filename string
	var execCmd *exec.Cmd
	var compileCmd *exec.Cmd
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var formattedCode string = req.Code
	if lang == "python" || lang == "python3" {
		// Attempt to format python code using standard library ast.unparse
		fCmd := exec.CommandContext(ctx, "python3", "-c", `import sys, ast; code=sys.stdin.read(); print(ast.unparse(ast.parse(code)))`)
		fCmd.Stdin = strings.NewReader(req.Code)
		if out, fErr := fCmd.Output(); fErr == nil {
			formattedCode = string(out)
		}
	}

	switch lang {
	case "python", "python3":
		filename = filepath.Join(tmpDir, "run_"+claims.Subject+".py")
		execCmd = exec.CommandContext(ctx, "python3", "-u", filename)
	case "c":
		filename = filepath.Join(tmpDir, "run_"+claims.Subject+".c")
		binaryPath := filepath.Join(tmpDir, "run_"+claims.Subject+"_c.out")
		defer os.Remove(binaryPath)
		compileCmd = exec.CommandContext(ctx, "gcc", filename, "-o", binaryPath, "-lm")
		execCmd = exec.CommandContext(ctx, "stdbuf", "-o0", "-e0", binaryPath)
	case "cpp", "c++":
		filename = filepath.Join(tmpDir, "run_"+claims.Subject+".cpp")
		binaryPath := filepath.Join(tmpDir, "run_"+claims.Subject+"_cpp.out")
		defer os.Remove(binaryPath)
		compileCmd = exec.CommandContext(ctx, "g++", filename, "-o", binaryPath, "-std=c++17")
		execCmd = exec.CommandContext(ctx, "stdbuf", "-o0", "-e0", binaryPath)
	case "java":
		filename = filepath.Join(tmpDir, "Main.java")
		classDir := filepath.Join(tmpDir, "java_"+claims.Subject)
		_ = os.MkdirAll(classDir, 0755)
		defer os.RemoveAll(classDir)
		filename = filepath.Join(classDir, "Main.java")
		compileCmd = exec.CommandContext(ctx, "javac", filename)
		execCmd = exec.CommandContext(ctx, "java", "-cp", classDir, "Main")
	case "r":
		filename = filepath.Join(tmpDir, "run_"+claims.Subject+".R")
		execCmd = exec.CommandContext(ctx, "Rscript", filename)
	case "mysql", "sql":
		filename = filepath.Join(tmpDir, "run_"+claims.Subject+".sql")
		mysqlUser := os.Getenv("MYSQL_USER")
		if mysqlUser == "" {
			mysqlUser = "exam_user"
		}
		mysqlPass := os.Getenv("MYSQL_PASSWORD")
		if mysqlPass == "" {
			mysqlPass = "exam_password"
		}
		mysqlDb := os.Getenv("MYSQL_DATABASE")
		if mysqlDb == "" {
			mysqlDb = "labexam"
		}
		mysqlHost := os.Getenv("MYSQL_HOST")
		if mysqlHost == "" {
			mysqlHost = "localhost"
		}

		args := []string{"-n", "-h", mysqlHost, "-u", mysqlUser}
		if mysqlPass != "" {
			args = append(args, "-p"+mysqlPass)
		}
		if mysqlDb != "" {
			args = append(args, mysqlDb)
		}
		execCmd = exec.CommandContext(ctx, "mysql", args...)
	default:
		http.Error(w, "unsupported language: "+lang, http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(filename, []byte(formattedCode), 0644); err != nil {
		http.Error(w, "failed to write code file: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.Remove(filename)

	if lang == "mysql" || lang == "sql" {
		f, err := os.Open(filename)
		if err == nil {
			defer f.Close()
			execCmd.Stdin = f
		}
	}

	// Step 1: Compile if necessary (C, C++, Java)
	if compileCmd != nil {
		compileCmd.Dir = tmpDir
		compileOutput, compileErr := compileCmd.CombinedOutput()
		if compileErr != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"output": "Compilation Error:\n" + string(compileOutput),
				"error":  compileErr.Error(),
			})
			return
		}
	}

	// Step 2: Execute binary / script
	execCmd.Dir = tmpDir
	output, err := execCmd.CombinedOutput()
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "not found") || strings.Contains(errStr, "no such file") {
			var friendlyErr string
			switch lang {
			case "python", "python3":
				friendlyErr = "Python 3 is not installed or not in the system PATH."
			case "c":
				friendlyErr = "C compiler (gcc) is not installed or not in the system PATH."
			case "cpp", "c++":
				friendlyErr = "C++ compiler (g++) is not installed or not in the system PATH."
			case "java":
				friendlyErr = "Java runtime (java) is not installed or not in the system PATH."
			case "r":
				friendlyErr = "R Language environment (Rscript) is not installed on this PC. Please contact the administrator to install R."
			case "mysql", "sql":
				friendlyErr = "MySQL command-line client (mysql) is not installed on this PC. Please contact the administrator to install MySQL."
			default:
				friendlyErr = fmt.Sprintf("Compiler/Interpreter for %s is not installed or not in the system PATH.", lang)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"output":         "",
				"error":          friendlyErr,
				"formatted_code": formattedCode,
			})
			return
		}
	}

	// Copy any new files generated during execution to the student's Desktop
	if entries, dirErr := os.ReadDir(tmpDir); dirErr == nil {
		home, homeErr := os.UserHomeDir()
		if homeErr == nil {
			// Find student details to format the folder name exactly
			studentName := "Student"
			rollNumber := claims.Subject
			if students, err := s.store.ListStudents(r.Context()); err == nil {
				for _, student := range students {
					if student.ID == claims.Subject {
						studentName = student.Name
						rollNumber = student.RollNumber
						break
					}
				}
			}

			folderName := fmt.Sprintf("%s_%s", strings.TrimSpace(studentName), strings.TrimSpace(rollNumber))
			var sb strings.Builder
			for _, ch := range folderName {
				if !strings.ContainsRune("<>:\"/\\|?*", ch) {
					sb.WriteRune(ch)
				}
			}
			sanitizedFolderName := sb.String()
			desktopFolder := filepath.Join(home, "Desktop", sanitizedFolderName)
			
			// Create student's desktop folder if it doesn't exist
			_ = os.MkdirAll(desktopFolder, 0755)

			for _, entry := range entries {
				if !entry.IsDir() && !preFiles[entry.Name()] && entry.Name() != filepath.Base(filename) {
					srcPath := filepath.Join(tmpDir, entry.Name())
					destName := entry.Name()
					qNum := 1
					if req.QuestionIndex != nil {
						qNum = *req.QuestionIndex + 1
					}

					if entry.Name() == "Rplots.pdf" {
						destName = fmt.Sprintf("programming task %d_plot.pdf", qNum)
					} else {
						destName = fmt.Sprintf("programming task %d_%s", qNum, entry.Name())
					}

					destPath := filepath.Join(desktopFolder, destName)
					if inputData, copyErr := os.ReadFile(srcPath); copyErr == nil {
						_ = os.WriteFile(destPath, inputData, 0644)
						_ = os.Remove(srcPath)
					}
				}
			}
		}
	}

	if ctx.Err() == context.DeadlineExceeded {
		writeJSON(w, http.StatusOK, map[string]any{
			"output": "Execution Timeout: Code took longer than 45 seconds to run.",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"output":         string(output),
		"error":          func() string { if err != nil { return err.Error() }; return "" }(),
		"formatted_code": formattedCode,
	})
}

func (s *Service) isStudentTerminated(ctx context.Context, studentID, examID string) bool {
	statuses, err := s.store.ListStudentStatuses(ctx, examID)
	if err != nil {
		return false
	}
	for _, st := range statuses {
		if st.StudentID == studentID && (st.State == "violation" || st.State == "failed") {
			return true
		}
	}
	return false
}

var runUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Service) handleInteractiveRun(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	claims, err := s.tokens.Verify(token)
	if err != nil || claims.Role != string(domain.RoleStudent) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	studentID := claims.Subject

	conn, err := runUpgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Printf("WS upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	writeWS := func(msgType string, text string) {
		payload, _ := json.Marshal(map[string]string{
			"type": msgType,
			"data": text,
		})
		_ = conn.WriteMessage(websocket.TextMessage, payload)
	}

	s.killActiveRunProcess(studentID)

	_, message, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var startReq struct {
		Code          string `json:"code"`
		Language      string `json:"language"`
		QuestionIndex *int   `json:"question_index"`
	}
	if err := json.Unmarshal(message, &startReq); err != nil {
		writeWS("exit", "Invalid start message payload.")
		return
	}

	lang := strings.ToLower(startReq.Language)
	if lang == "" {
		lang = "python"
	}

	tmpDir, absErr := filepath.Abs(filepath.Join(".", "tmp_run"))
	if absErr != nil {
		writeWS("exit", "failed to get absolute path for execution: "+absErr.Error())
		return
	}
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		writeWS("exit", "failed to create execution folder: "+err.Error())
		return
	}

	preFiles := make(map[string]bool)
	if entries, err := os.ReadDir(tmpDir); err == nil {
		for _, entry := range entries {
			preFiles[entry.Name()] = true
		}
	}

	var filename string
	var execCmd *exec.Cmd
	var compileCmd *exec.Cmd

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var formattedCode string = startReq.Code
	if lang == "python" || lang == "python3" {
		fCmd := exec.CommandContext(ctx, "python3", "-c", `import sys, ast; code=sys.stdin.read(); print(ast.unparse(ast.parse(code)))`)
		fCmd.Stdin = strings.NewReader(startReq.Code)
		if out, fErr := fCmd.Output(); fErr == nil {
			formattedCode = string(out)
			payload, _ := json.Marshal(map[string]string{
				"type":           "formatted_code",
				"formatted_code": formattedCode,
			})
			_ = conn.WriteMessage(websocket.TextMessage, payload)
		}
	}

	switch lang {
	case "python", "python3":
		filename = filepath.Join(tmpDir, "run_"+studentID+".py")
		execCmd = exec.CommandContext(ctx, "python3", "-u", filename)
	case "c":
		filename = filepath.Join(tmpDir, "run_"+studentID+".c")
		binaryPath := filepath.Join(tmpDir, "run_"+studentID+"_c.out")
		defer os.Remove(binaryPath)
		compileCmd = exec.CommandContext(ctx, "gcc", filename, "-o", binaryPath, "-lm")
		execCmd = exec.CommandContext(ctx, "stdbuf", "-o0", "-e0", binaryPath)
	case "cpp", "c++":
		filename = filepath.Join(tmpDir, "run_"+studentID+".cpp")
		binaryPath := filepath.Join(tmpDir, "run_"+studentID+"_cpp.out")
		defer os.Remove(binaryPath)
		compileCmd = exec.CommandContext(ctx, "g++", filename, "-o", binaryPath, "-std=c++17")
		execCmd = exec.CommandContext(ctx, "stdbuf", "-o0", "-e0", binaryPath)
	case "java":
		filename = filepath.Join(tmpDir, "Main.java")
		classDir := filepath.Join(tmpDir, "java_"+studentID)
		_ = os.MkdirAll(classDir, 0755)
		defer os.RemoveAll(classDir)
		filename = filepath.Join(classDir, "Main.java")
		compileCmd = exec.CommandContext(ctx, "javac", filename)
		execCmd = exec.CommandContext(ctx, "java", "-cp", classDir, "Main")
	case "r":
		filename = filepath.Join(tmpDir, "run_"+studentID+".R")
		execCmd = exec.CommandContext(ctx, "Rscript", filename)
	case "mysql", "sql":
		filename = filepath.Join(tmpDir, "run_"+studentID+".sql")
		mysqlUser := os.Getenv("MYSQL_USER")
		if mysqlUser == "" {
			mysqlUser = "exam_user"
		}
		mysqlPass := os.Getenv("MYSQL_PASSWORD")
		if mysqlPass == "" {
			mysqlPass = "exam_password"
		}
		mysqlDb := os.Getenv("MYSQL_DATABASE")
		if mysqlDb == "" {
			mysqlDb = "labexam"
		}
		mysqlHost := os.Getenv("MYSQL_HOST")
		if mysqlHost == "" {
			mysqlHost = "localhost"
		}

		args := []string{"-n", "-h", mysqlHost, "-u", mysqlUser}
		if mysqlPass != "" {
			args = append(args, "-p"+mysqlPass)
		}
		if mysqlDb != "" {
			args = append(args, mysqlDb)
		}
		execCmd = exec.CommandContext(ctx, "mysql", args...)
	default:
		writeWS("exit", "Unsupported language: "+lang)
		return
	}

	if err := os.WriteFile(filename, []byte(formattedCode), 0644); err != nil {
		writeWS("exit", "failed to write code file: "+err.Error())
		return
	}
	defer os.Remove(filename)

	if compileCmd != nil {
		compileCmd.Dir = tmpDir
		writeWS("output", "Compiling code...\n")
		compileOutput, compileErr := compileCmd.CombinedOutput()
		if compileErr != nil {
			writeWS("exit", "Compilation Error:\n"+string(compileOutput))
			return
		}
	}

	execCmd.Dir = tmpDir
	stdinPipe, err := execCmd.StdinPipe()
	if err != nil {
		writeWS("exit", "failed to create stdin pipe: "+err.Error())
		return
	}

	stdoutPipe, err := execCmd.StdoutPipe()
	if err != nil {
		writeWS("exit", "failed to create stdout pipe: "+err.Error())
		stdinPipe.Close()
		return
	}
	execCmd.Stderr = execCmd.Stdout

	s.runProcessesMu.Lock()
	s.runProcesses[studentID] = execCmd
	s.runProcessesMu.Unlock()
	
	defer func() {
		s.killActiveRunProcess(studentID)
		stdinPipe.Close()
	}()

	if err := execCmd.Start(); err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "not found") || strings.Contains(errStr, "no such file") {
			var friendlyErr string
			switch lang {
			case "r":
				friendlyErr = "R Language environment (Rscript) is not installed on this PC. Please contact the administrator to install R."
			case "mysql", "sql":
				friendlyErr = "MySQL command-line client (mysql) is not installed on this PC. Please contact the administrator to install MySQL."
			default:
				friendlyErr = fmt.Sprintf("Compiler/Interpreter for %s is not installed or not in the system PATH.", lang)
			}
			writeWS("exit", friendlyErr)
		} else {
			writeWS("exit", "Failed to start program: "+errStr)
		}
		return
	}

	if lang == "mysql" || lang == "sql" {
		_, _ = stdinPipe.Write([]byte(formattedCode + "\n"))
	}

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdoutPipe.Read(buf)
			if n > 0 {
				writeWS("output", string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
	}()

	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			var wsMsg struct {
				Type string `json:"type"`
				Data string `json:"data"`
			}
			if err := json.Unmarshal(msg, &wsMsg); err == nil {
				if wsMsg.Type == "input" {
					_, _ = stdinPipe.Write([]byte(wsMsg.Data))
				}
			}
		}
	}()

	execErr := execCmd.Wait()

	type GeneratedFile struct {
		Name        string `json:"name"`
		ContentType string `json:"content_type"`
		DataBase64  string `json:"data_base64"`
	}

	var copiedFiles []GeneratedFile

	if entries, dirErr := os.ReadDir(tmpDir); dirErr == nil {
		home, homeErr := os.UserHomeDir()
		if homeErr == nil {
			studentName := "Student"
			rollNumber := studentID
			if students, err := s.store.ListStudents(r.Context()); err == nil {
				for _, student := range students {
					if student.ID == studentID {
						studentName = student.Name
						rollNumber = student.RollNumber
						break
					}
				}
			}

			folderName := fmt.Sprintf("%s_%s", strings.TrimSpace(studentName), strings.TrimSpace(rollNumber))
			var sb strings.Builder
			for _, ch := range folderName {
				if !strings.ContainsRune("<>:\"/\\|?*", ch) {
					sb.WriteRune(ch)
				}
			}
			sanitizedFolderName := sb.String()
			desktopFolder := filepath.Join(home, "Desktop", sanitizedFolderName)
			_ = os.MkdirAll(desktopFolder, 0755)

			for _, entry := range entries {
				if !entry.IsDir() && !preFiles[entry.Name()] && entry.Name() != filepath.Base(filename) {
					srcPath := filepath.Join(tmpDir, entry.Name())
					destName := entry.Name()
					qNum := 1
					if startReq.QuestionIndex != nil {
						qNum = *startReq.QuestionIndex + 1
					}

					if entry.Name() == "Rplots.pdf" {
						destName = fmt.Sprintf("programming task %d_plot.pdf", qNum)
					} else {
						destName = fmt.Sprintf("programming task %d_%s", qNum, entry.Name())
					}

					destPath := filepath.Join(desktopFolder, destName)
					if inputData, copyErr := os.ReadFile(srcPath); copyErr == nil {
						_ = os.WriteFile(destPath, inputData, 0644)
						_ = os.Remove(srcPath)

						contentType := "application/octet-stream"
						ext := strings.ToLower(filepath.Ext(destName))
						switch ext {
						case ".pdf":
							contentType = "application/pdf"
						case ".png":
							contentType = "image/png"
						case ".jpg", ".jpeg":
							contentType = "image/jpeg"
						case ".gif":
							contentType = "image/gif"
						case ".svg":
							contentType = "image/svg+xml"
						case ".csv", ".txt", ".sql":
							contentType = "text/plain"
						}

						base64Data := base64.StdEncoding.EncodeToString(inputData)
						copiedFiles = append(copiedFiles, GeneratedFile{
							Name:        destName,
							ContentType: contentType,
							DataBase64:  base64Data,
						})
					}
				}
			}
		}
	}

	if ctx.Err() == context.DeadlineExceeded {
		exitPayload, _ := json.Marshal(map[string]any{
			"type":  "exit",
			"data":  "\n[System Error]: Execution Timeout. Code took longer than 2 minutes.",
			"files": copiedFiles,
		})
		_ = conn.WriteMessage(websocket.TextMessage, exitPayload)
		return
	}

	exitMsg := ""
	if execErr != nil {
		exitMsg = fmt.Sprintf("\nProgram exited with error: %v", execErr)
	}

	exitPayload, _ := json.Marshal(map[string]any{
		"type":  "exit",
		"data":  exitMsg,
		"files": copiedFiles,
	})
	_ = conn.WriteMessage(websocket.TextMessage, exitPayload)
}

func (s *Service) killActiveRunProcess(studentID string) {
	s.runProcessesMu.Lock()
	defer s.runProcessesMu.Unlock()
	if cmd, ok := s.runProcesses[studentID]; ok && cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		delete(s.runProcesses, studentID)
	}
}

func (s *Service) cleanupMySQLDatabase(ctx context.Context, studentID string) {
	studentName := "Student"
	rollNumber := studentID
	if students, err := s.store.ListStudents(ctx); err == nil {
		for _, student := range students {
			if student.ID == studentID {
				studentName = student.Name
				rollNumber = student.RollNumber
				break
			}
		}
	}

	folderName := fmt.Sprintf("%s_%s", strings.TrimSpace(studentName), strings.TrimSpace(rollNumber))
	var sb strings.Builder
	for _, ch := range folderName {
		if !strings.ContainsRune("<>:\"/\\|?*", ch) {
			sb.WriteRune(ch)
		}
	}
	sanitizedFolderName := sb.String()

	home, homeErr := os.UserHomeDir()
	if homeErr == nil {
		desktopFolder := filepath.Join(home, "Desktop", sanitizedFolderName)
		_ = os.MkdirAll(desktopFolder, 0755)

		mysqlUser := os.Getenv("MYSQL_USER")
		if mysqlUser == "" {
			mysqlUser = "exam_user"
		}
		mysqlPass := os.Getenv("MYSQL_PASSWORD")
		if mysqlPass == "" {
			mysqlPass = "exam_password"
		}
		mysqlDb := os.Getenv("MYSQL_DATABASE")
		if mysqlDb == "" {
			mysqlDb = "labexam"
		}
		mysqlHost := os.Getenv("MYSQL_HOST")
		if mysqlHost == "" {
			mysqlHost = "localhost"
		}

		// 1. Export database to student's Desktop directory
		dumpFile := filepath.Join(desktopFolder, "database_dump.sql")
		dumpArgs := []string{"-h", mysqlHost, "-u", mysqlUser}
		if mysqlPass != "" {
			dumpArgs = append(dumpArgs, "-p"+mysqlPass)
		}
		dumpArgs = append(dumpArgs, mysqlDb)

		dumpCmd := exec.CommandContext(ctx, "mysqldump", dumpArgs...)
		if f, createErr := os.Create(dumpFile); createErr == nil {
			dumpCmd.Stdout = f
			_ = dumpCmd.Run()
			f.Close()
		}

		// 2. Drop all tables from labexam schema
		showArgs := []string{"-h", mysqlHost, "-u", mysqlUser}
		if mysqlPass != "" {
			showArgs = append(showArgs, "-p"+mysqlPass)
		}
		showArgs = append(showArgs, "-Nse", "show tables", mysqlDb)

		showCmd := exec.CommandContext(ctx, "mysql", showArgs...)
		if out, showErr := showCmd.Output(); showErr == nil {
			tables := strings.Fields(string(out))
			if len(tables) > 0 {
				dropQuery := "SET FOREIGN_KEY_CHECKS = 0; "
				for _, table := range tables {
					dropQuery += fmt.Sprintf("DROP TABLE IF EXISTS `%s`; ", table)
				}
				dropQuery += "SET FOREIGN_KEY_CHECKS = 1;"

				dropArgs := []string{"-h", mysqlHost, "-u", mysqlUser}
				if mysqlPass != "" {
					dropArgs = append(dropArgs, "-p"+mysqlPass)
				}
				dropArgs = append(dropArgs, "-e", dropQuery, mysqlDb)

				dropCmd := exec.CommandContext(ctx, "mysql", dropArgs...)
				_ = dropCmd.Run()
			}
		}
	}
}
