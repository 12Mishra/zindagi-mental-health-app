package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL    string
	Port           string
	DeepgramAPIKey string
	GeminiAPIKey   string
}

func Load() *Config {
	_ = godotenv.Load()

	return &Config{
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		Port:           getEnv("PORT", "4001"),
		DeepgramAPIKey: getEnv("DEEPGRAM_API_KEY", ""),
		GeminiAPIKey:   getEnv("GEMINI_API_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
