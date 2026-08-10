package main

import (
	"log"
	"net/http"
	"os"

	"securemlexam/internal/app"
	"securemlexam/internal/config"
	"securemlexam/internal/realtime"
	"securemlexam/internal/store"
	"securemlexam/internal/store/memory"
	"securemlexam/internal/store/sqlite"
)

func main() {
	logger := log.New(os.Stdout, "securemlexam: ", log.LstdFlags|log.Lmicroseconds)
	cfg := config.FromEnv()

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "exam.db"
	}

	var dataStore store.Store
	sqliteStore, err := sqlite.NewStore(dbPath)
	if err != nil {
		logger.Printf("warning: sqlite store initialization failed (%v), falling back to memory store", err)
		memStore := memory.NewStore()
		memStore.SeedDemoData()
		dataStore = memStore
	} else {
		logger.Printf("using SQLite database store at: %s", dbPath)
		sqliteStore.SeedDemoData()
		dataStore = sqliteStore
		defer sqliteStore.Close()
	}

	hub := realtime.NewHub()
	service := app.NewService(dataStore, hub, cfg, logger)

	server := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      service.Routes(),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	logger.Printf("starting server on %s", cfg.ListenAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatalf("server failed: %v", err)
	}
}
