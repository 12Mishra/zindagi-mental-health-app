-- CreateEnum
CREATE TYPE "Topic" AS ENUM ('ACADEMIC', 'ANXIETY', 'RELATIONSHIPS', 'FINANCIAL', 'FAMILY', 'SLEEP', 'CAREER', 'HEALTH', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'THERAPIST');

-- CreateEnum
CREATE TYPE "CheckinSource" AS ENUM ('APP', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('RISK', 'DISENGAGEMENT', 'COHORT_DIP');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'ACK', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'BOOKED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_STUDENT', 'CANCELLED_THERAPIST');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('BRIEF', 'IDENTITY', 'CONTACT');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "topics" "Topic"[] DEFAULT ARRAY[]::"Topic"[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "checkinOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "pseudonym" TEXT,
ADD COLUMN     "yearOfStudy" INTEGER;

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kAnonymity" INTEGER NOT NULL DEFAULT 10,
    "pseudonymSalt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodCheckin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "source" "CheckinSource" NOT NULL DEFAULT 'APP',
    "severity" "RiskLevel",
    "classifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortDailyStat" (
    "institutionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "cohortKey" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "n" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CohortDailyStat_pkey" PRIMARY KEY ("institutionId","day","cohortKey","metric")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "dedupeKey" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "subjectPseudonym" TEXT,
    "cohortKey" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT NOT NULL,
    "assigneeId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistProfile" (
    "staffUserId" TEXT NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialties" "Topic"[] DEFAULT ARRAY[]::"Topic"[],
    "bio" TEXT,

    CONSTRAINT "TherapistProfile_pkey" PRIMARY KEY ("staffUserId")
);

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'IN_PERSON',
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "sessionCode" TEXT NOT NULL,
    "reason" "Topic",
    "alertId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentGrant" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareBrief" (
    "appointmentId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "generator" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareBrief_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "TherapistNote" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapistNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_slug_key" ON "Institution"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "StaffUser_institutionId_role_idx" ON "StaffUser"("institutionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffSession_staffUserId_idx" ON "StaffSession"("staffUserId");

-- CreateIndex
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

-- CreateIndex
CREATE INDEX "MoodCheckin_userId_createdAt_idx" ON "MoodCheckin"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MoodCheckin_createdAt_idx" ON "MoodCheckin"("createdAt");

-- CreateIndex
CREATE INDEX "CohortDailyStat_institutionId_cohortKey_metric_day_idx" ON "CohortDailyStat"("institutionId", "cohortKey", "metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_institutionId_status_lastSeenAt_idx" ON "Alert"("institutionId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Outreach_userId_createdAt_idx" ON "Outreach"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AvailabilitySlot_therapistId_startsAt_idx" ON "AvailabilitySlot"("therapistId", "startsAt");

-- CreateIndex
CREATE INDEX "AvailabilitySlot_status_startsAt_idx" ON "AvailabilitySlot"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_sessionCode_key" ON "Appointment"("sessionCode");

-- CreateIndex
CREATE INDEX "Appointment_therapistId_status_idx" ON "Appointment"("therapistId", "status");

-- CreateIndex
CREATE INDEX "Appointment_studentId_status_idx" ON "Appointment"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentGrant_appointmentId_scope_key" ON "ConsentGrant"("appointmentId", "scope");

-- CreateIndex
CREATE INDEX "TherapistNote_appointmentId_createdAt_idx" ON "TherapistNote"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "User_pseudonym_key" ON "User"("pseudonym");

-- CreateIndex
CREATE INDEX "User_institutionId_idx" ON "User"("institutionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodCheckin" ADD CONSTRAINT "MoodCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortDailyStat" ADD CONSTRAINT "CohortDailyStat_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistProfile" ADD CONSTRAINT "TherapistProfile_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareBrief" ADD CONSTRAINT "CareBrief_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistNote" ADD CONSTRAINT "TherapistNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

