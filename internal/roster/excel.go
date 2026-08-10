package roster

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"securemlexam/internal/domain"
)

func ParseExcelStudents(reader io.Reader) ([]domain.Student, error) {
	file, err := excelize.OpenReader(reader)
	if err != nil {
		return nil, fmt.Errorf("open excel file: %w", err)
	}
	defer func() { _ = file.Close() }()

	sheets := file.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("excel file has no sheets")
	}

	rows, err := file.GetRows(sheets[0])
	if err != nil {
		return nil, fmt.Errorf("read sheet rows: %w", err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("excel sheet is empty")
	}

	nameIndex := -1
	rollIndex := -1
	header := rows[0]
	for index, cell := range header {
		normalized := strings.ToLower(strings.TrimSpace(cell))
		switch normalized {
		case "name", "student name", "full name":
			nameIndex = index
		case "roll no", "roll number", "roll_number", "roll no.", "roll no ":
			rollIndex = index
		}
	}
	if nameIndex == -1 || rollIndex == -1 {
		return nil, fmt.Errorf("expected columns for name and roll number in the first row")
	}

	students := make([]domain.Student, 0, len(rows)-1)
	for rowIndex, row := range rows[1:] {
		if len(row) <= nameIndex || len(row) <= rollIndex {
			continue
		}
		name := strings.TrimSpace(row[nameIndex])
		rollNumber := strings.TrimSpace(row[rollIndex])
		if name == "" || rollNumber == "" {
			continue
		}
		students = append(students, domain.Student{
			ID:         fmt.Sprintf("stu-import-%d", rowIndex+1),
			Name:       name,
			RollNumber: rollNumber,
			CreatedAt:  time.Now().UTC(),
		})
	}

	if len(students) == 0 {
		return nil, fmt.Errorf("no valid student rows found")
	}
	return students, nil
}
