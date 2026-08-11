//go:build !bootstrap

package main

import "testing"

func TestParseQuestionsFromText(t *testing.T) {
	text := "1. What is the capital of India?\n\n2. Explain the water cycle."
	questions := parseQuestionsFromText(text)
	if len(questions) != 2 {
		t.Fatalf("expected 2 questions, got %d", len(questions))
	}
	if questions[0] != "What is the capital of India?" {
		t.Fatalf("unexpected first question: %q", questions[0])
	}
}
