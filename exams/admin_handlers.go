//go:build !bootstrap

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

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
