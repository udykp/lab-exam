package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"securemlexam/internal/auth"
	"securemlexam/internal/domain"
	"securemlexam/internal/store"
)

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

var _ store.Store = (*Store)(nil)

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(1)

	s := &Store{db: db}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS faculty (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS students (
		id TEXT PRIMARY KEY,
		roll_number TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS exams (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		course TEXT NOT NULL,
		duration INTEGER NOT NULL,
		start_time DATETIME NOT NULL,
		end_time DATETIME NOT NULL,
		created_by TEXT NOT NULL,
		status TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS questions (
		id TEXT PRIMARY KEY,
		exam_id TEXT NOT NULL,
		number INTEGER NOT NULL,
		title TEXT NOT NULL,
		prompt TEXT NOT NULL,
		language TEXT NOT NULL,
		meta_json TEXT,
		UNIQUE(exam_id, number)
	);

	CREATE TABLE IF NOT EXISTS assignments (
		student_id TEXT NOT NULL,
		exam_id TEXT NOT NULL,
		question_id TEXT NOT NULL,
		question_number INTEGER NOT NULL,
		PRIMARY KEY (student_id, exam_id, question_id)
	);

	CREATE TABLE IF NOT EXISTS autosaves (
		id TEXT PRIMARY KEY,
		student_id TEXT NOT NULL,
		exam_id TEXT NOT NULL,
		question_id TEXT NOT NULL,
		code TEXT NOT NULL,
		timestamp DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS submissions (
		id TEXT PRIMARY KEY,
		student_id TEXT NOT NULL,
		exam_id TEXT NOT NULL,
		question_id TEXT NOT NULL,
		code TEXT NOT NULL,
		submitted_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS violations (
		id TEXT PRIMARY KEY,
		student_id TEXT NOT NULL,
		exam_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		details TEXT NOT NULL,
		timestamp DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS student_statuses (
		student_id TEXT NOT NULL,
		exam_id TEXT NOT NULL,
		state TEXT NOT NULL,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY (student_id, exam_id)
	);
	`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Store) SeedDemoData() {
	now := time.Now().UTC()
	facultyPassword, _ := auth.HashPassword("Admin@123")

	ctx := context.Background()

	var count int
	s.db.QueryRow("SELECT COUNT(*) FROM faculty").Scan(&count)
	if count > 0 {
		return
	}

	log.Println("[SQLite Store] Seeding demo data...")

	s.db.ExecContext(ctx, `INSERT OR IGNORE INTO faculty (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		"fac-1", "faculty@securemlexam.local", "Demo Faculty", facultyPassword, now)

	s.db.ExecContext(ctx, `INSERT OR IGNORE INTO students (id, roll_number, name, created_at) VALUES (?, ?, ?, ?)`,
		"stu-1", "220101", "Demo Student", now)

	s.db.ExecContext(ctx, `INSERT OR IGNORE INTO exams (id, title, course, duration, start_time, end_time, created_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"exam-1", "Lab Examination", "Practical Programming Lab", 90, now.Add(-10*time.Minute), now.Add(80*time.Minute), "fac-1", "active")

	questions := []domain.Question{
		{ID: "q-1", ExamID: "exam-1", Number: 1, Title: "Programming Task 1", Prompt: "Write a program to solve your first practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-2", ExamID: "exam-1", Number: 2, Title: "Programming Task 2", Prompt: "Write a program to solve your second practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-3", ExamID: "exam-1", Number: 3, Title: "Programming Task 3", Prompt: "Write a program to solve your third practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-4", ExamID: "exam-1", Number: 4, Title: "Programming Task 4", Prompt: "Write a program to solve your fourth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-5", ExamID: "exam-1", Number: 5, Title: "Programming Task 5", Prompt: "Write a program to solve your fifth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-6", ExamID: "exam-1", Number: 6, Title: "Programming Task 6", Prompt: "Write a program to solve your sixth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-7", ExamID: "exam-1", Number: 7, Title: "Programming Task 7", Prompt: "Write a program to solve your seventh practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-8", ExamID: "exam-1", Number: 8, Title: "Programming Task 8", Prompt: "Write a program to solve your eighth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-9", ExamID: "exam-1", Number: 9, Title: "Programming Task 9", Prompt: "Write a program to solve your ninth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-10", ExamID: "exam-1", Number: 10, Title: "Programming Task 10", Prompt: "Write a program to solve your tenth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
	}

	for _, q := range questions {
		metaBytes, _ := json.Marshal(q.Meta)
		s.db.ExecContext(ctx, `INSERT OR IGNORE INTO questions (id, exam_id, number, title, prompt, language, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			q.ID, q.ExamID, q.Number, q.Title, q.Prompt, q.Language, string(metaBytes))
	}

	s.db.ExecContext(ctx, `INSERT OR IGNORE INTO assignments (student_id, exam_id, question_id, question_number) VALUES (?, ?, ?, ?)`,
		"stu-1", "exam-1", "q-1", 1)

	s.db.ExecContext(ctx, `INSERT OR IGNORE INTO student_statuses (student_id, exam_id, state, updated_at) VALUES (?, ?, ?, ?)`,
		"stu-1", "exam-1", "assigned", now)
}

func (s *Store) AuthenticateStudent(ctx context.Context, name, rollNumber string) (*domain.Student, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, roll_number, name, created_at FROM students WHERE roll_number = ?`, rollNumber)
	var stu domain.Student
	if err := row.Scan(&stu.ID, &stu.RollNumber, &stu.Name, &stu.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("invalid student credentials")
		}
		return nil, err
	}

	if !strings.EqualFold(strings.TrimSpace(stu.Name), strings.TrimSpace(name)) {
		return nil, errors.New("invalid student credentials")
	}

	return &stu, nil
}

func (s *Store) AuthenticateFaculty(ctx context.Context, email, password string) (*domain.Faculty, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, email, name, password_hash, created_at FROM faculty WHERE email = ?`, email)
	var fac domain.Faculty
	if err := row.Scan(&fac.ID, &fac.Email, &fac.Name, &fac.PasswordHash, &fac.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("invalid faculty credentials")
		}
		return nil, err
	}

	if !auth.VerifyPassword(fac.PasswordHash, password) {
		return nil, errors.New("invalid faculty credentials")
	}

	return &fac, nil
}

func (s *Store) UpsertStudents(ctx context.Context, students []domain.Student) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO students (id, roll_number, name, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(roll_number) DO UPDATE SET
			name = excluded.name;
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, st := range students {
		if _, err := stmt.ExecContext(ctx, st.ID, st.RollNumber, st.Name, st.CreatedAt); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) ListStudents(ctx context.Context) ([]domain.Student, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, roll_number, name, created_at FROM students ORDER BY roll_number ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var students []domain.Student
	for rows.Next() {
		var st domain.Student
		if err := rows.Scan(&st.ID, &st.RollNumber, &st.Name, &st.CreatedAt); err != nil {
			return nil, err
		}
		students = append(students, st)
	}
	return students, nil
}

func (s *Store) FindStudentByRollNumber(ctx context.Context, rollNumber string) (*domain.Student, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, roll_number, name, created_at FROM students WHERE roll_number = ?`, rollNumber)
	var st domain.Student
	if err := row.Scan(&st.ID, &st.RollNumber, &st.Name, &st.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("student not found")
		}
		return nil, err
	}
	return &st, nil
}

func (s *Store) CreateExam(ctx context.Context, exam domain.Exam) (domain.Exam, error) {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO exams (id, title, course, duration, start_time, end_time, created_by, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, exam.ID, exam.Title, exam.Course, exam.Duration, exam.StartTime, exam.EndTime, exam.CreatedBy, exam.Status)
	if err != nil {
		return domain.Exam{}, err
	}
	return exam, nil
}

func (s *Store) ListFacultyExams(ctx context.Context, facultyID string) ([]domain.Exam, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, title, course, duration, start_time, end_time, created_by, status FROM exams WHERE created_by = ? ORDER BY start_time DESC`, facultyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var exams []domain.Exam
	for rows.Next() {
		var e domain.Exam
		if err := rows.Scan(&e.ID, &e.Title, &e.Course, &e.Duration, &e.StartTime, &e.EndTime, &e.CreatedBy, &e.Status); err != nil {
			return nil, err
		}
		exams = append(exams, e)
	}
	return exams, nil
}

func (s *Store) GetExam(ctx context.Context, examID string) (*domain.Exam, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, title, course, duration, start_time, end_time, created_by, status FROM exams WHERE id = ?`, examID)
	var e domain.Exam
	if err := row.Scan(&e.ID, &e.Title, &e.Course, &e.Duration, &e.StartTime, &e.EndTime, &e.CreatedBy, &e.Status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("exam not found")
		}
		return nil, err
	}
	return &e, nil
}

func (s *Store) UpsertQuestion(ctx context.Context, q domain.Question) (domain.Question, error) {
	metaBytes, _ := json.Marshal(q.Meta)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO questions (id, exam_id, number, title, prompt, language, meta_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			prompt = excluded.prompt,
			language = excluded.language,
			meta_json = excluded.meta_json;
	`, q.ID, q.ExamID, q.Number, q.Title, q.Prompt, q.Language, string(metaBytes))
	if err != nil {
		return domain.Question{}, err
	}
	return q, nil
}

func (s *Store) ListQuestions(ctx context.Context, examID string) ([]domain.Question, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, exam_id, number, title, prompt, language, meta_json FROM questions WHERE exam_id = ? ORDER BY number ASC`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var questions []domain.Question
	for rows.Next() {
		var q domain.Question
		var metaJSON sql.NullString
		if err := rows.Scan(&q.ID, &q.ExamID, &q.Number, &q.Title, &q.Prompt, &q.Language, &metaJSON); err != nil {
			return nil, err
		}
		if metaJSON.Valid && metaJSON.String != "" {
			_ = json.Unmarshal([]byte(metaJSON.String), &q.Meta)
		}
		questions = append(questions, q)
	}
	return questions, nil
}

func (s *Store) GetQuestion(ctx context.Context, questionID string) (*domain.Question, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, exam_id, number, title, prompt, language, meta_json FROM questions WHERE id = ?`, questionID)
	var q domain.Question
	var metaJSON sql.NullString
	if err := row.Scan(&q.ID, &q.ExamID, &q.Number, &q.Title, &q.Prompt, &q.Language, &metaJSON); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("question not found")
		}
		return nil, err
	}
	if metaJSON.Valid && metaJSON.String != "" {
		_ = json.Unmarshal([]byte(metaJSON.String), &q.Meta)
	}
	return &q, nil
}

func (s *Store) GetQuestionByNumber(ctx context.Context, examID string, number int) (*domain.Question, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, exam_id, number, title, prompt, language, meta_json FROM questions WHERE exam_id = ? AND number = ?`, examID, number)
	var q domain.Question
	var metaJSON sql.NullString
	if err := row.Scan(&q.ID, &q.ExamID, &q.Number, &q.Title, &q.Prompt, &q.Language, &metaJSON); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("question not found for specified number")
		}
		return nil, err
	}
	if metaJSON.Valid && metaJSON.String != "" {
		_ = json.Unmarshal([]byte(metaJSON.String), &q.Meta)
	}
	return &q, nil
}

func (s *Store) AssignQuestion(ctx context.Context, a domain.Assignment) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO assignments (student_id, exam_id, question_id, question_number)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(student_id, exam_id, question_id) DO NOTHING;
	`, a.StudentID, a.ExamID, a.QuestionID, a.QuestionNumber)
	return err
}

func (s *Store) AssignQuestionByRollNumber(ctx context.Context, examID, rollNumber string, questionNumber int) (*domain.Assignment, error) {
	student, err := s.FindStudentByRollNumber(ctx, rollNumber)
	if err != nil {
		return nil, err
	}

	q, err := s.GetQuestionByNumber(ctx, examID, questionNumber)
	if err != nil {
		return nil, err
	}

	assignment := domain.Assignment{
		StudentID:      student.ID,
		ExamID:         examID,
		QuestionID:     q.ID,
		QuestionNumber: q.Number,
	}

	if err := s.AssignQuestion(ctx, assignment); err != nil {
		return nil, err
	}

	return &assignment, nil
}

func (s *Store) GetAssignment(ctx context.Context, studentID, examID string) (*domain.Assignment, error) {
	row := s.db.QueryRowContext(ctx, `SELECT student_id, exam_id, question_id, question_number FROM assignments WHERE student_id = ? AND exam_id = ? LIMIT 1`, studentID, examID)
	var a domain.Assignment
	if err := row.Scan(&a.StudentID, &a.ExamID, &a.QuestionID, &a.QuestionNumber); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("assignment not found")
		}
		return nil, err
	}
	return &a, nil
}

func (s *Store) GetAssignments(ctx context.Context, studentID, examID string) ([]domain.Assignment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT student_id, exam_id, question_id, question_number FROM assignments WHERE student_id = ? AND exam_id = ?`, studentID, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []domain.Assignment
	for rows.Next() {
		var a domain.Assignment
		if err := rows.Scan(&a.StudentID, &a.ExamID, &a.QuestionID, &a.QuestionNumber); err != nil {
			return nil, err
		}
		assignments = append(assignments, a)
	}
	return assignments, nil
}

func (s *Store) ListAssignments(ctx context.Context, examID string) ([]domain.Assignment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT student_id, exam_id, question_id, question_number FROM assignments WHERE exam_id = ?`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []domain.Assignment
	for rows.Next() {
		var a domain.Assignment
		if err := rows.Scan(&a.StudentID, &a.ExamID, &a.QuestionID, &a.QuestionNumber); err != nil {
			return nil, err
		}
		assignments = append(assignments, a)
	}
	return assignments, nil
}

func (s *Store) SaveAutosave(ctx context.Context, a domain.Autosave) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO autosaves (id, student_id, exam_id, question_id, code, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			code = excluded.code,
			timestamp = excluded.timestamp;
	`, a.ID, a.StudentID, a.ExamID, a.QuestionID, a.Code, a.SavedAt)
	return err
}

func (s *Store) ListAutosaves(ctx context.Context, examID string) ([]domain.Autosave, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, student_id, exam_id, question_id, code, timestamp FROM autosaves WHERE exam_id = ? ORDER BY timestamp DESC`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var autosaves []domain.Autosave
	for rows.Next() {
		var a domain.Autosave
		if err := rows.Scan(&a.ID, &a.StudentID, &a.ExamID, &a.QuestionID, &a.Code, &a.SavedAt); err != nil {
			return nil, err
		}
		autosaves = append(autosaves, a)
	}
	return autosaves, nil
}

func (s *Store) SaveSubmission(ctx context.Context, sub domain.Submission) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO submissions (id, student_id, exam_id, question_id, code, submitted_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			code = excluded.code,
			submitted_at = excluded.submitted_at;
	`, sub.ID, sub.StudentID, sub.ExamID, sub.QuestionID, sub.Code, sub.SubmittedAt)
	return err
}

func (s *Store) ListSubmissions(ctx context.Context, examID string) ([]domain.Submission, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, student_id, exam_id, question_id, code, submitted_at FROM submissions WHERE exam_id = ? ORDER BY submitted_at DESC`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var submissions []domain.Submission
	for rows.Next() {
		var sub domain.Submission
		if err := rows.Scan(&sub.ID, &sub.StudentID, &sub.ExamID, &sub.QuestionID, &sub.Code, &sub.SubmittedAt); err != nil {
			return nil, err
		}
		submissions = append(submissions, sub)
	}
	return submissions, nil
}

func (s *Store) RecordViolation(ctx context.Context, v domain.Violation) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO violations (id, student_id, exam_id, kind, details, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)
	`, v.ID, v.StudentID, v.ExamID, v.Kind, v.Details, v.OccurredAt)
	return err
}

func (s *Store) ListViolations(ctx context.Context, examID string) ([]domain.Violation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, student_id, exam_id, kind, details, timestamp FROM violations WHERE exam_id = ? ORDER BY timestamp DESC`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var violations []domain.Violation
	for rows.Next() {
		var v domain.Violation
		if err := rows.Scan(&v.ID, &v.StudentID, &v.ExamID, &v.Kind, &v.Details, &v.OccurredAt); err != nil {
			return nil, err
		}
		violations = append(violations, v)
	}
	return violations, nil
}

func (s *Store) UpdateStudentStatus(ctx context.Context, st domain.StudentStatus) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO student_statuses (student_id, exam_id, state, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(student_id, exam_id) DO UPDATE SET
			state = excluded.state,
			updated_at = excluded.updated_at;
	`, st.StudentID, st.ExamID, st.State, st.UpdatedAt)
	return err
}

func (s *Store) ListStudentStatuses(ctx context.Context, examID string) ([]domain.StudentStatus, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT student_id, exam_id, state, updated_at FROM student_statuses WHERE exam_id = ?`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var statuses []domain.StudentStatus
	for rows.Next() {
		var st domain.StudentStatus
		if err := rows.Scan(&st.StudentID, &st.ExamID, &st.State, &st.UpdatedAt); err != nil {
			return nil, err
		}
		statuses = append(statuses, st)
	}
	return statuses, nil
}
