//go:build !bootstrap

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"
)

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
		if err := client.getRecord("faculty_assignments", req.FacultyAssignmentID, &assignment); err != nil || assignment.FacultyID != current.ID {
			writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Message: "teaching assignment is not available to this faculty"})
			return
		}
		var subjectRecord subject
		if err := client.getRecord("subjects", assignment.SubjectID, &subjectRecord); err != nil {
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
	assignments, err := listFacultyAssignments(client, current.ID)
	if err == nil {
		for _, a := range assignments {
			if a.ID == parts[0] || (a.OfferingID != "" && a.OfferingID == parts[0]) || enrichAssignment(client, a).OfferingID == parts[0] {
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
	if len(parts) == 0 || parts[0] == "" {
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

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodDelete:
			var existingPapers struct {
				Items []questionPaper `json:"items"`
			}
			_ = facultyClient.listRecords("question_papers", fmt.Sprintf(`exam_id = %q`, examRecord.ID), &existingPapers)
			if len(existingPapers.Items) <= 1 {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "cannot delete the only paper set in an exam"})
				return
			}

			var questions struct {
				Items []question `json:"items"`
			}
			_ = facultyClient.listRecords("questions", fmt.Sprintf(`paper_id = %q`, paper.ID), &questions)
			for _, q := range questions.Items {
				_ = facultyClient.deleteRecord("questions", q.ID)
			}

			if err := facultyClient.deleteRecord("question_papers", paper.ID); err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: "failed to delete paper set: " + err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "paper set deleted"})
			return

		case http.MethodPut:
			var req struct {
				Title string `json:"title"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Title) == "" {
				writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "title is required"})
				return
			}
			if err := facultyClient.updateRecord("question_papers", paper.ID, map[string]interface{}{"title": strings.TrimSpace(req.Title)}, nil); err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "paper set updated"})
			return

		default:
			writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
			return
		}
	}

	if len(parts) != 2 || parts[1] != "questions" || r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Message: "route not found"})
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

	var questionsRes struct {
		Items []question `json:"items"`
	}
	_ = client.listRecords("questions", fmt.Sprintf(`exam_id = %q`, examID), &questionsRes)
	qMap := make(map[string]question)
	for _, q := range questionsRes.Items {
		qMap[q.ID] = q
	}

	assignMapByRoll := make(map[string][]assignment)
	assignMapByAttempt := make(map[string][]assignment)
	for _, as := range assignmentsRes.Items {
		if q, ok := qMap[as.QuestionID]; ok {
			if as.QuestionText == "" {
				as.QuestionText = q.Text
			}
			if as.Number == 0 {
				as.Number = q.Number
			}
			if as.Marks == 0 {
				as.Marks = q.Marks
			}
			if len(as.Attachments) == 0 {
				as.Attachments = q.Attachments
			}
		}
		rKey := strings.ToUpper(strings.TrimSpace(as.StudentRollNo))
		assignMapByRoll[rKey] = append(assignMapByRoll[rKey], as)
		if as.AttemptID != "" {
			assignMapByAttempt[as.AttemptID] = append(assignMapByAttempt[as.AttemptID], as)
		}
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

		rKey := strings.ToUpper(strings.TrimSpace(att.StudentRollNo))
		studentAssigns := assignMapByRoll[rKey]
		if len(studentAssigns) == 0 && att.ID != "" {
			studentAssigns = assignMapByAttempt[att.ID]
		}

		answered := 0
		for _, as := range studentAssigns {
			if strings.TrimSpace(as.Response) != "" {
				answered++
			}
		}

		submissionList = append(submissionList, submissionItem{
			StudentName:   name,
			RollNo:        att.StudentRollNo,
			Email:         email,
			PaperTitle:    pap.Title,
			AssignedAt:    att.AssignedAt,
			Status:        att.Status,
			AnsweredCount: answered,
			QuestionCount: len(studentAssigns),
			Assignments:   studentAssigns,
		})
	}

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "submissions fetched", Data: submissionList})
}
