package memory

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"securemlexam/internal/auth"
	"securemlexam/internal/domain"
	"securemlexam/internal/store"
)

type Store struct {
	mu sync.RWMutex

	students    map[string]domain.Student
	faculty     map[string]domain.Faculty
	exams       map[string]domain.Exam
	questions   map[string]domain.Question
	assignments map[string]domain.Assignment
	autosaves   map[string]domain.Autosave
	submissions map[string]domain.Submission
	violations  map[string]domain.Violation
	statuses    map[string]domain.StudentStatus
}

func NewStore() *Store {
	return &Store{
		students:    make(map[string]domain.Student),
		faculty:     make(map[string]domain.Faculty),
		exams:       make(map[string]domain.Exam),
		questions:   make(map[string]domain.Question),
		assignments: make(map[string]domain.Assignment),
		autosaves:   make(map[string]domain.Autosave),
		submissions: make(map[string]domain.Submission),
		violations:  make(map[string]domain.Violation),
		statuses:    make(map[string]domain.StudentStatus),
	}
}

var _ store.Store = (*Store)(nil)

func (s *Store) SeedDemoData() {
	now := time.Now().UTC()
	facultyPassword, _ := auth.HashPassword("Admin@123")

	s.mu.Lock()
	defer s.mu.Unlock()

	faculty := domain.Faculty{ID: "fac-1", Email: "faculty@securemlexam.local", Name: "Demo Faculty", PasswordHash: facultyPassword, CreatedAt: now}
	student := domain.Student{ID: "stu-1", RollNumber: "220101", Name: "Demo Student", CreatedAt: now}
	exam := domain.Exam{ID: "exam-1", Title: "Lab Examination", Course: "Practical Programming Lab", Duration: 90, StartTime: now.Add(-10 * time.Minute), EndTime: now.Add(80 * time.Minute), CreatedBy: faculty.ID, Status: "active"}
	questions := []domain.Question{
		{ID: "q-1", ExamID: exam.ID, Number: 1, Title: "Programming Task 1", Prompt: "Write a program to solve your first practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-2", ExamID: exam.ID, Number: 2, Title: "Programming Task 2", Prompt: "Write a program to solve your second practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-3", ExamID: exam.ID, Number: 3, Title: "Programming Task 3", Prompt: "Write a program to solve your third practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-4", ExamID: exam.ID, Number: 4, Title: "Programming Task 4", Prompt: "Write a program to solve your fourth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-5", ExamID: exam.ID, Number: 5, Title: "Programming Task 5", Prompt: "Write a program to solve your fifth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-6", ExamID: exam.ID, Number: 6, Title: "Programming Task 6", Prompt: "Write a program to solve your sixth practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-7", ExamID: exam.ID, Number: 7, Title: "Programming Task 7", Prompt: "Write a program to solve your seventh practical task.", Language: "python", Meta: map[string]string{"difficulty": "easy"}},
		{ID: "q-8", ExamID: exam.ID, Number: 8, Title: "Programming Task 8", Prompt: "Write a program to solve your eighth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-9", ExamID: exam.ID, Number: 9, Title: "Programming Task 9", Prompt: "Write a program to solve your ninth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
		{ID: "q-10", ExamID: exam.ID, Number: 10, Title: "Programming Task 10", Prompt: "Write a program to solve your tenth practical task.", Language: "python", Meta: map[string]string{"difficulty": "medium"}},
	}

	s.faculty[faculty.ID] = faculty
	s.students[student.ID] = student
	s.exams[exam.ID] = exam
	for _, question := range questions {
		s.questions[question.ID] = question
	}
	s.assignments[student.ID+":"+exam.ID+":q-1"] = domain.Assignment{StudentID: student.ID, ExamID: exam.ID, QuestionID: "q-1", QuestionNumber: 1}
	s.assignments[student.ID+":"+exam.ID+":q-2"] = domain.Assignment{StudentID: student.ID, ExamID: exam.ID, QuestionID: "q-2", QuestionNumber: 2}
	s.statuses[student.ID+":"+exam.ID] = domain.StudentStatus{StudentID: student.ID, ExamID: exam.ID, State: "assigned", UpdatedAt: now}
}

func (s *Store) AuthenticateStudent(_ context.Context, name, rollNumber string) (*domain.Student, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, student := range s.students {
		if student.RollNumber == rollNumber && strings.EqualFold(strings.TrimSpace(student.Name), strings.TrimSpace(name)) {
			copy := student
			return &copy, nil
		}
	}
	return nil, errors.New("invalid student credentials")
}

func (s *Store) AuthenticateFaculty(_ context.Context, email, password string) (*domain.Faculty, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, faculty := range s.faculty {
		if faculty.Email == email && auth.VerifyPassword(faculty.PasswordHash, password) {
			copy := faculty
			return &copy, nil
		}
	}
	return nil, errors.New("invalid faculty credentials")
}

func (s *Store) UpsertStudents(_ context.Context, students []domain.Student) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, student := range students {
		if student.ID == "" {
			student.ID = fmt.Sprintf("stu-%d", len(s.students)+1)
		}
		if student.CreatedAt.IsZero() {
			student.CreatedAt = time.Now().UTC()
		}
		s.students[student.ID] = student
	}
	return nil
}

func (s *Store) ListStudents(_ context.Context) ([]domain.Student, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	students := make([]domain.Student, 0, len(s.students))
	for _, student := range s.students {
		students = append(students, student)
	}
	sort.Slice(students, func(i, j int) bool { return students[i].RollNumber < students[j].RollNumber })
	return students, nil
}

func (s *Store) FindStudentByRollNumber(_ context.Context, rollNumber string) (*domain.Student, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, student := range s.students {
		if student.RollNumber == rollNumber {
			copy := student
			return &copy, nil
		}
	}
	return nil, errors.New("student not found")
}

func (s *Store) CreateExam(_ context.Context, exam domain.Exam) (domain.Exam, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if exam.ID == "" {
		exam.ID = fmt.Sprintf("exam-%d", len(s.exams)+1)
	}
	s.exams[exam.ID] = exam
	return exam, nil
}

func (s *Store) ListFacultyExams(_ context.Context, facultyID string) ([]domain.Exam, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var exams []domain.Exam
	for _, exam := range s.exams {
		if exam.CreatedBy == facultyID {
			exams = append(exams, exam)
		}
	}
	sort.Slice(exams, func(i, j int) bool { return exams[i].StartTime.Before(exams[j].StartTime) })
	return exams, nil
}

func (s *Store) GetExam(_ context.Context, examID string) (*domain.Exam, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	exam, ok := s.exams[examID]
	if !ok {
		return nil, errors.New("exam not found")
	}
	copy := exam
	return &copy, nil
}

func (s *Store) UpsertQuestion(_ context.Context, question domain.Question) (domain.Question, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if question.ID == "" {
		for _, existing := range s.questions {
			if existing.ExamID == question.ExamID && existing.Number == question.Number && question.Number != 0 {
				question.ID = existing.ID
				break
			}
		}
		if question.ID == "" {
			question.ID = fmt.Sprintf("q-%d", len(s.questions)+1)
		}
	}
	s.questions[question.ID] = question
	return question, nil
}

func (s *Store) ListQuestions(_ context.Context, examID string) ([]domain.Question, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var questions []domain.Question
	for _, question := range s.questions {
		if question.ExamID == examID {
			questions = append(questions, question)
		}
	}
	sort.Slice(questions, func(i, j int) bool { return questions[i].Number < questions[j].Number })
	return questions, nil
}

func (s *Store) GetQuestion(_ context.Context, questionID string) (*domain.Question, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	question, ok := s.questions[questionID]
	if !ok {
		return nil, errors.New("question not found")
	}
	copy := question
	return &copy, nil
}

func (s *Store) GetQuestionByNumber(_ context.Context, examID string, number int) (*domain.Question, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, question := range s.questions {
		if question.ExamID == examID && question.Number == number {
			copy := question
			return &copy, nil
		}
	}
	return nil, errors.New("question not found")
}

func (s *Store) AssignQuestion(_ context.Context, assignment domain.Assignment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.assignments[assignment.StudentID+":"+assignment.ExamID+":"+assignment.QuestionID] = assignment
	return nil
}

func (s *Store) AssignQuestionByRollNumber(ctx context.Context, examID, rollNumber string, questionNumber int) (*domain.Assignment, error) {
	student, err := s.FindStudentByRollNumber(ctx, rollNumber)
	if err != nil {
		return nil, err
	}
	question, err := s.GetQuestionByNumber(ctx, examID, questionNumber)
	if err != nil {
		return nil, err
	}
	assignment := domain.Assignment{StudentID: student.ID, ExamID: examID, QuestionID: question.ID, QuestionNumber: questionNumber}
	if err := s.AssignQuestion(ctx, assignment); err != nil {
		return nil, err
	}
	return &assignment, nil
}

func (s *Store) GetAssignment(_ context.Context, studentID, examID string) (*domain.Assignment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, assignment := range s.assignments {
		if assignment.StudentID == studentID && assignment.ExamID == examID {
			copy := assignment
			return &copy, nil
		}
	}
	return nil, errors.New("assignment not found")
}

func (s *Store) GetAssignments(_ context.Context, studentID, examID string) ([]domain.Assignment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var assignments []domain.Assignment
	for _, assignment := range s.assignments {
		if assignment.StudentID == studentID && assignment.ExamID == examID {
			assignments = append(assignments, assignment)
		}
	}
	return assignments, nil
}

func (s *Store) ListAssignments(_ context.Context, examID string) ([]domain.Assignment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var assignments []domain.Assignment
	for _, assignment := range s.assignments {
		if assignment.ExamID == examID {
			assignments = append(assignments, assignment)
		}
	}
	return assignments, nil
}

func (s *Store) ClearAssignments(_ context.Context, studentID, examID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, assignment := range s.assignments {
		if assignment.StudentID == studentID && assignment.ExamID == examID {
			delete(s.assignments, key)
		}
	}
	return nil
}

func (s *Store) SaveAutosave(_ context.Context, autosave domain.Autosave) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if autosave.ID == "" {
		autosave.ID = fmt.Sprintf("auto-%d", len(s.autosaves)+1)
	}
	autosave.SavedAt = time.Now().UTC()
	s.autosaves[autosave.ID] = autosave
	return nil
}

func (s *Store) ListAutosaves(_ context.Context, examID string) ([]domain.Autosave, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var autosaves []domain.Autosave
	for _, autosave := range s.autosaves {
		if autosave.ExamID == examID {
			autosaves = append(autosaves, autosave)
		}
	}
	return autosaves, nil
}

func (s *Store) SaveSubmission(_ context.Context, submission domain.Submission) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if submission.ID == "" {
		submission.ID = fmt.Sprintf("sub-%d", len(s.submissions)+1)
	}
	submission.SubmittedAt = time.Now().UTC()
	if submission.Status == "" {
		submission.Status = "submitted"
	}
	s.submissions[submission.ID] = submission
	statusKey := submission.StudentID + ":" + submission.ExamID
	s.statuses[statusKey] = domain.StudentStatus{StudentID: submission.StudentID, ExamID: submission.ExamID, State: "submitted", UpdatedAt: time.Now().UTC()}
	return nil
}

func (s *Store) ListSubmissions(_ context.Context, examID string) ([]domain.Submission, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var submissions []domain.Submission
	for _, submission := range s.submissions {
		if submission.ExamID == examID {
			submissions = append(submissions, submission)
		}
	}
	return submissions, nil
}

func (s *Store) RecordViolation(_ context.Context, violation domain.Violation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if violation.ID == "" {
		violation.ID = fmt.Sprintf("vio-%d", len(s.violations)+1)
	}
	violation.OccurredAt = time.Now().UTC()
	s.violations[violation.ID] = violation
	statusKey := violation.StudentID + ":" + violation.ExamID
	s.statuses[statusKey] = domain.StudentStatus{StudentID: violation.StudentID, ExamID: violation.ExamID, State: "violation", UpdatedAt: time.Now().UTC()}
	return nil
}

func (s *Store) ListViolations(_ context.Context, examID string) ([]domain.Violation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var violations []domain.Violation
	for _, violation := range s.violations {
		if violation.ExamID == examID {
			violations = append(violations, violation)
		}
	}
	return violations, nil
}

func (s *Store) UpdateStudentStatus(_ context.Context, status domain.StudentStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if status.UpdatedAt.IsZero() {
		status.UpdatedAt = time.Now().UTC()
	}
	s.statuses[status.StudentID+":"+status.ExamID] = status
	return nil
}

func (s *Store) ListStudentStatuses(_ context.Context, examID string) ([]domain.StudentStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var statuses []domain.StudentStatus
	for _, status := range s.statuses {
		if status.ExamID == examID {
			statuses = append(statuses, status)
		}
	}
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].StudentID < statuses[j].StudentID })
	return statuses, nil
}
