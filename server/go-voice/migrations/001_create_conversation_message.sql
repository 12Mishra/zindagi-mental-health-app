-- Migration: Create Conversation and Message tables
-- Run against the same PostgreSQL database as the Express server

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
