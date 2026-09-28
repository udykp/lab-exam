//go:build !bootstrap

package main

import (
	"fmt"
	"net/http"
	"os"
)

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
	webDir := "web-frontend"
	if _, err := os.Stat(webDir); os.IsNotExist(err) {
		webDir = "web"
	}
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	fmt.Printf("server listening on http://localhost:%s\n", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		panic(err)
	}
}
