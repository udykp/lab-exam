//go:build !bootstrap

package main

import (
	"os"
	"strings"
)

const defaultPort = "8080"
const facultySessionCookie = "exam_faculty_session"
const adminSessionCookie = "exam_admin_session"
const defaultPocketBaseAdminEmail = "admin@gmail.com"
const defaultPocketBaseAdminPassword = "crrao@1234"

type config struct {
	Port            string
	PocketBaseURL   string
	PocketBaseEmail string
	PocketBasePass  string
}

func loadConfig() config {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = defaultPort
	}
	baseURL := strings.TrimSpace(os.Getenv("POCKETBASE_URL"))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8090"
	}
	adminEmail := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = defaultPocketBaseAdminEmail
	}
	adminPass := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_PASSWORD"))
	if adminPass == "" {
		adminPass = defaultPocketBaseAdminPassword
	}
	return config{
		Port:            port,
		PocketBaseURL:   strings.TrimRight(baseURL, "/"),
		PocketBaseEmail: adminEmail,
		PocketBasePass:  adminPass,
	}
}
