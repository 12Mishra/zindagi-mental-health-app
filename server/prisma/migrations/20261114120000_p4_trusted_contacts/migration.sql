-- CreateEnum
CREATE TYPE "ContactRelationship" AS ENUM ('FRIEND', 'ROOMMATE', 'SIBLING', 'FAMILY', 'PARTNER', 'MENTOR', 'COUNSELLOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "PromptSource" AS ENUM ('VOICE', 'CHECKIN');

-- CreateEnum
CREATE TYPE "PromptStatus" AS ENUM ('SHOWN', 'MESSAGED', 'CALLED', 'DECLINED', 'SNOOZED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "TrustedContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nameCipher" TEXT NOT NULL,
    "phoneCipher" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "relationship" "ContactRelationship" NOT NULL,
    "channel" "ContactChannel" NOT NULL DEFAULT 'WHATSAPP',
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportPrompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "PromptSource" NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "status" "PromptStatus" NOT NULL DEFAULT 'SHOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "SupportPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactLabel" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "providerId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ContactNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedContact_userId_priority_key" ON "TrustedContact"("userId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedContact_userId_phoneHash_key" ON "TrustedContact"("userId", "phoneHash");

-- CreateIndex
CREATE INDEX "SupportPrompt_userId_createdAt_idx" ON "SupportPrompt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactNotification_status_nextAttemptAt_idx" ON "ContactNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ContactNotification_userId_createdAt_idx" ON "ContactNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportPrompt" ADD CONSTRAINT "SupportPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactNotification" ADD CONSTRAINT "ContactNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactNotification" ADD CONSTRAINT "ContactNotification_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SupportPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

