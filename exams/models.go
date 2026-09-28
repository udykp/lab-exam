//go:build !bootstrap

package main

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
	Code                string `json:"code,omitempty"`
	Title               string `json:"title"`
	Year                string `json:"year"`
	Semester            string `json:"semester"`
	Section             string `json:"section"`
	Subject             string `json:"subject"`
	OfferingID          string `json:"offering_id,omitempty"`
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
	ID            string   `json:"id"`
	ExamID        string   `json:"exam_id,omitempty"`
	PaperID       string   `json:"paper_id,omitempty"`
	StudentRollNo string   `json:"student_roll_no"`
	QuestionID    string   `json:"question_id"`
	QuestionText  string   `json:"question_text"`
	Number        int      `json:"number,omitempty"`
	Marks         int      `json:"marks,omitempty"`
	Attachments   []string `json:"attachments,omitempty"`
	AssignedAt    string   `json:"assigned_at"`
	Response      string   `json:"response,omitempty"`
	SubmittedAt   string   `json:"submitted_at,omitempty"`
	AttemptID     string   `json:"attempt_id,omitempty"`
}

type attempt struct {
	ID            string `json:"id"`
	ExamID        string `json:"exam_id"`
	PaperID       string `json:"paper_id"`
	StudentRollNo string `json:"student_roll_no"`
	StudentID     string `json:"student_id,omitempty"`
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
