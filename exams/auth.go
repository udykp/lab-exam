//go:build !bootstrap

package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func handleFacultyLogin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req facultyLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	if strings.TrimSpace(req.Email) == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "email and password are required"})
		return
	}
	var auth struct {
		Token  string  `json:"token"`
		Record faculty `json:"record"`
	}
	if err := client.withToken("").doJSON(http.MethodPost, "/api/collections/faculty/auth-with-password", map[string]string{"identity": strings.TrimSpace(req.Email), "password": req.Password}, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "invalid email or password"})
		return
	}
	if auth.Record.Status == "inactive" {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Message: "faculty account is inactive"})
		return
	}
	setFacultySession(w, r, auth.Token)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged in", Data: auth.Record})
}

func handleFacultyLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: facultySessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged out"})
}

func setFacultySession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: facultySessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
}

func requireFaculty(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) (*pocketBaseClient, faculty, bool) {
	cookie, err := r.Cookie(facultySessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "faculty login required"})
		return nil, faculty{}, false
	}
	facultyClient := client.withToken(cookie.Value)
	var auth struct {
		Token  string  `json:"token"`
		Record faculty `json:"record"`
	}
	if err := facultyClient.doJSON(http.MethodPost, "/api/collections/faculty/auth-refresh", nil, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "faculty session is invalid or expired"})
		return nil, faculty{}, false
	}
	setFacultySession(w, r, auth.Token)
	return client, auth.Record, true
}

func handleFacultyMe(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	_, current, ok := requireFaculty(w, r, client)
	if !ok {
		return
	}
	assignments, err := listFacultyAssignments(client, current.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Message: err.Error()})
		return
	}
	enriched := make([]enrichedAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		enriched = append(enriched, enrichAssignment(client, assignment))
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "faculty profile fetched", Data: map[string]interface{}{"faculty": current, "assignments": enriched}})
}

func handleAdminLogin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	var req adminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Message: "invalid request"})
		return
	}
	var auth struct {
		Token  string `json:"token"`
		Record struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"record"`
	}
	if err := client.withToken("").doJSON(http.MethodPost, "/api/collections/_superusers/auth-with-password", map[string]string{"identity": strings.TrimSpace(req.Email), "password": req.Password}, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "invalid email or password"})
		return
	}
	setAdminSession(w, r, auth.Token)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "admin logged in", Data: auth.Record})
}

func handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "logged out"})
}

func setAdminSession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
}

func requireAdmin(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) bool {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "admin login required"})
		return false
	}
	var auth struct {
		Token string `json:"token"`
	}
	if err := client.withToken(cookie.Value).doJSON(http.MethodPost, "/api/collections/_superusers/auth-refresh", nil, &auth); err != nil {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Message: "admin session is invalid or expired"})
		return false
	}
	setAdminSession(w, r, auth.Token)
	return true
}

func handleAdminMe(w http.ResponseWriter, r *http.Request, client *pocketBaseClient) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiResponse{Success: false, Message: "method not allowed"})
		return
	}
	if !requireAdmin(w, r, client) {
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Message: "admin session active"})
}
