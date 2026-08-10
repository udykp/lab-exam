package config

import (
	"os"
	"time"
)

type Config struct {
	ListenAddr   string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
	TokenSecret  string
}

func FromEnv() Config {
	return Config{
		ListenAddr:   envString("LISTEN_ADDR", ":8080"),
		ReadTimeout:  envDuration("READ_TIMEOUT", 10*time.Second),
		WriteTimeout: envDuration("WRITE_TIMEOUT", 15*time.Second),
		IdleTimeout:  envDuration("IDLE_TIMEOUT", 60*time.Second),
		TokenSecret:  envString("TOKEN_SECRET", "dev-only-change-me"),
	}
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return fallback
}
