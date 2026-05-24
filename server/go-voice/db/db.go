package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return pool, nil
}

func Migrate(pool *pgxpool.Pool) error {
	ctx := context.Background()

	migrationSQL := `
	CREATE TABLE IF NOT EXISTS "Conversation" (
		"id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
		"userId"    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
		"moods"     TEXT[] DEFAULT '{}',
		"startedAt" TIMESTAMP DEFAULT now(),
		"endedAt"   TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS "Message" (
		"id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
		"conversationId" TEXT NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
		"role"           TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
		"content"        TEXT NOT NULL,
		"audioUrl"       TEXT,
		"createdAt"      TIMESTAMP DEFAULT now()
	);

	CREATE INDEX IF NOT EXISTS idx_conversation_user ON "Conversation"("userId");
	CREATE INDEX IF NOT EXISTS idx_message_conversation ON "Message"("conversationId", "createdAt");
	`

	_, err := pool.Exec(ctx, migrationSQL)
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}

	return nil
}
