//go:build bootstrap

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type bootstrapConfig struct {
	baseURL    string
	adminEmail string
	adminPass  string
	client     *http.Client
	token      string
}

type collectionSchemaField struct {
	Name                string   `json:"name"`
	Type                string   `json:"type"`
	Required            bool     `json:"required"`
	Unique              bool     `json:"unique,omitempty"`
	System              bool     `json:"system,omitempty"`
	Hidden              bool     `json:"hidden,omitempty"`
	Presentable         bool     `json:"presentable,omitempty"`
	PrimaryKey          bool     `json:"primaryKey,omitempty"`
	Help                string   `json:"help,omitempty"`
	Min                 float64  `json:"min,omitempty"`
	Max                 float64  `json:"max,omitempty"`
	Pattern             string   `json:"pattern,omitempty"`
	AutogeneratePattern string   `json:"autogeneratePattern,omitempty"`
	OnlyInt             bool     `json:"onlyInt,omitempty"`
	MaxSelect           int      `json:"maxSelect,omitempty"`
	MaxSize             int64    `json:"maxSize,omitempty"`
	MimeTypes           []string `json:"mimeTypes,omitempty"`
	Protected           bool     `json:"protected,omitempty"`
}

type collectionPayload struct {
	Name         string                  `json:"name"`
	Type         string                  `json:"type"`
	Fields       []collectionSchemaField `json:"fields"`
	PasswordAuth *passwordAuthConfig     `json:"passwordAuth,omitempty"`
	ListRule     *string                 `json:"listRule"`
	ViewRule     *string                 `json:"viewRule"`
	CreateRule   *string                 `json:"createRule"`
	UpdateRule   *string                 `json:"updateRule"`
	DeleteRule   *string                 `json:"deleteRule"`
}

type passwordAuthConfig struct {
	Enabled        bool     `json:"enabled"`
	IdentityFields []string `json:"identityFields"`
}

func main() {
	cfg := loadBootstrapConfig()
	client := &bootstrapConfig{
		baseURL:    cfg.baseURL,
		adminEmail: cfg.adminEmail,
		adminPass:  cfg.adminPass,
		client:     &http.Client{Timeout: 30 * time.Second},
	}

	if err := client.healthCheck(); err != nil {
		panic(err)
	}
	if err := client.authenticate(); err != nil {
		panic(err)
	}
	if err := client.bootstrapCollections(); err != nil {
		panic(err)
	}

	fmt.Println("PocketBase collections are ready")
}

func loadBootstrapConfig() bootstrapConfig {
	baseURL := strings.TrimSpace(os.Getenv("POCKETBASE_URL"))
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8090"
	}
	adminEmail := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = "admin@gmail.com"
	}
	adminPass := strings.TrimSpace(os.Getenv("POCKETBASE_ADMIN_PASSWORD"))
	if adminPass == "" {
		adminPass = "crrao@1234"
	}
	return bootstrapConfig{
		baseURL:    strings.TrimRight(baseURL, "/"),
		adminEmail: adminEmail,
		adminPass:  adminPass,
		client:     &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *bootstrapConfig) healthCheck() error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("pocketbase is not reachable at %s: %w", c.baseURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pocketbase health check failed: %s", strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *bootstrapConfig) authenticate() error {
	if c.adminEmail == "" || c.adminPass == "" {
		return fmt.Errorf("set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD before running the bootstrap command")
	}
	var resp struct {
		Token string `json:"token"`
	}
	if err := c.doJSON(http.MethodPost, "/api/collections/_superusers/auth-with-password", map[string]string{
		"identity": c.adminEmail,
		"password": c.adminPass,
	}, &resp); err != nil {
		return err
	}
	c.token = resp.Token
	return nil
}

func (c *bootstrapConfig) bootstrapCollections() error {
	textRule := ""
	collections := []collectionPayload{
		{
			Name: "faculty",
			Type: "auth",
			Fields: []collectionSchemaField{
				{Name: "name", Type: "text", Required: true},
				{Name: "status", Type: "text"},
			},
			PasswordAuth: &passwordAuthConfig{Enabled: true, IdentityFields: []string{"email"}},
		},
		{
			Name: "subjects",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "code", Type: "text", Required: true, Unique: true},
				{Name: "name", Type: "text", Required: true},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "faculty_assignments",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "faculty_id", Type: "text", Required: true},
				{Name: "subject_id", Type: "text", Required: true},
				{Name: "year", Type: "text", Required: true},
				{Name: "semester", Type: "text", Required: true},
				{Name: "section", Type: "text", Required: true},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "exams",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "title", Type: "text", Required: true},
				{Name: "year", Type: "text", Required: true},
				{Name: "semester", Type: "text", Required: true},
				{Name: "section", Type: "text", Required: true},
				{Name: "subject", Type: "text", Required: true},
				{Name: "faculty_id", Type: "text"},
				{Name: "faculty_assignment_id", Type: "text"},
				{Name: "status", Type: "text"},
				{Name: "published_at", Type: "text"},
				{Name: "archived_at", Type: "text"},
				{Name: "created_at", Type: "text", Required: true},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "student_batches",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "year", Type: "text", Required: true},
				{Name: "semester", Type: "text", Required: true},
				{Name: "section", Type: "text", Required: true},
				{Name: "uploaded_at", Type: "text", Required: true},
				{Name: "source_file", Type: "text"},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "students",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "roll_no", Type: "text", Required: true, Unique: true},
				{Name: "name", Type: "text", Required: true},
				{Name: "email", Type: "text"},
				{Name: "batch_id", Type: "text", Required: true},
				{Name: "created_at", Type: "text", Required: true},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "question_papers",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "exam_id", Type: "text"},
				{Name: "title", Type: "text", Required: true},
				{Name: "file", Type: "file", MaxSelect: 1, MaxSize: 52428800, MimeTypes: []string{"application/pdf"}},
				{Name: "uploaded_at", Type: "text", Required: true},
				// This is a derived counter. A new manual paper legitimately starts at 0,
				// which PocketBase otherwise treats as blank for a required number field.
				{Name: "question_count", Type: "number", Min: 0, Max: 1000, OnlyInt: true},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "questions",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "exam_id", Type: "text"},
				// Required for faculty-created questions; optional at the database
				// level to preserve the older /api/exams workflow during migration.
				{Name: "paper_id", Type: "text"},
				{Name: "number", Type: "number", Required: true, Min: 1, Max: 1000, OnlyInt: true},
				{Name: "text", Type: "text", Required: true},
				{Name: "marks", Type: "number", Min: 0, Max: 1000, OnlyInt: true},
				{Name: "created_at", Type: "text", Required: true},
				{Name: "attachments", Type: "file", MaxSelect: 5, MaxSize: 104857600, MimeTypes: []string{"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/csv"}},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "assignments",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "exam_id", Type: "text", Required: true},
				{Name: "paper_id", Type: "text"},
				{Name: "student_roll_no", Type: "text", Required: true},
				{Name: "question_id", Type: "text", Required: true},
				{Name: "question_text", Type: "text", Required: true},
				{Name: "assigned_at", Type: "text", Required: true},
				{Name: "response", Type: "text"},
				{Name: "submitted_at", Type: "text"},
				{Name: "attempt_id", Type: "text"},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
		{
			Name: "attempts",
			Type: "base",
			Fields: []collectionSchemaField{
				{Name: "exam_id", Type: "text", Required: true},
				{Name: "paper_id", Type: "text", Required: true},
				{Name: "student_roll_no", Type: "text", Required: true},
				{Name: "status", Type: "text", Required: true}, // assigned | started | submitted
				{Name: "assigned_at", Type: "text", Required: true},
				{Name: "started_at", Type: "text"},
				{Name: "submitted_at", Type: "text"},
			},
			ListRule:   &textRule,
			ViewRule:   &textRule,
			CreateRule: &textRule,
			UpdateRule: &textRule,
			DeleteRule: &textRule,
		},
	}

	// Browser clients must use the Go API; PocketBase records are not exposed
	// directly. The backend uses its superuser connection after checking the
	// faculty session and record ownership.
	for i := range collections {
		collections[i].ListRule = nil
		collections[i].ViewRule = nil
		collections[i].CreateRule = nil
		collections[i].UpdateRule = nil
		collections[i].DeleteRule = nil
	}

	for _, collection := range collections {
		if err := c.upsertCollection(collection); err != nil {
			return err
		}
	}
	return nil
}

func (c *bootstrapConfig) upsertCollection(payload collectionPayload) error {
	status, body, err := c.doRaw(http.MethodGet, "/api/collections/"+url.PathEscape(payload.Name), nil)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return c.doJSON(http.MethodPost, "/api/collections", payload, nil)
	}
	if status >= 300 {
		return fmt.Errorf("GET /api/collections/%s failed: %s", payload.Name, strings.TrimSpace(string(body)))
	}
	var existing struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &existing); err != nil {
		return err
	}
	return c.doJSON(http.MethodPatch, "/api/collections/"+existing.ID, payload, nil)
}

func (c *bootstrapConfig) doJSON(method, path string, payload interface{}, out interface{}) error {
	status, body, err := c.doRaw(method, path, payload)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("%s %s failed: %s", method, path, strings.TrimSpace(string(body)))
	}
	if out != nil {
		return json.Unmarshal(body, out)
	}
	return nil
}

func (c *bootstrapConfig) doRaw(method, path string, payload interface{}) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		buf, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, bodyBytes, nil
}
