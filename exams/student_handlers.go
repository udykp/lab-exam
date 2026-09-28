//go:build !bootstrap

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

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
		ExamCode   string            `json:"exam_code"`
		ExamTitle  string            `json:"exam_title"`
		PaperTitle string            `json:"paper_title"`
		Locked     bool              `json:"locked"`
		Questions  []attemptQuestion `json:"questions"`
	}

	attemptsList := make([]attemptWithQuestions, 0)

	var result struct {
		Items []assignment `json:"items"`
	}
	_ = client.listRecords("assignments", fmt.Sprintf(`student_roll_no = %q`, rollNo), &result)

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
			ExamCode:   ex.Code,
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

func handleAttemptsStart(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req struct {
		StudentRollNo string `json:"student_roll_no"`
		ExamID        string `json:"exam_id"`
		ExamCode      string `json:"exam_code"`
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
	}
	if filter != "" {
		_ = client.listRecords("attempts", filter, &attempts)
	}
	if len(attempts.Items) == 0 && (req.ExamCode != "" || req.ExamID != "") {
		codeToLook := strings.TrimSpace(req.ExamCode)
		if codeToLook == "" {
			codeToLook = strings.TrimSpace(req.ExamID)
		}
		var exList struct {
			Items []exam `json:"items"`
		}
		if err := client.listRecords("exams", fmt.Sprintf(`code = %q`, codeToLook), &exList); err == nil && len(exList.Items) > 0 {
			filter = fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, exList.Items[0].ID, req.StudentRollNo)
			_ = client.listRecords("attempts", filter, &attempts)
		}
	}

	if len(attempts.Items) == 0 {
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
		ExamCode      string `json:"exam_code"`
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
	}
	if filter != "" {
		_ = client.listRecords("attempts", filter, &attempts)
	}
	if len(attempts.Items) == 0 && (req.ExamCode != "" || req.ExamID != "") {
		codeToLook := strings.TrimSpace(req.ExamCode)
		if codeToLook == "" {
			codeToLook = strings.TrimSpace(req.ExamID)
		}
		var exList struct {
			Items []exam `json:"items"`
		}
		if err := client.listRecords("exams", fmt.Sprintf(`code = %q`, codeToLook), &exList); err == nil && len(exList.Items) > 0 {
			filter = fmt.Sprintf(`exam_id = %q && student_roll_no = %q`, exList.Items[0].ID, req.StudentRollNo)
			_ = client.listRecords("attempts", filter, &attempts)
		}
	}

	if len(attempts.Items) == 0 {
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
