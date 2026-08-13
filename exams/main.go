//go:build !bootstrap

package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const defaultPort = "8080"
const facultySessionCookie = "exam_faculty_session"
const adminSessionCookie = "exam_admin_session"
const defaultPocketBaseAdminEmail = "admin@gmail.com"
const defaultPocketBaseAdminPassword = "crrao@1234"

type config struct {
	Port            string
	PocketBaseURL   string
	PocketBaseEmail string
	PocketBasePass  string
}

type studentBatch struct {
	ID         string `json:"id"`
	Year       string `json:"year"`
	Semester   string `json:"semester"`
	Section    string `json:"section"`
	UploadedAt string `json:"uploaded_at"`
	SourceFile string `json:"source_file"`
}

type student struct {
	ID        string `json:"id"`
	RollNo    string `json:"roll_no"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	BatchID   string `json:"batch_id"`
	CreatedAt string `json:"created_at"`
}

type questionPaper struct {
	ID            string `json:"id"`
	ExamID        string `json:"exam_id,omitempty"`
	Title         string `json:"title"`
	UploadedAt    string `json:"uploaded_at"`
	FileName      string `json:"file_name,omitempty"`
	QuestionCount int    `json:"question_count,omitempty"`
}

type exam struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Year                string `json:"year"`
	Semester            string `json:"semester"`
	Section             string `json:"section"`
	Subject             string `json:"subject"`
	FacultyID           string `json:"faculty_id,omitempty"`
	FacultyAssignmentID string `json:"faculty_assignment_id,omitempty"`
	Status              string `json:"status,omitempty"`
	PublishedAt         string `json:"published_at,omitempty"`
	ArchivedAt          string `json:"archived_at,omitempty"`
	CreatedAt           string `json:"created_at"`
}

type faculty struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Status string `json:"status,omitempty"`
}

type subject struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

type facultyAssignment struct {
	ID         string `json:"id"`
	FacultyID  string `json:"faculty_id"`
	SubjectID  string `json:"subject_id"`
	Year       string `json:"year"`
	Semester   string `json:"semester"`
	Section    string `json:"section"`
	OfferingID string `json:"offering_id"`
}

type facultyAssignmentWithSubject struct {
	facultyAssignment
	Subject subject `json:"subject"`
}

type offering struct {
	ID        string `json:"id"`
	SubjectID string `json:"subject_id"`
	BatchID   string `json:"batch_id"`
	Year      string `json:"year"`
	Semester  string `json:"semester"`
	Section   string `json:"section"`
}

type enrichedAssignment struct {
	ID         string        `json:"id"`
	FacultyID  string        `json:"faculty_id"`
	OfferingID string        `json:"offering_id"`
	Offering   offering      `json:"offering"`
	Subject    subject       `json:"subject"`
	Batch      *studentBatch `json:"batch,omitempty"`
	SubjectID  string        `json:"subject_id"`
	Year       string        `json:"year"`
	Semester   string        `json:"semester"`
	Section    string        `json:"section"`
}


type facultyLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type adminLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type createFacultyRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type createSubjectRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type createTeachingAssignmentRequest struct {
	FacultyID string `json:"faculty_id"`
	SubjectID string `json:"subject_id"`
	Year      string `json:"year"`
	Semester  string `json:"semester"`
	Section   string `json:"section"`
}

type createFacultyExamRequest struct {
	FacultyAssignmentID string `json:"faculty_assignment_id"`
	Title               string `json:"title"`
}

type examQuestionRequest struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
	Marks  int    `json:"marks"`
}

type createExamRequest struct {
	Title     string                `json:"title"`
	Year      string                `json:"year"`
	Semester  string                `json:"semester"`
	Section   string                `json:"section"`
	Subject   string                `json:"subject"`
	Questions []examQuestionRequest `json:"questions"`
}

// createQuestionsRequest is used by faculty after a question paper has been
// created. Every question submitted in the request is linked to PaperID.
type createQuestionsRequest struct {
	PaperID   string                `json:"paper_id"`
	Questions []examQuestionRequest `json:"questions"`
}

type createQuestionPaperRequest struct {
	Title string `json:"title"`
}

type updateQuestionRequest struct {
	Number *int    `json:"number"`
	Text   *string `json:"text"`
	Marks  *int    `json:"marks"`
}

type questionPaperWithQuestions struct {
	questionPaper
	Questions []question `json:"questions"`
}

type question struct {
	ID             string   `json:"id"`
	ExamID         string   `json:"exam_id,omitempty"`
	PaperID        string   `json:"paper_id"`
	Number         int      `json:"number"`
	Text           string   `json:"text"`
	Marks          int      `json:"marks,omitempty"`
	CreatedAt      string   `json:"created_at"`
	Attachments    []string `json:"attachments,omitempty"`
	AttachmentURLs []string `json:"attachment_urls,omitempty"`
}

type assignment struct {
	ID            string `json:"id"`
	ExamID        string `json:"exam_id,omitempty"`
	PaperID       string `json:"paper_id,omitempty"`
	StudentRollNo string `json:"student_roll_no"`
	QuestionID    string `json:"question_id"`
	QuestionText  string `json:"question_text"`
	AssignedAt    string `json:"assigned_at"`
	Response      string `json:"response,omitempty"`
	SubmittedAt   string `json:"submitted_at,omitempty"`
	AttemptID     string `json:"attempt_id,omitempty"`
}

type attempt struct {
	ID            string `json:"id"`
	ExamID        string `json:"exam_id"`
	PaperID       string `json:"paper_id"`
	StudentRollNo string `json:"student_roll_no"`
	StudentID     string `json:"student_id,omitempty"` // Alias to match guide
	Status        string `json:"status"` // assigned | started | submitted
	AssignedAt    string `json:"assigned_at"`
	StartedAt     string `json:"started_at,omitempty"`
	SubmittedAt   string `json:"submitted_at,omitempty"`
}

type assignPaperRequest struct {
	StudentRollNo string `json:"student_roll_no"`
	PaperID       string `json:"paper_id"`
}

type createAssignmentRequest struct {
	ExamID        string   `json:"exam_id"`
	StudentRollNo string   `json:"student_roll_no"`
	QuestionIDs   []string `json:"question_ids"`
}

type submitResponseRequest struct {
	AssignmentID  string `json:"assignment_id"`
	StudentRollNo string `json:"student_roll_no"`
	Response      string `json:"response"`
}

type apiResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

type pocketBaseClient struct {
	baseURL    string
	adminEmail string
	adminPass  string
	token      string
	httpClient *http.Client
}

func main() {
	cfg := loadConfig()
	client := newPocketBaseClient(cfg)

	if err := client.healthCheck(); err != nil {
		panic(err)
	}
	if err := client.authenticateIfConfigured(); err != nil {
		panic(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "backend up"})
	})
	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) { handleFacultyLogin(w, r, client) })
	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) { handleFacultyLogout(w, r) })
	mux.HandleFunc("/api/me", func(w http.ResponseWriter, r *http.Request) { handleFacultyMe(w, r, client) })
	mux.HandleFunc("/api/faculty/exams", func(w http.ResponseWriter, r *http.Request) { handleFacultyExams(w, r, client) })
	mux.HandleFunc("/api/faculty/exams/", func(w http.ResponseWriter, r *http.Request) { handleFacultyExamResource(w, r, client) })
	mux.HandleFunc("/api/faculty/assignments/", func(w http.ResponseWriter, r *http.Request) { handleFacultyAssignmentResource(w, r, client) })
	mux.HandleFunc("/api/faculty/papers/", func(w http.ResponseWriter, r *http.Request) { handleFacultyPaperResource(w, r, client) })
	mux.HandleFunc("/api/faculty/questions/", func(w http.ResponseWriter, r *http.Request) { handleFacultyQuestionResource(w, r, client) })
	mux.HandleFunc("/api/admin/auth/login", func(w http.ResponseWriter, r *http.Request) { handleAdminLogin(w, r, client) })
	mux.HandleFunc("/api/admin/auth/logout", func(w http.ResponseWriter, r *http.Request) { handleAdminLogout(w, r) })
	mux.HandleFunc("/api/admin/me", func(w http.ResponseWriter, r *http.Request) { handleAdminMe(w, r, client) })
	mux.HandleFunc("/api/admin/faculty", func(w http.ResponseWriter, r *http.Request) { handleAdminFaculty(w, r, client) })
	mux.HandleFunc("/api/admin/faculty/", func(w http.ResponseWriter, r *http.Request) { handleAdminRecordResource(w, r, client, "faculty") })
	mux.HandleFunc("/api/admin/subjects", func(w http.ResponseWriter, r *http.Request) { handleAdminSubjects(w, r, client) })
	mux.HandleFunc("/api/admin/subjects/", func(w http.ResponseWriter, r *http.Request) { handleAdminRecordResource(w, r, client, "subjects") })
	mux.HandleFunc("/api/admin/teaching-assignments", func(w http.ResponseWriter, r *http.Request) { handleAdminTeachingAssignments(w, r, client) })
	mux.HandleFunc("/api/admin/teaching-assignments/", func(w http.ResponseWriter, r *http.Request) {
		handleAdminRecordResource(w, r, client, "faculty_assignments")
	})
	mux.HandleFunc("/api/admin/students/upload-excel", func(w http.ResponseWriter, r *http.Request) { handleAdminStudentUpload(w, r, client) })
	mux.HandleFunc("/api/admin/batches", func(w http.ResponseWriter, r *http.Request) { handleAdminBatches(w, r, client) })
	// Faculty authoring now uses the authenticated /api/faculty routes below.
	// The old generic authoring routes are deliberately not registered: they
	// could otherwise bypass the ownership checks with the backend's database
	// credentials.
	mux.HandleFunc("/api/assignments", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			handleCreateAssignment(w, r, client)
		case http.MethodGet:
			handleGetAssignments(w, r, client)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		}
	})
	mux.HandleFunc("/api/attempts/start", func(w http.ResponseWriter, r *http.Request) { handleAttemptsStart(w, r, client) })
	mux.HandleFunc("/api/attempts/submit", func(w http.ResponseWriter, r *http.Request) { handleAttemptsSubmit(w, r, client) })
	mux.HandleFunc("/api/media/questions/", func(w http.ResponseWriter, r *http.Request) { handleMediaQuestion(w, r, client) })
	mux.HandleFunc("/api/submissions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
			return
		}
		handleSubmitResponse(w, r, client)
	})
	mux.Handle("/", http.FileServer(http.Dir("web")))

	fmt.Printf("server listening on http://localhost:%s\n", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		panic(err)
	}
}

func loadConfig() config {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultPort
	}
	baseURL := strings.TrimSpace(os.Getenv("POCKETBASE_URL"))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8090"
	}
	adminEmail := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = defaultPocketBaseAdminEmail
	}
	adminPass := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_PASSWORD"))
	if adminPass == "" {
		adminPass = defaultPocketBaseAdminPassword
	}
	return config{
		Port:            port,
		PocketBaseURL:   strings.TrimRight(baseURL, "/"),
		PocketBaseEmail: adminEmail,
		PocketBasePass:  adminPass,
	}
}

func newPocketBaseClient(cfg config) *pocketBaseClient {
	return &pocketBaseClient{
		baseURL:    cfg.PocketBaseURL,
		adminEmail: cfg.PocketBaseEmail,
		adminPass:  cfg.PocketBasePass,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func handleFacultyLogin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req facultyLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if strings.TrimSpace(req.Email) == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "email and password are required"})
		return
	}
	var auth struct {
		Token  string  `json:"token"`
		Record faculty `json:"record"`
	}
	if err := client.withToken("").doJSON(http.MethodPost, "/api/collections/faculty/auth-with-password", map[string]string{"identity": strings.TrimSpace(req.Email), "password": req.Password}, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "invalid email or password"})
		return
	}
	if auth.Record.Status == "inactive" {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Message: "faculty account is inactive"})
		return
	}
	setFacultySession(w, r, auth.Token)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged in", Data: auth.Record})
}

func handleAdminLogin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req adminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	var auth struct {
		Token  string `json:"token"`
		Record struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"record"`
	}
	if err := client.withToken("").doJSON(http.MethodPost, "/api/collections/_superusers/auth-with-password", map[string]string{"identity": strings.TrimSpace(req.Email), "password": req.Password}, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "invalid email or password"})
		return
	}
	setAdminSession(w, r, auth.Token)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "admin logged in", Data: auth.Record})
}

func handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged out"})
}

func setAdminSession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
}

func requireAdmin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) bool {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "admin login required"})
		return false
	}
	var auth struct {
		Token string `json:"token"`
	}
	if err := client.withToken(cookie.Value).doJSON(http.MethodPost, "/api/collections/_superusers/auth-refresh", nil, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "admin session is invalid or expired"})
		return false
	}
	setAdminSession(w, r, auth.Token)
	return true
}

func handleAdminMe(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	if !requireAdmin(w, r, client) {
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "admin session active"})
}

func handleAdminFaculty(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if !requireAdmin(w, r, client) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		var result struct {
			Items []faculty `json:"items"`
		}
		if err := client.listRecords("faculty", "", &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "faculty fetched", Data: result.Items})
	case http.MethodPost:
		var req createFacultyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Email) == "" || len(req.Password) < 8 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "name, email and a password of at least 8 characters are required"})
			return
		}
		var record faculty
		if err := client.createRecord("faculty", map[string]interface{}{"name": strings.TrimSpace(req.Name), "email": strings.TrimSpace(req.Email), "password": req.Password, "passwordConfirm": req.Password, "status": "active"}, &record); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "faculty account created", Data: record})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func handleAdminSubjects(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if !requireAdmin(w, r, client) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		var result struct {
			Items []subject `json:"items"`
		}
		if err := client.listRecords("subjects", "", &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "subjects fetched", Data: result.Items})
	case http.MethodPost:
		var req createSubjectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if strings.TrimSpace(req.Code) == "" || strings.TrimSpace(req.Name) == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "code and name are required"})
			return
		}
		var record subject
		if err := client.createRecord("subjects", map[string]string{"code": strings.TrimSpace(req.Code), "name": strings.TrimSpace(req.Name)}, &record); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "subject created", Data: record})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func handleAdminTeachingAssignments(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if !requireAdmin(w, r, client) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		var result struct {
			Items []facultyAssignment `json:"items"`
		}
		if err := client.listRecords("faculty_assignments", "", &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		enriched := make([]enrichedAssignment, 0, len(result.Items))
		for _, item := range result.Items {
			enriched = append(enriched, enrichAssignment(client, item))
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "teaching assignments fetched", Data: enriched})
	case http.MethodPost:
		var req createTeachingAssignmentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if strings.TrimSpace(req.FacultyID) == "" || strings.TrimSpace(req.SubjectID) == "" || strings.TrimSpace(req.Year) == "" || strings.TrimSpace(req.Semester) == "" || strings.TrimSpace(req.Section) == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "faculty, subject, year, semester and section are required"})
			return
		}
		var record facultyAssignment
		if err := client.createRecord("faculty_assignments", map[string]string{"faculty_id": strings.TrimSpace(req.FacultyID), "subject_id": strings.TrimSpace(req.SubjectID), "year": strings.TrimSpace(req.Year), "semester": strings.TrimSpace(req.Semester), "section": strings.TrimSpace(req.Section)}, &record); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "teaching assignment created", Data: record})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func handleAdminStudentUpload(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if !requireAdmin(w, r, client) {
		return
	}
	handleUploadStudents(w, r, client)
}

func handleAdminRecordResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient, collection string) {
	if !requireAdmin(w, r, client) {
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	id := parts[3]
	switch r.Method {
	case http.MethodPut:
		var update map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		forbidden := map[string]bool{"id": true, "password": true, "passwordConfirm": true}
		for key := range update {
			if forbidden[key] {
				delete(update, key)
			}
		}
		if len(update) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "no editable fields supplied"})
			return
		}
		var out map[string]interface{}
		if err := client.updateRecord(collection, id, update, &out); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "record updated", Data: out})
	case http.MethodDelete:
		if collection == "faculty" {
			var used struct {
				Items []facultyAssignment `json:"items"`
			}
			_ = client.listRecords("faculty_assignments", fmt.Sprintf(`faculty_id = %q`, id), &used)
			if len(used.Items) > 0 {
				writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "cannot delete faculty with teaching assignments; deactivate the account instead"})
				return
			}
		}
		if collection == "subjects" {
			var used struct {
				Items []facultyAssignment `json:"items"`
			}
			_ = client.listRecords("faculty_assignments", fmt.Sprintf(`subject_id = %q`, id), &used)
			if len(used.Items) > 0 {
				writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "cannot delete subject with teaching assignments"})
				return
			}
		}
		if collection == "faculty_assignments" {
			var used struct {
				Items []exam `json:"items"`
			}
			_ = client.listRecords("exams", fmt.Sprintf(`faculty_assignment_id = %q`, id), &used)
			if len(used.Items) > 0 {
				writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "cannot delete teaching assignment with exams"})
				return
			}
		}
		if err := client.deleteRecord(collection, id); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "record deleted"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func handleFacultyLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: facultySessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged out"})
}

func setFacultySession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: facultySessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
}

func requireFaculty(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) (*pocketBaseClient, faculty, bool) {
	cookie, err := r.Cookie(facultySessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "faculty login required"})
		return nil, faculty{}, false
	}
	facultyClient := client.withToken(cookie.Value)
	var auth struct {
		Token  string  `json:"token"`
		Record faculty `json:"record"`
	}
	if err := facultyClient.doJSON(http.MethodPost, "/api/collections/faculty/auth-refresh", nil, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "faculty session is invalid or expired"})
		return nil, faculty{}, false
	}
	setFacultySession(w, r, auth.Token)
	// Data collections are locked in PocketBase. The verified faculty identity
	// is used for ownership checks in this backend, while this client performs
	// the authorized data operation.
	return client, auth.Record, true
}

func handleFacultyMe(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	assignments, err := listFacultyAssignments(facultyClient, current.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	enriched := make([]enrichedAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		enriched = append(enriched, enrichAssignment(facultyClient, assignment))
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "faculty profile fetched", Data: map[string]interface{}{"faculty": current, "assignments": enriched}})
}

func handleFacultyExams(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		var result struct {
			Items []exam `json:"items"`
		}
		if err := facultyClient.listRecords("exams", fmt.Sprintf(`faculty_id = %q`, current.ID), &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "faculty exams fetched", Data: result.Items})
	case http.MethodPost:
		var req createFacultyExamRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.FacultyAssignmentID) == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "title and faculty_assignment_id are required"})
			return
		}
		var assignment facultyAssignment
		if err := facultyClient.getRecord("faculty_assignments", req.FacultyAssignmentID, &assignment); err != nil || assignment.FacultyID != current.ID {
			writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Message: "teaching assignment is not available to this faculty"})
			return
		}
		var subjectRecord subject
		if err := facultyClient.getRecord("subjects", assignment.SubjectID, &subjectRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "subject for teaching assignment not found"})
			return
		}
		examRecord := exam{Title: strings.TrimSpace(req.Title), Year: assignment.Year, Semester: assignment.Semester, Section: assignment.Section, Subject: subjectRecord.Name, FacultyID: current.ID, FacultyAssignmentID: assignment.ID, Status: "draft", CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		if err := facultyClient.createRecord("exams", map[string]interface{}{"title": examRecord.Title, "year": examRecord.Year, "semester": examRecord.Semester, "section": examRecord.Section, "subject": examRecord.Subject, "faculty_id": examRecord.FacultyID, "faculty_assignment_id": examRecord.FacultyAssignmentID, "status": examRecord.Status, "created_at": examRecord.CreatedAt}, &examRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		paper := questionPaper{ExamID: examRecord.ID, Title: examRecord.Title + " Paper", UploadedAt: time.Now().UTC().Format(time.RFC3339), QuestionCount: 0}
		if err := facultyClient.createRecord("question_papers", map[string]interface{}{"exam_id": paper.ExamID, "title": paper.Title, "uploaded_at": paper.UploadedAt, "question_count": paper.QuestionCount}, &paper); err != nil {
			// Keep the create-exam operation all-or-nothing from the caller's
			// perspective if the default paper cannot be created.
			_ = facultyClient.deleteRecord("exams", examRecord.ID)
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "exam draft created", Data: map[string]interface{}{"exam": examRecord, "default_paper": paper}})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func listFacultyAssignments(client *pocketBaseClient, facultyID string) ([]facultyAssignment, error) {
	var result struct {
		Items []facultyAssignment `json:"items"`
	}
	if err := client.listRecords("faculty_assignments", fmt.Sprintf(`faculty_id = %q`, facultyID), &result); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func enrichAssignment(client *pocketBaseClient, assignment facultyAssignment) enrichedAssignment {
	var sub subject
	_ = client.getRecord("subjects", assignment.SubjectID, &sub)

	var batches struct {
		Items []studentBatch `json:"items"`
	}
	var batch *studentBatch
	filter := fmt.Sprintf(`year = %q && semester = %q && section = %q`, assignment.Year, assignment.Semester, assignment.Section)
	if err := client.listRecords("student_batches", filter, &batches); err == nil && len(batches.Items) > 0 {
		batch = &batches.Items[0]
	}

	batchID := ""
	if batch != nil {
		batchID = batch.ID
	}

	off := offering{
		ID:        assignment.ID,
		SubjectID: assignment.SubjectID,
		BatchID:   batchID,
		Year:      assignment.Year,
		Semester:  assignment.Semester,
		Section:   assignment.Section,
	}

	return enrichedAssignment{
		ID:         assignment.ID,
		FacultyID:  assignment.FacultyID,
		OfferingID: assignment.ID,
		Offering:   off,
		Subject:    sub,
		Batch:      batch,
		SubjectID:  assignment.SubjectID,
		Year:       assignment.Year,
		Semester:   assignment.Semester,
		Section:    assignment.Section,
	}
}


func handleFacultyExamResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/faculty/exams/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	var examRecord exam
	if err := facultyClient.getRecord("exams", parts[0], &examRecord); err != nil || examRecord.FacultyID != current.ID {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "exam not found"})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		handleGetExamDetails(w, facultyClient, examRecord.ID)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPut {
		var req struct {
			Title string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Title) == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "title is required"})
			return
		}
		if examRecord.Status == "published" {
			writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "published exams cannot be renamed"})
			return
		}
		if err := facultyClient.updateRecord("exams", examRecord.ID, map[string]string{"title": strings.TrimSpace(req.Title)}, &examRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam updated", Data: examRecord})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		var assigned struct {
			Items []assignment `json:"items"`
		}
		_ = facultyClient.listRecords("assignments", fmt.Sprintf(`exam_id = %q`, examRecord.ID), &assigned)
		if len(assigned.Items) > 0 {
			writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "cannot delete an exam with student assignments; archive it instead"})
			return
		}
		var papers struct {
			Items []questionPaper `json:"items"`
		}
		_ = facultyClient.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, examRecord.ID), &papers)
		for _, paper := range papers.Items {
			var questions []question
			questions, _ = listQuestionsForPaper(facultyClient, paper.ID)
			for _, q := range questions {
				_ = facultyClient.deleteRecord("questions", q.ID)
			}
			_ = facultyClient.deleteRecord("question_papers", paper.ID)
		}
		if err := facultyClient.deleteRecord("exams", examRecord.ID); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam deleted"})
		return
	}
	if len(parts) == 2 && parts[1] == "publish" && r.Method == http.MethodPost {
		var papers struct {
			Items []questionPaper `json:"items"`
		}
		_ = facultyClient.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, examRecord.ID), &papers)
		count := 0
		for _, paper := range papers.Items {
			qs, _ := listQuestionsForPaper(facultyClient, paper.ID)
			count += len(qs)
		}
		if count == 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "add at least one question before publishing"})
			return
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if err := facultyClient.updateRecord("exams", examRecord.ID, map[string]string{"status": "published", "published_at": now}, &examRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam published", Data: examRecord})
		return
	}
	if len(parts) == 2 && parts[1] == "archive" && r.Method == http.MethodPost {
		now := time.Now().UTC().Format(time.RFC3339)
		if err := facultyClient.updateRecord("exams", examRecord.ID, map[string]string{"status": "archived", "archived_at": now}, &examRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam archived", Data: examRecord})
		return
	}
	if len(parts) == 2 && parts[1] == "clone" && r.Method == http.MethodPost {
		var req struct {
			OfferingID string `json:"offering_id"`
			Title      string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		handleCloneExam(w, facultyClient, examRecord, req.OfferingID, req.Title)
		return
	}
	if len(parts) == 2 && parts[1] == "submissions" && r.Method == http.MethodGet {
		handleGetExamSubmissions(w, facultyClient, examRecord.ID)
		return
	}
	if len(parts) == 2 && parts[1] == "papers" && r.Method == http.MethodPost {
		handleCreateQuestionPaper(w, r, facultyClient, examRecord.ID)
		return
	}
	if len(parts) == 2 && parts[1] == "assign-paper" && r.Method == http.MethodPost {
		var req assignPaperRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		handleAssignPaper(w, facultyClient, examRecord, req)
		return
	}
	if len(parts) == 2 && parts[1] == "questions" && r.Method == http.MethodPost {
		var req struct {
			Questions []examQuestionRequest `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if len(req.Questions) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "at least one question is required"})
			return
		}
		var papers struct {
			Items []questionPaper `json:"items"`
		}
		if err := facultyClient.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, examRecord.ID), &papers); err != nil || len(papers.Items) == 0 {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "default question paper not found"})
			return
		}
		handleCreateQuestionsForPaper(w, facultyClient, papers.Items[0].ID, req.Questions)
		return
	}
	writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
}

func handleFacultyAssignmentResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/faculty/assignments/"), "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "students" || r.Method != http.MethodGet {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	var teaching *facultyAssignment
	assignments, err := listFacultyAssignments(facultyClient, current.ID)
	if err == nil {
		for _, a := range assignments {
			if a.ID == parts[0] || (a.OfferingID != "" && a.OfferingID == parts[0]) || enrichAssignment(facultyClient, a).OfferingID == parts[0] {
				teaching = &a
				break
			}
		}
	}
	if teaching == nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "teaching assignment not found"})
		return
	}
	var batches struct {
		Items []studentBatch `json:"items"`
	}
	filter := fmt.Sprintf(`year = %q && semester = %q && section = %q`, teaching.Year, teaching.Semester, teaching.Section)
	if err := facultyClient.listRecords("student_batches", filter, &batches); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	students := make([]student, 0)
	for _, batch := range batches.Items {
		var result struct {
			Items []student `json:"items"`
		}
		if err := facultyClient.listRecords("students", fmt.Sprintf(`batch_id = %q`, batch.ID), &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		students = append(students, result.Items...)
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "students fetched", Data: students})
}

func handleFacultyPaperResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/faculty/papers/"), "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "questions" || r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	var paper questionPaper
	if err := facultyClient.getRecord("question_papers", parts[0], &paper); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question paper not found"})
		return
	}
	var examRecord exam
	if err := facultyClient.getRecord("exams", paper.ExamID, &examRecord); err != nil || examRecord.FacultyID != current.ID {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question paper not found"})
		return
	}

	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		err := r.ParseMultipartForm(100 * 1024 * 1024)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to parse multipart form"})
			return
		}
		numStr := r.FormValue("number")
		marksStr := r.FormValue("marks")
		text := r.FormValue("text")

		number, _ := strconv.Atoi(numStr)
		marks, _ := strconv.Atoi(marksStr)

		if text == "" || number <= 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "number and text are required"})
			return
		}

		qPayload := map[string]interface{}{
			"exam_id":    paper.ExamID,
			"paper_id":   paper.ID,
			"number":     number,
			"text":       text,
			"marks":      marks,
			"created_at": time.Now().UTC().Format(time.RFC3339),
		}

		var requestBody bytes.Buffer
		writer := multipart.NewWriter(&requestBody)

		for k, v := range qPayload {
			_ = writer.WriteField(k, fmt.Sprintf("%v", v))
		}

		files := r.MultipartForm.File["attachments"]
		for _, fHeader := range files {
			file, err := fHeader.Open()
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
				return
			}
			defer file.Close()

			part, err := writer.CreateFormFile("attachments", fHeader.Filename)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
				return
			}

			_, _ = io.Copy(part, file)
		}

		_ = writer.Close()

		pbURL := fmt.Sprintf("%s/api/collections/questions/records", facultyClient.baseURL)
		req, err := http.NewRequest(http.MethodPost, pbURL, &requestBody)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if facultyClient.token != "" {
			req.Header.Set("Authorization", "Bearer "+facultyClient.token)
		}

		resp, err := facultyClient.httpClient.Do(req)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			writeJSON(w, resp.StatusCode, apiResponse{Success: false, Message: string(body)})
			return
		}

		var created question
		_ = json.NewDecoder(resp.Body).Decode(&created)

		var paperInfo questionPaper
		_ = facultyClient.getRecord("question_papers", paper.ID, &paperInfo)
		_ = facultyClient.updateRecord("question_papers", paper.ID, map[string]interface{}{"question_count": paperInfo.QuestionCount + 1}, &paperInfo)

		writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "question created", Data: []question{created}})
		return
	}

	var req struct {
		Questions []examQuestionRequest `json:"questions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if len(req.Questions) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "at least one question is required"})
		return
	}
	handleCreateQuestionsForPaper(w, facultyClient, paper.ID, req.Questions)
}

func handleAssignPaper(w http.ResponseWriter, client *pocketBaseClient, examRecord exam, req assignPaperRequest) {
	req.StudentRollNo = strings.TrimSpace(req.StudentRollNo)
	req.PaperID = strings.TrimSpace(req.PaperID)
	if req.StudentRollNo == "" || req.PaperID == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "student_roll_no and paper_id are required"})
		return
	}
	var paper questionPaper
	if err := client.getRecord("question_papers", req.PaperID, &paper); err != nil || paper.ExamID != examRecord.ID {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "selected paper does not belong to this exam"})
		return
	}
	var studentsResult struct {
		Items []student `json:"items"`
	}
	if err := client.listRecords("students", fmt.Sprintf(`roll_no = %q`, req.StudentRollNo), &studentsResult); err != nil || len(studentsResult.Items) == 0 {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "student not found"})
		return
	}
	var existing struct {
		Items []attempt `json:"items"`
	}
	if err := client.listRecords("attempts", fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, examRecord.ID, req.StudentRollNo), &existing); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	if len(existing.Items) > 0 {
		writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "this student already has a question paper assigned for this exam"})
		return
	}
	questions, err := listQuestionsForPaper(client, paper.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	if len(questions) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "the selected question paper has no questions"})
		return
	}

	att := attempt{
		ExamID:        examRecord.ID,
		PaperID:       paper.ID,
		StudentRollNo: req.StudentRollNo,
		StudentID:     req.StudentRollNo,
		Status:        "assigned",
		AssignedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	if err := client.createRecord("attempts", map[string]interface{}{
		"exam_id":         att.ExamID,
		"paper_id":        att.PaperID,
		"student_roll_no": att.StudentRollNo,
		"status":          att.Status,
		"assigned_at":     att.AssignedAt,
	}, &att); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	assignments := make([]assignment, 0, len(questions))
	for _, q := range questions {
		item := assignment{
			ExamID:        examRecord.ID,
			PaperID:       paper.ID,
			StudentRollNo: req.StudentRollNo,
			QuestionID:    q.ID,
			QuestionText:  q.Text,
			AssignedAt:    att.AssignedAt,
			AttemptID:     att.ID,
		}
		if err := client.createRecord("assignments", map[string]interface{}{
			"exam_id":         item.ExamID,
			"paper_id":        item.PaperID,
			"student_roll_no": item.StudentRollNo,
			"question_id":     item.QuestionID,
			"question_text":   item.QuestionText,
			"assigned_at":     item.AssignedAt,
			"attempt_id":      item.AttemptID,
		}, &item); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		assignments = append(assignments, item)
	}

	writeJSON(w, http.StatusCreated, apiResponse{
		Success: true,
		Message: "question paper assigned",
		Data: map[string]interface{}{
			"attempt":            att,
			"paper_id":           paper.ID,
			"assigned_questions": assignments,
		},
	})
}

func handleFacultyQuestionResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	facultyClient, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/faculty/questions/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	questionID := parts[0]
	var q question
	if err := facultyClient.getRecord("questions", questionID, &q); err != nil || q.PaperID == "" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question not found"})
		return
	}
	var paper questionPaper
	if err := facultyClient.getRecord("question_papers", q.PaperID, &paper); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question paper not found"})
		return
	}
	var examRecord exam
	if err := facultyClient.getRecord("exams", paper.ExamID, &examRecord); err != nil || examRecord.FacultyID != current.ID {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question not found"})
		return
	}

	if len(parts) == 1 {
		handleQuestionResource(w, r, facultyClient)
		return
	}
	if len(parts) == 2 && parts[1] == "attachments" {
		handleFacultyQuestionAttachments(w, r, facultyClient, questionID)
		return
	}
	if len(parts) == 3 && parts[1] == "attachments" {
		handleFacultyQuestionDeleteAttachment(w, r, facultyClient, questionID, parts[2])
		return
	}
	writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
}

func (c *pocketBaseClient) healthCheck() error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("pocketbase is not reachable at %s: %w", c.baseURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pocketbase health check failed: %s", strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *pocketBaseClient) authenticateIfConfigured() error {
	if c.adminEmail == "" || c.adminPass == "" {
		return nil
	}
	var resp struct {
		Token string `json:"token"`
	}
	if err := c.doJSON(http.MethodPost, "/api/collections/_superusers/auth-with-password", map[string]string{
		"identity": c.adminEmail,
		"password": c.adminPass,
	}, &resp); err != nil {
		return err
	}
	c.token = resp.Token
	return nil
}

func (c *pocketBaseClient) withToken(token string) *pocketBaseClient {
	copy := *c
	copy.token = token
	return &copy
}

func (c *pocketBaseClient) ensureCollections() error {
	for _, collection := range []string{"exams", "student_batches", "students", "question_papers", "questions", "assignments"} {
		if err := c.collectionExists(collection); err != nil {
			return err
		}
	}
	return nil
}

func (c *pocketBaseClient) collectionExists(name string) error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/collections/"+name, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("missing PocketBase collection %q; create it in the admin UI", name)
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to inspect PocketBase collection %q: %s", name, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *pocketBaseClient) doJSON(method, path string, payload interface{}, out interface{}) error {
	var body io.Reader
	if payload != nil {
		buf, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s failed: %s", method, path, strings.TrimSpace(string(bodyBytes)))
	}
	if out != nil {
		return json.Unmarshal(bodyBytes, out)
	}
	return nil
}

func (c *pocketBaseClient) createRecord(collection string, payload interface{}, out interface{}) error {
	return c.doJSON(http.MethodPost, "/api/collections/"+collection+"/records", payload, out)
}

func (c *pocketBaseClient) updateRecord(collection, id string, payload interface{}, out interface{}) error {
	return c.doJSON(http.MethodPatch, "/api/collections/"+collection+"/records/"+id, payload, out)
}

func (c *pocketBaseClient) deleteRecord(collection, id string) error {
	return c.doJSON(http.MethodDelete, "/api/collections/"+collection+"/records/"+id, nil, nil)
}

func (c *pocketBaseClient) getRecord(collection, id string, out interface{}) error {
	return c.doJSON(http.MethodGet, "/api/collections/"+collection+"/records/"+id, nil, out)
}

func (c *pocketBaseClient) listRecords(collection, filter string, out interface{}) error {
	path := "/api/collections/" + collection + "/records?perPage=200"
	if filter != "" {
		path += "&filter=" + url.QueryEscape(filter)
	}
	return c.doJSON(http.MethodGet, path, nil, out)
}

func (c *pocketBaseClient) createRecordWithFile(collection, fileField, fileName string, fileData []byte, fields map[string]string, out interface{}) error {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return err
		}
	}
	part, err := writer.CreateFormFile(fileField, fileName)
	if err != nil {
		return err
	}
	if _, err := part.Write(fileData); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api/collections/"+collection+"/records", &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("create %s record failed: %s", collection, strings.TrimSpace(string(bodyBytes)))
	}
	if out != nil {
		return json.Unmarshal(bodyBytes, out)
	}
	return nil
}

func handleUploadStudents(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to read upload"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "file is required"})
		return
	}
	defer file.Close()

	year := strings.TrimSpace(r.FormValue("year"))
	semester := strings.TrimSpace(r.FormValue("semester"))
	section := strings.TrimSpace(r.FormValue("section"))
	if year == "" || semester == "" || section == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "year, semester and section are required"})
		return
	}

	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to read upload file"})
		return
	}

	rows, err := parseStudentRows(fileData, header.Filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: err.Error()})
		return
	}
	if len(rows) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "no student rows found"})
		return
	}

	batch := studentBatch{
		Year:       year,
		Semester:   semester,
		Section:    section,
		UploadedAt: time.Now().UTC().Format(time.RFC3339),
		SourceFile: header.Filename,
	}
	if err := client.createRecord("student_batches", map[string]interface{}{
		"year":        batch.Year,
		"semester":    batch.Semester,
		"section":     batch.Section,
		"uploaded_at": batch.UploadedAt,
		"source_file": batch.SourceFile,
	}, &batch); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	createdStudents := 0
	for _, row := range rows {
		rollNo := strings.TrimSpace(row["roll_no"])
		name := strings.TrimSpace(row["name"])
		email := strings.TrimSpace(row["email"])
		if rollNo == "" || name == "" {
			continue
		}
		studentRecord := student{BatchID: batch.ID, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		if err := client.createRecord("students", map[string]interface{}{
			"roll_no":    rollNo,
			"name":       name,
			"email":      email,
			"batch_id":   batch.ID,
			"created_at": studentRecord.CreatedAt,
		}, &studentRecord); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		createdStudents++
	}

	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "student batch uploaded", Data: map[string]interface{}{"batch_id": batch.ID, "students_count": createdStudents, "parsed_rows": len(rows), "source_file_name": header.Filename}})
}

func handleUploadQuestionPaper(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}

	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to read upload"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "file is required"})
		return
	}
	defer file.Close()

	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		title = "Question Paper"
	}
	examID := strings.TrimSpace(r.FormValue("exam_id"))

	fileData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to read pdf contents"})
		return
	}

	paper := questionPaper{ExamID: examID, Title: title, UploadedAt: time.Now().UTC().Format(time.RFC3339), FileName: header.Filename, QuestionCount: 0}
	if err := client.createRecordWithFile("question_papers", "file", header.Filename, fileData, map[string]string{
		"exam_id":        paper.ExamID,
		"title":          paper.Title,
		"uploaded_at":    paper.UploadedAt,
		"question_count": strconv.Itoa(paper.QuestionCount),
	}, &paper); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "question paper archived", Data: map[string]interface{}{"paper_id": paper.ID, "exam_id": paper.ExamID, "file_name": header.Filename}})
}

func handleExamResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/exams/"), "/"), "/")
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet {
		handleGetExamDetails(w, client, parts[0])
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "question-papers" && r.Method == http.MethodPost {
		handleCreateQuestionPaper(w, r, client, parts[0])
		return
	}
	writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
}

func handleCreateQuestionPaper(w http.ResponseWriter, r *http.Request, client *pocketBaseClient, examID string) {
	var req createQuestionPaperRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "title is required"})
		return
	}
	if err := client.getRecord("exams", examID, &exam{}); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "exam not found"})
		return
	}
	paper := questionPaper{ExamID: examID, Title: strings.TrimSpace(req.Title), UploadedAt: time.Now().UTC().Format(time.RFC3339), QuestionCount: 0}
	if err := client.createRecord("question_papers", map[string]interface{}{
		"exam_id": paper.ExamID, "title": paper.Title, "uploaded_at": paper.UploadedAt, "question_count": paper.QuestionCount,
	}, &paper); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "question paper created", Data: paper})
}

func handleCreateExam(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	var req createExamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Year) == "" || strings.TrimSpace(req.Semester) == "" || strings.TrimSpace(req.Section) == "" || strings.TrimSpace(req.Subject) == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "title, year, semester, section and subject are required"})
		return
	}
	examRecord := exam{
		Title:     strings.TrimSpace(req.Title),
		Year:      strings.TrimSpace(req.Year),
		Semester:  strings.TrimSpace(req.Semester),
		Section:   strings.TrimSpace(req.Section),
		Subject:   strings.TrimSpace(req.Subject),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := client.createRecord("exams", map[string]interface{}{
		"title":      examRecord.Title,
		"year":       examRecord.Year,
		"semester":   examRecord.Semester,
		"section":    examRecord.Section,
		"subject":    examRecord.Subject,
		"created_at": examRecord.CreatedAt,
	}, &examRecord); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	createdQuestions := make([]question, 0, len(req.Questions))
	for i, input := range req.Questions {
		text := strings.TrimSpace(input.Text)
		if text == "" {
			continue
		}
		number := input.Number
		if number <= 0 {
			number = i + 1
		}
		q := question{
			ExamID:    examRecord.ID,
			Number:    number,
			Text:      text,
			Marks:     input.Marks,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		if err := client.createRecord("questions", map[string]interface{}{
			"exam_id":    q.ExamID,
			"number":     q.Number,
			"text":       q.Text,
			"marks":      q.Marks,
			"created_at": q.CreatedAt,
		}, &q); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		createdQuestions = append(createdQuestions, q)
	}

	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "exam created", Data: map[string]interface{}{"exam": examRecord, "questions": createdQuestions}})
}

// handleCreateQuestions lets faculty add questions manually instead of
// extracting them from a PDF. The resulting questions are linked through
// questions.paper_id to the existing question_papers record.
func handleCreateQuestions(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	var req createQuestionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	req.PaperID = strings.TrimSpace(req.PaperID)
	if req.PaperID == "" || len(req.Questions) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "paper_id and at least one question are required"})
		return
	}

	handleCreateQuestionsForPaper(w, client, req.PaperID, req.Questions)
}

func handleCreateQuestionsForPaper(w http.ResponseWriter, client *pocketBaseClient, paperID string, inputs []examQuestionRequest) {
	var paper questionPaper
	if err := client.getRecord("question_papers", paperID, &paper); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question paper not found"})
		return
	}

	created := make([]question, 0, len(inputs))
	for index, input := range inputs {
		text := strings.TrimSpace(input.Text)
		if text == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: fmt.Sprintf("question %d text is required", index+1)})
			return
		}
		if input.Marks < 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: fmt.Sprintf("question %d marks cannot be negative", index+1)})
			return
		}
		number := input.Number
		if number <= 0 {
			number = index + 1
		}
		q := question{
			ExamID:    paper.ExamID,
			PaperID:   paper.ID,
			Number:    number,
			Text:      text,
			Marks:     input.Marks,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		if err := client.createRecord("questions", map[string]interface{}{
			"exam_id":    q.ExamID,
			"paper_id":   q.PaperID,
			"number":     q.Number,
			"text":       q.Text,
			"marks":      q.Marks,
			"created_at": q.CreatedAt,
		}, &q); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		created = append(created, q)
	}

	paper.QuestionCount += len(created)
	if err := client.updateRecord("question_papers", paper.ID, map[string]interface{}{
		"question_count": paper.QuestionCount,
	}, &paper); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "questions created", Data: map[string]interface{}{
		"paper_id":          paper.ID,
		"question_count":    paper.QuestionCount,
		"created_questions": created,
	}})
}

func handleQuestionPaperResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/question-papers/"), "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "questions" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	switch r.Method {
	case http.MethodPost:
		var req struct {
			Questions []examQuestionRequest `json:"questions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		if len(req.Questions) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "at least one question is required"})
			return
		}
		handleCreateQuestionsForPaper(w, client, parts[0], req.Questions)
	case http.MethodGet:
		questions, err := listQuestionsForPaper(client, parts[0])
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "questions fetched", Data: questions})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func handleQuestionResource(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	questionID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/questions/"), "/")
	if questionID == "" || strings.Contains(questionID, "/") {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
		return
	}
	var existing question
	if err := client.getRecord("questions", questionID, &existing); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "question not found"})
		return
	}
	switch r.Method {
	case http.MethodPut:
		var req updateQuestionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
			return
		}
		update := map[string]interface{}{}
		if req.Number != nil {
			if *req.Number <= 0 {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "number must be positive"})
				return
			}
			update["number"] = *req.Number
		}
		if req.Text != nil {
			if strings.TrimSpace(*req.Text) == "" {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "text cannot be empty"})
				return
			}
			update["text"] = strings.TrimSpace(*req.Text)
		}
		if req.Marks != nil {
			if *req.Marks < 0 {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "marks cannot be negative"})
				return
			}
			update["marks"] = *req.Marks
		}
		if len(update) == 0 {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "at least one field is required"})
			return
		}
		if err := client.updateRecord("questions", questionID, update, &existing); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "question updated", Data: existing})
	case http.MethodDelete:
		if err := client.deleteRecord("questions", questionID); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		if existing.PaperID != "" {
			var paper questionPaper
			if err := client.getRecord("question_papers", existing.PaperID, &paper); err == nil && paper.QuestionCount > 0 {
				_ = client.updateRecord("question_papers", paper.ID, map[string]interface{}{"question_count": paper.QuestionCount - 1}, nil)
			}
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "question deleted"})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
	}
}

func listQuestionsForPaper(client *pocketBaseClient, paperID string) ([]question, error) {
	var result struct {
		Items []question `json:"items"`
	}
	if err := client.listRecords("questions", fmt.Sprintf(`paper_id = %q`, paperID), &result); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func handleGetExamDetails(w http.ResponseWriter, client *pocketBaseClient, examID string) {
	var examRecord exam
	if err := client.getRecord("exams", examID, &examRecord); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "exam not found"})
		return
	}
	var result struct {
		Items []questionPaper `json:"items"`
	}
	if err := client.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, examID), &result); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	papers := make([]questionPaperWithQuestions, 0, len(result.Items))
	for _, paper := range result.Items {
		questions, err := listQuestionsForPaper(client, paper.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		papers = append(papers, questionPaperWithQuestions{questionPaper: paper, Questions: questions})
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam fetched", Data: map[string]interface{}{"exam": examRecord, "papers": papers}})
}

func handleGetExams(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	examID := strings.TrimSpace(r.URL.Query().Get("exam_id"))
	if examID != "" {
		var examRecord exam
		if err := client.getRecord("exams", examID, &examRecord); err != nil {
			writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "exam not found"})
			return
		}
		var result struct {
			Items []question `json:"items"`
		}
		if err := client.listRecords("questions", fmt.Sprintf(`exam_id = %q`, examID), &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam fetched", Data: map[string]interface{}{"exam": examRecord, "questions": result.Items}})
		return
	}

	var result struct {
		Items []exam `json:"items"`
	}
	if err := client.listRecords("exams", "", &result); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exams fetched", Data: result.Items})
}

func handleCreateAssignment(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	var req createAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if req.StudentRollNo == "" || len(req.QuestionIDs) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "student_roll_no and question_ids are required"})
		return
	}
	if req.ExamID != "" {
		if err := client.getRecord("exams", req.ExamID, &exam{}); err != nil {
			writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "exam not found"})
			return
		}
	}

	var studentsResult struct {
		Items []student `json:"items"`
	}
	if err := client.listRecords("students", fmt.Sprintf(`roll_no = %q`, req.StudentRollNo), &studentsResult); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "student not found"})
		return
	}
	if len(studentsResult.Items) == 0 {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "student not found"})
		return
	}

	assignments := make([]assignment, 0, len(req.QuestionIDs))
	resolvedExamID := strings.TrimSpace(req.ExamID)
	for _, questionID := range req.QuestionIDs {
		var q question
		if err := client.getRecord("questions", questionID, &q); err != nil {
			writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: fmt.Sprintf("question %s not found", questionID)})
			return
		}
		if q.ExamID != "" {
			if resolvedExamID == "" {
				resolvedExamID = q.ExamID
			} else if resolvedExamID != q.ExamID {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "all selected questions must belong to the same exam"})
				return
			}
		}
		if resolvedExamID == "" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "exam_id is required and must be attached to the selected questions"})
			return
		}
		item := assignment{ExamID: resolvedExamID, StudentRollNo: req.StudentRollNo, QuestionID: questionID, QuestionText: q.Text, AssignedAt: time.Now().UTC().Format(time.RFC3339)}
		if err := client.createRecord("assignments", map[string]interface{}{
			"exam_id":         item.ExamID,
			"student_roll_no": req.StudentRollNo,
			"question_id":     questionID,
			"question_text":   q.Text,
			"assigned_at":     item.AssignedAt,
		}, &item); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
		assignments = append(assignments, item)
	}

	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "questions assigned", Data: assignments})
}

func handleGetAssignments(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	rollNo := strings.TrimSpace(r.URL.Query().Get("roll_no"))
	if rollNo == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "roll_no query parameter is required"})
		return
	}

	// 1. Fetch student info
	var students struct {
		Items []student `json:"items"`
	}
	_ = client.listRecords("students", fmt.Sprintf(`roll_no = %q`, rollNo), &students)
	var stud student
	if len(students.Items) > 0 {
		stud = students.Items[0]
	} else {
		stud = student{RollNo: rollNo, Name: "Student"}
	}

	// 2. Fetch attempts
	var attemptsRes struct {
		Items []attempt `json:"items"`
	}
	_ = client.listRecords("attempts", fmt.Sprintf(`student_roll_no = %q`, rollNo), &attemptsRes)

	type attemptQuestion struct {
		ID             string   `json:"id"`
		QuestionID     string   `json:"question_id"`
		Number         int      `json:"number"`
		QuestionText   string   `json:"question_text"`
		Marks          int      `json:"marks"`
		Response       string   `json:"response"`
		AttachmentURLs []string `json:"attachment_urls"`
	}

	type attemptWithQuestions struct {
		attempt
		ExamTitle    string            `json:"exam_title"`
		PaperTitle   string            `json:"paper_title"`
		Locked       bool              `json:"locked"`
		Questions    []attemptQuestion `json:"questions"`
	}

	attemptsList := make([]attemptWithQuestions, 0)

	// Fetch all assignments to construct both structured attempts and legacy assignments list
	var result struct {
		Items []assignment `json:"items"`
	}
	_ = client.listRecords("assignments", fmt.Sprintf(`student_roll_no = %q`, rollNo), &result)

	// For each attempt, aggregate questions
	for _, att := range attemptsRes.Items {
		var ex exam
		_ = client.getRecord("exams", att.ExamID, &ex)

		var pap questionPaper
		_ = client.getRecord("question_papers", att.PaperID, &pap)

		questionsList := make([]attemptQuestion, 0)
		for _, as := range result.Items {
			if as.AttemptID == att.ID || (as.AttemptID == "" && as.ExamID == att.ExamID && as.PaperID == att.PaperID) {
				var q question
				_ = client.getRecord("questions", as.QuestionID, &q)

				urls := make([]string, 0)
				for _, filename := range q.Attachments {
					urls = append(urls, fmt.Sprintf("/api/media/questions/%s/%s", q.ID, filename))
				}

				questionsList = append(questionsList, attemptQuestion{
					ID:             as.ID,
					QuestionID:     as.QuestionID,
					Number:         q.Number,
					QuestionText:   as.QuestionText,
					Marks:          q.Marks,
					Response:       as.Response,
					AttachmentURLs: urls,
				})
			}
		}

		// Sort questions by number
		for i := 0; i < len(questionsList); i++ {
			for j := i + 1; j < len(questionsList); j++ {
				if questionsList[i].Number > questionsList[j].Number {
					questionsList[i], questionsList[j] = questionsList[j], questionsList[i]
				}
			}
		}

		att.StudentID = att.StudentRollNo
		attemptsList = append(attemptsList, attemptWithQuestions{
			attempt:    att,
			ExamTitle:  ex.Title,
			PaperTitle: pap.Title,
			Locked:     att.Status == "submitted",
			Questions:  questionsList,
		})
	}

	dataResponse := map[string]interface{}{
		"student":     stud,
		"attempts":    attemptsList,
		"assignments": result.Items,
	}

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "assignments fetched", Data: dataResponse})
}

func handleSubmitResponse(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	var req submitResponseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if req.AssignmentID == "" || req.StudentRollNo == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "assignment_id and student_roll_no are required"})
		return
	}

	var existing assignment
	if err := client.getRecord("assignments", req.AssignmentID, &existing); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "assignment not found"})
		return
	}
	if existing.StudentRollNo != req.StudentRollNo {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "student_roll_no does not match the assignment"})
		return
	}

	var att attempt
	if existing.AttemptID != "" {
		_ = client.getRecord("attempts", existing.AttemptID, &att)
	} else {
		var attempts struct {
			Items []attempt `json:"items"`
		}
		_ = client.listRecords("attempts", fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, existing.ExamID, existing.StudentRollNo), &attempts)
		if len(attempts.Items) > 0 {
			att = attempts.Items[0]
		}
	}

	if att.ID != "" {
		if att.Status == "submitted" {
			writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "exam already submitted and locked"})
			return
		}
		if att.Status != "started" {
			writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "exam has not been started yet"})
			return
		}
	}

	updated := map[string]interface{}{
		"response":     req.Response,
		"submitted_at": time.Now().UTC().Format(time.RFC3339),
	}
	if err := client.updateRecord("assignments", req.AssignmentID, updated, &existing); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "response saved", Data: existing})
}

func parseStudentRows(data []byte, filename string) ([]map[string]string, error) {
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xlsm") || strings.HasSuffix(lower, ".xls") {
		rows, err := parseXLSXRows(data)
		if err == nil && len(rows) > 0 {
			return rows, nil
		}
	}
	return parseCSV(data)
}

func parseXLSXRows(data []byte) ([]map[string]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, nil
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, nil
	}

	headers := normalizeHeaders(rows[0])
	result := make([]map[string]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		mapped := make(map[string]string)
		for i, header := range headers {
			if i >= len(row) {
				continue
			}
			mapped[canonicalStudentHeader(header)] = strings.TrimSpace(row[i])
		}
		if len(mapped) > 0 {
			result = append(result, mapped)
		}
	}
	return result, nil
}

func parseCSV(content []byte) ([]map[string]string, error) {
	reader := csv.NewReader(strings.NewReader(string(content)))
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, nil
	}

	headers := normalizeHeaders(rows[0])
	result := make([]map[string]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}
		mapped := make(map[string]string)
		for i, header := range headers {
			if i < len(row) {
				mapped[canonicalStudentHeader(header)] = strings.TrimSpace(row[i])
			}
		}
		result = append(result, mapped)
	}
	return result, nil
}

func normalizeHeaders(values []string) []string {
	out := make([]string, len(values))
	for i, v := range values {
		key := strings.ToLower(strings.TrimSpace(v))
		key = strings.ReplaceAll(key, " ", "_")
		key = strings.ReplaceAll(key, "-", "_")
		key = strings.ReplaceAll(key, "/", "_")
		out[i] = key
	}
	return out
}

func canonicalStudentHeader(key string) string {
	switch strings.TrimSpace(strings.ToLower(key)) {
	case "roll", "rollno", "roll_no", "roll_number", "rollnumber", "reg_no", "registration_no", "roll no", "roll number", "reg no", "student_roll_no", "student roll no", "student roll number":
		return "roll_no"
	case "student_name", "studentname", "student name", "name":
		return "name"
	case "mail", "student_mail", "student mail", "email_address", "email", "email_id", "email id":
		return "email"
	default:
		return key
	}
}

func parseQuestionsFromText(text string) []string {
	lines := strings.Split(text, "\n")
	var questions []string
	var current strings.Builder
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if current.Len() > 0 {
				current.WriteString(" ")
			}
			continue
		}
		if matched, _ := regexp.MatchString(`^\d+[\.)]`, trimmed); matched {
			if current.Len() > 0 {
				questions = append(questions, strings.TrimSpace(current.String()))
			}
			current.Reset()
			trimmed = regexp.MustCompile(`^\d+[\.)]\s*`).ReplaceAllString(trimmed, "")
		}
		if current.Len() > 0 {
			current.WriteString(" ")
		}
		current.WriteString(trimmed)
	}
	if current.Len() > 0 {
		questions = append(questions, strings.TrimSpace(current.String()))
	}
	return questions
}

func extractTextFromPDF(data []byte) string {
	text := string(data)
	pattern := regexp.MustCompile(`\(((?:\\.|[^()])*)\)\s*Tj`)
	matches := pattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return strings.TrimSpace(text)
	}
	var parts []string
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		val := strings.ReplaceAll(match[1], `\\`, `\`)
		val = strings.ReplaceAll(val, `\(`, `(`)
		val = strings.ReplaceAll(val, `\)`, `)`)
		parts = append(parts, val)
	}
	return strings.Join(parts, "\n")
}

func handleAdminBatches(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if !requireAdmin(w, r, client) {
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var batches struct {
		Items []studentBatch `json:"items"`
	}
	if err := client.listRecords("student_batches", "", &batches); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	type enrichedBatch struct {
		studentBatch
		StudentsCount int `json:"students_count"`
	}
	enriched := make([]enrichedBatch, 0, len(batches.Items))
	for _, b := range batches.Items {
		var students struct {
			TotalItems int `json:"totalItems"`
		}
		path := "/api/collections/students/records?perPage=1&filter=" + url.QueryEscape(fmt.Sprintf(`batch_id = %q`, b.ID))
		_ = client.doJSON(http.MethodGet, path, nil, &students)

		enriched = append(enriched, enrichedBatch{
			studentBatch:  b,
			StudentsCount: students.TotalItems,
		})
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "batches fetched", Data: enriched})
}

func handleAttemptsStart(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req struct {
		StudentRollNo string `json:"student_roll_no"`
		ExamID        string `json:"exam_id"`
		AttemptID     string `json:"attempt_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	req.StudentRollNo = strings.TrimSpace(req.StudentRollNo)
	if req.StudentRollNo == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "student_roll_no is required"})
		return
	}

	var attempts struct {
		Items []attempt `json:"items"`
	}
	filter := ""
	if req.AttemptID != "" {
		filter = fmt.Sprintf(`id = %q && student_roll_no = %q`, req.AttemptID, req.StudentRollNo)
	} else if req.ExamID != "" {
		filter = fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, req.ExamID, req.StudentRollNo)
	} else {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "exam_id or attempt_id is required"})
		return
	}

	if err := client.listRecords("attempts", filter, &attempts); err != nil || len(attempts.Items) == 0 {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "attempt not found"})
		return
	}

	att := attempts.Items[0]
	if att.Status == "submitted" {
		writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "exam already submitted"})
		return
	}

	if att.Status == "assigned" {
		att.Status = "started"
		att.StartedAt = time.Now().UTC().Format(time.RFC3339)
		if err := client.updateRecord("attempts", att.ID, map[string]interface{}{"status": att.Status, "started_at": att.StartedAt}, &att); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
			return
		}
	}

	att.StudentID = att.StudentRollNo
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "attempt started", Data: att})
}

func handleAttemptsSubmit(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req struct {
		StudentRollNo string `json:"student_roll_no"`
		ExamID        string `json:"exam_id"`
		AttemptID     string `json:"attempt_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	req.StudentRollNo = strings.TrimSpace(req.StudentRollNo)
	if req.StudentRollNo == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "student_roll_no is required"})
		return
	}

	var attempts struct {
		Items []attempt `json:"items"`
	}
	filter := ""
	if req.AttemptID != "" {
		filter = fmt.Sprintf(`id = %q && student_roll_no = %q`, req.AttemptID, req.StudentRollNo)
	} else if req.ExamID != "" {
		filter = fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, req.ExamID, req.StudentRollNo)
	} else {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "exam_id or attempt_id is required"})
		return
	}

	if err := client.listRecords("attempts", filter, &attempts); err != nil || len(attempts.Items) == 0 {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "attempt not found"})
		return
	}

	att := attempts.Items[0]
	if att.Status == "submitted" {
		writeJSON(w, http.StatusConflict, apiResponse{Success: false, Message: "exam already submitted"})
		return
	}
	if att.Status != "started" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "exam not started yet"})
		return
	}

	att.Status = "submitted"
	att.SubmittedAt = time.Now().UTC().Format(time.RFC3339)
	if err := client.updateRecord("attempts", att.ID, map[string]interface{}{"status": att.Status, "submitted_at": att.SubmittedAt}, &att); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	// Also mark all associated assignments as submitted
	var assigns struct {
		Items []assignment `json:"items"`
	}
	_ = client.listRecords("assignments", fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, att.ExamID, att.StudentRollNo), &assigns)
	for _, as := range assigns.Items {
		_ = client.updateRecord("assignments", as.ID, map[string]interface{}{"submitted_at": att.SubmittedAt}, &as)
	}

	att.StudentID = att.StudentRollNo
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "exam attempt submitted successfully", Data: att})
}

func handleMediaQuestion(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/media/questions/"), "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "file not found"})
		return
	}
	questionID := parts[0]
	filename := parts[1]

	authorized := false
	cookie, err := r.Cookie(facultySessionCookie)
	if err == nil && cookie.Value != "" {
		var auth struct {
			Record faculty `json:"record"`
		}
		if err := client.withToken(cookie.Value).doJSON(http.MethodPost, "/api/collections/faculty/auth-refresh", nil, &auth); err == nil && auth.Record.ID != "" {
			authorized = true
		}
	}

	if !authorized {
		rollNo := strings.TrimSpace(r.URL.Query().Get("roll_no"))
		if rollNo != "" {
			var assigns struct {
				Items []assignment `json:"items"`
			}
			_ = client.listRecords("assignments", fmt.Sprintf(`student_roll_no = %q && question_id = %q`, rollNo, questionID), &assigns)
			if len(assigns.Items) > 0 {
				authorized = true
			}
		}
	}

	if !authorized {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "unauthorized"})
		return
	}

	pbURL := fmt.Sprintf("%s/api/files/questions/%s/%s", client.baseURL, questionID, filename)
	req, err := http.NewRequest(http.MethodGet, pbURL, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	if client.token != "" {
		req.Header.Set("Authorization", "Bearer "+client.token)
	}

	resp, err := client.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeJSON(w, resp.StatusCode, apiResponse{Success: false, Message: "failed to retrieve file from store"})
		return
	}

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("Content-Length", resp.Header.Get("Content-Length"))
	_, _ = io.Copy(w, resp.Body)
}

func handleFacultyQuestionAttachments(w http.ResponseWriter, r *http.Request, client *pocketBaseClient, questionID string) {
	facultyClient, _, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}

	err := r.ParseMultipartForm(100 * 1024 * 1024)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "failed to parse multipart form"})
		return
	}

	files := r.MultipartForm.File["attachments"]
	if len(files) == 0 {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "no attachments found in request"})
		return
	}

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)

	for _, fHeader := range files {
		file, err := fHeader.Open()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "failed to read file: " + err.Error()})
			return
		}
		defer file.Close()

		part, err := writer.CreateFormFile("attachments", fHeader.Filename)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "failed to create multipart field: " + err.Error()})
			return
		}

		_, err = io.Copy(part, file)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "failed to copy file bytes: " + err.Error()})
			return
		}
	}

	err = writer.Close()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "failed to close multipart writer"})
		return
	}

	pbURL := fmt.Sprintf("%s/api/collections/questions/records/%s", facultyClient.baseURL, questionID)
	req, err := http.NewRequest(http.MethodPatch, pbURL, &requestBody)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if facultyClient.token != "" {
		req.Header.Set("Authorization", "Bearer "+facultyClient.token)
	}

	resp, err := facultyClient.httpClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		writeJSON(w, resp.StatusCode, apiResponse{Success: false, Message: string(body)})
		return
	}

	var updated question
	_ = json.NewDecoder(resp.Body).Decode(&updated)

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "attachments uploaded", Data: updated})
}

func handleFacultyQuestionDeleteAttachment(w http.ResponseWriter, r *http.Request, client *pocketBaseClient, questionID string, filename string) {
	facultyClient, _, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}

	payload := map[string]interface{}{
		"attachments-": []string{filename},
	}

	var updated question
	if err := facultyClient.updateRecord("questions", questionID, payload, &updated); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "attachment deleted", Data: updated})
}

func handleCloneExam(w http.ResponseWriter, client *pocketBaseClient, srcExam exam, targetOfferingID string, newTitle string) {
	var targetOffering facultyAssignment
	if err := client.getRecord("faculty_assignments", targetOfferingID, &targetOffering); err != nil {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "target offering not found"})
		return
	}

	if targetOffering.FacultyID != srcExam.FacultyID {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Message: "you do not teach the target offering"})
		return
	}

	var sub subject
	_ = client.getRecord("subjects", targetOffering.SubjectID, &sub)

	title := newTitle
	if title == "" {
		title = srcExam.Title + " (Clone)"
	}

	clonedExam := exam{
		Title:               title,
		Year:                targetOffering.Year,
		Semester:            targetOffering.Semester,
		Section:             targetOffering.Section,
		Subject:             sub.Name,
		FacultyID:           srcExam.FacultyID,
		FacultyAssignmentID: targetOffering.ID,
		Status:              "draft",
		CreatedAt:           time.Now().UTC().Format(time.RFC3339),
	}

	if err := client.createRecord("exams", map[string]interface{}{
		"title":                 clonedExam.Title,
		"year":                  clonedExam.Year,
		"semester":              clonedExam.Semester,
		"section":               clonedExam.Section,
		"subject":               clonedExam.Subject,
		"faculty_id":            clonedExam.FacultyID,
		"faculty_assignment_id": clonedExam.FacultyAssignmentID,
		"status":                clonedExam.Status,
		"created_at":            clonedExam.CreatedAt,
	}, &clonedExam); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}

	var papers struct {
		Items []questionPaper `json:"items"`
	}
	_ = client.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, srcExam.ID), &papers)

	for _, p := range papers.Items {
		clonedPaper := questionPaper{
			ExamID:        clonedExam.ID,
			Title:         p.Title,
			UploadedAt:    time.Now().UTC().Format(time.RFC3339),
			QuestionCount: p.QuestionCount,
		}
		if err := client.createRecord("question_papers", map[string]interface{}{
			"exam_id":        clonedPaper.ExamID,
			"title":          clonedPaper.Title,
			"uploaded_at":    clonedPaper.UploadedAt,
			"question_count": clonedPaper.QuestionCount,
		}, &clonedPaper); err != nil {
			continue
		}

		qs, _ := listQuestionsForPaper(client, p.ID)
		for _, q := range qs {
			clonedQuestion := question{
				ExamID:      clonedExam.ID,
				PaperID:     clonedPaper.ID,
				Number:      q.Number,
				Text:        q.Text,
				Marks:       q.Marks,
				CreatedAt:   time.Now().UTC().Format(time.RFC3339),
				Attachments: q.Attachments,
			}
			_ = client.createRecord("questions", map[string]interface{}{
				"exam_id":     clonedQuestion.ExamID,
				"paper_id":    clonedQuestion.PaperID,
				"number":      clonedQuestion.Number,
				"text":        clonedQuestion.Text,
				"marks":       clonedQuestion.Marks,
				"created_at":  clonedQuestion.CreatedAt,
				"attachments": clonedQuestion.Attachments,
			}, &clonedQuestion)
		}
	}

	writeJSON(w, http.StatusCreated, apiResponse{Success: true, Message: "exam cloned successfully", Data: clonedExam})
}

func handleGetExamSubmissions(w http.ResponseWriter, client *pocketBaseClient, examID string) {
	var attempts struct {
		Items []attempt `json:"items"`
	}
	_ = client.listRecords("attempts", fmt.Sprintf(`exam_id = %q`, examID), &attempts)

	var assignmentsRes struct {
		Items []assignment `json:"items"`
	}
	_ = client.listRecords("assignments", fmt.Sprintf(`exam_id = %q`, examID), &assignmentsRes)

	assignMap := make(map[string][]assignment)
	for _, as := range assignmentsRes.Items {
		assignMap[as.StudentRollNo] = append(assignMap[as.StudentRollNo], as)
	}

	type submissionItem struct {
		StudentName   string       `json:"student_name"`
		RollNo        string       `json:"roll_no"`
		Email         string       `json:"email"`
		PaperTitle    string       `json:"paper_title"`
		AssignedAt    string       `json:"assigned_at"`
		Status        string       `json:"status"`
		AnsweredCount int          `json:"answered_count"`
		QuestionCount int          `json:"question_count"`
		Assignments   []assignment `json:"assignments"`
	}

	submissionList := make([]submissionItem, 0, len(attempts.Items))
	for _, att := range attempts.Items {
		var students struct {
			Items []student `json:"items"`
		}
		_ = client.listRecords("students", fmt.Sprintf(`roll_no = %q`, att.StudentRollNo), &students)

		name := "Student"
		email := ""
		if len(students.Items) > 0 {
			name = students.Items[0].Name
			email = students.Items[0].Email
		}

		var pap questionPaper
		_ = client.getRecord("question_papers", att.PaperID, &pap)

		studentAssigns := assignMap[att.StudentRollNo]
		answered := 0
		for _, as := range studentAssigns {
			if strings.TrimSpace(as.Response) != "" {
				answered++
			}
		}

		submissionList = append(submissionList, submissionItem{
			StudentName:    name,
			RollNo:         att.StudentRollNo,
			Email:          email,
			PaperTitle:     pap.Title,
			AssignedAt:     att.AssignedAt,
			Status:         att.Status,
			AnsweredCount:  answered,
			QuestionCount:  len(studentAssigns),
			Assignments:    studentAssigns,
		})
	}

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "submissions fetched", Data: submissionList})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
