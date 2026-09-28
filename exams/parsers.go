//go:build !bootstrap

package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

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

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
