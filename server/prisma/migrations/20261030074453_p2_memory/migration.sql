-- DropForeignKey
ALTER TABLE "ProfileObservation" DROP CONSTRAINT "ProfileObservation_conversationId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "languageHint" TEXT,
ADD COLUMN     "memoryConsent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProfileObservation" ALTER COLUMN "conversationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SummaryJob" ADD COLUMN     "payload" JSONB;

-- CreateTable
CREATE TABLE "UserMemory" (
    "userId" TEXT NOT NULL,
    "memoryCard" TEXT NOT NULL DEFAULT '',
    "openThreads" JSONB NOT NULL DEFAULT '[]',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MemorySummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "summary" TEXT NOT NULL,
    "keyThemes" TEXT[],
    "language" TEXT,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "sessionStartedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemorySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "level" "RiskLevel" NOT NULL,
    "flag" TEXT NOT NULL,
    "evidenceTurnId" TEXT,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemorySummary_conversationId_key" ON "MemorySummary"("conversationId");

-- CreateIndex
CREATE INDEX "MemorySummary_userId_sessionStartedAt_idx" ON "MemorySummary"("userId", "sessionStartedAt");

-- CreateIndex
CREATE INDEX "RiskHistory_userId_createdAt_idx" ON "RiskHistory"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfileObservation" ADD CONSTRAINT "ProfileObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileObservation" ADD CONSTRAINT "ProfileObservation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySummary" ADD CONSTRAINT "MemorySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySummary" ADD CONSTRAINT "MemorySummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskHistory" ADD CONSTRAINT "RiskHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskHistory" ADD CONSTRAINT "RiskHistory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
