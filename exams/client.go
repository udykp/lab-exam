//go:build !bootstrap

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type pocketBaseClient struct {
	baseURL    string
	adminEmail string
	adminPass  string
	token      string
	httpClient *http.Client
}

func newPocketBaseClient(cfg config) *pocketBaseClient {
	return &pocketBaseClient{
		baseURL:    cfg.PocketBaseURL,
		adminEmail: cfg.PocketBaseEmail,
		adminPass:  cfg.PocketBasePass,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *pocketBaseClient) healthCheck() error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
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

func (c *pocketBaseClient) authenticateIfConfigured() error {
	if c.adminEmail == "" || c.adminPass == "" {
		return nil
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

func (c *pocketBaseClient) withToken(token string) *pocketBaseClient {
	copy := *c
	copy.token = token
	return &copy
}

func (c *pocketBaseClient) ensureCollections() error {
	for _, collection := range []string{"exams", "student_batches", "students", "question_papers", "questions", "assignments"} {
		if err := c.collectionExists(collection); err != nil {
			return err
		}
	}
	return nil
}

func (c *pocketBaseClient) collectionExists(name string) error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/api/collections/"+name, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("missing PocketBase collection %q; create it in the admin UI", name)
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to inspect PocketBase collection %q: %s", name, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *pocketBaseClient) doJSON(method, path string, payload interface{}, out interface{}) error {
	var body io.Reader
	if payload != nil {
		buf, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s failed: %s", method, path, strings.TrimSpace(string(bodyBytes)))
	}
	if out != nil {
		return json.Unmarshal(bodyBytes, out)
	}
	return nil
}

func (c *pocketBaseClient) createRecord(collection string, payload interface{}, out interface{}) error {
	return c.doJSON(http.MethodPost, "/api/collections/"+collection+"/records", payload, out)
}

func (c *pocketBaseClient) updateRecord(collection, id string, payload interface{}, out interface{}) error {
	return c.doJSON(http.MethodPatch, "/api/collections/"+collection+"/records/"+id, payload, out)
}

func (c *pocketBaseClient) deleteRecord(collection, id string) error {
	return c.doJSON(http.MethodDelete, "/api/collections/"+collection+"/records/"+id, nil, nil)
}

func (c *pocketBaseClient) getRecord(collection, id string, out interface{}) error {
	return c.doJSON(http.MethodGet, "/api/collections/"+collection+"/records/"+id, nil, out)
}

func (c *pocketBaseClient) listRecords(collection, filter string, out interface{}) error {
	path := "/api/collections/" + collection + "/records?perPage=200"
	if filter != "" {
		path += "&filter=" + url.QueryEscape(filter)
	}
	return c.doJSON(http.MethodGet, path, nil, out)
}

func (c *pocketBaseClient) createRecordWithFile(collection, fileField, fileName string, fileData []byte, fields map[string]string, out interface{}) error {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return err
		}
	}
	part, err := writer.CreateFormFile(fileField, fileName)
	if err != nil {
		return err
	}
	if _, err := part.Write(fileData); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api/collections/"+collection+"/records", &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("create %s record failed: %s", collection, strings.TrimSpace(string(bodyBytes)))
	}
	if out != nil {
		return json.Unmarshal(bodyBytes, out)
	}
	return nil
}
