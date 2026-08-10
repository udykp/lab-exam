package store

import (
	"context"

	"securemlexam/internal/domain"
)

type Store interface {
	AuthenticateStudent(ctx context.Context, name, rollNumber string) (*domain.Student, error)
	AuthenticateFaculty(ctx context.Context, email, password string) (*domain.Faculty, error)
	UpsertStudents(ctx context.Context, students []domain.Student) error
	ListStudents(ctx context.Context) ([]domain.Student, error)
	FindStudentByRollNumber(ctx context.Context, rollNumber string) (*domain.Student, error)

	CreateExam(ctx context.Context, exam domain.Exam) (domain.Exam, error)
	ListFacultyExams(ctx context.Context, facultyID string) ([]domain.Exam, error)
	GetExam(ctx context.Context, examID string) (*domain.Exam, error)

	UpsertQuestion(ctx context.Context, question domain.Question) (domain.Question, error)
	ListQuestions(ctx context.Context, examID string) ([]domain.Question, error)
	GetQuestion(ctx context.Context, questionID string) (*domain.Question, error)
	GetQuestionByNumber(ctx context.Context, examID string, number int) (*domain.Question, error)

	AssignQuestion(ctx context.Context, assignment domain.Assignment) error
	AssignQuestionByRollNumber(ctx context.Context, examID, rollNumber string, questionNumber int) (*domain.Assignment, error)
	GetAssignment(ctx context.Context, studentID, examID string) (*domain.Assignment, error)
	GetAssignments(ctx context.Context, studentID, examID string) ([]domain.Assignment, error)
	ListAssignments(ctx context.Context, examID string) ([]domain.Assignment, error)
	ClearAssignments(ctx context.Context, studentID, examID string) error

	SaveAutosave(ctx context.Context, autosave domain.Autosave) error
	ListAutosaves(ctx context.Context, examID string) ([]domain.Autosave, error)

	SaveSubmission(ctx context.Context, submission domain.Submission) error
	ListSubmissions(ctx context.Context, examID string) ([]domain.Submission, error)

	RecordViolation(ctx context.Context, violation domain.Violation) error
	ListViolations(ctx context.Context, examID string) ([]domain.Violation, error)

	UpdateStudentStatus(ctx context.Context, status domain.StudentStatus) error
	ListStudentStatuses(ctx context.Context, examID string) ([]domain.StudentStatus, error)
}
