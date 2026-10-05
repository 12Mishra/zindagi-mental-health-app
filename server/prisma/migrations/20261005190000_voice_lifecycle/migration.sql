-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "SummaryJobState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('UNKNOWN', 'LOW', 'ELEVATED', 'URGENT');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('ALLOW', 'BLOCK', 'REVISE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Kosha" AS ENUM ('ANNAMAYA', 'PRANAMAYA', 'MANOMAYA', 'VIJNANAMAYA', 'ANANDAMAYA');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "nextTurnNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retentionUntil" TIMESTAMP(3),
ADD COLUMN     "transcriptConsent" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the next available number when the migration is applied to an existing
-- feature-branch database. A fresh isolated database has no messages to backfill.
UPDATE "Conversation" c SET "nextTurnNumber" = COALESCE(
  (SELECT MAX(m."turnNumber") + 1 FROM "Message" m WHERE m."conversationId" = c."id"),
  1
);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientTurnId" TEXT,
ADD COLUMN     "deliveredContent" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'DELIVERED';

-- AlterTable
ALTER TABLE "ConversationSummary" ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "structured" JSONB;

-- CreateTable
CREATE TABLE "SummaryJob" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "state" "SummaryJobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SummaryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "evidence" TEXT,
    "action" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponseReview" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResponseReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kosha" "Kosha" NOT NULL,
    "observation" TEXT NOT NULL,
    "evidenceTurnId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SummaryJob_conversationId_key" ON "SummaryJob"("conversationId");

-- CreateIndex
CREATE INDEX "SummaryJob_state_nextAttemptAt_idx" ON "SummaryJob"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SummaryJob_leaseUntil_idx" ON "SummaryJob"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceTicket_tokenHash_key" ON "VoiceTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "VoiceTicket_expiresAt_idx" ON "VoiceTicket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_conversationId_turnId_policyVersion_key" ON "RiskEvent"("conversationId", "turnId", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseReview_conversationId_generationId_segmentIndex_key" ON "ResponseReview"("conversationId", "generationId", "segmentIndex");

-- CreateIndex
CREATE INDEX "ProfileObservation_userId_kosha_createdAt_idx" ON "ProfileObservation"("userId", "kosha", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_retentionUntil_idx" ON "Conversation"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_turnNumber_key" ON "Message"("conversationId", "turnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_clientTurnId_role_key" ON "Message"("conversationId", "clientTurnId", "role");

-- AddForeignKey
ALTER TABLE "SummaryJob" ADD CONSTRAINT "SummaryJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceTicket" ADD CONSTRAINT "VoiceTicket_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceTicket" ADD CONSTRAINT "VoiceTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseReview" ADD CONSTRAINT "ResponseReview_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileObservation" ADD CONSTRAINT "ProfileObservation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
