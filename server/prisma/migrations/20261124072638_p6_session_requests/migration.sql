-- CreateEnum
CREATE TYPE "SessionRequestStatus" AS ENUM ('PENDING', 'PROPOSED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "SessionRequest" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rollNumber" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'IN_PERSON',
    "preferredTherapistId" TEXT,
    "windows" TIMESTAMP(3)[],
    "status" "SessionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "handledById" TEXT,
    "proposedStartsAt" TIMESTAMP(3),
    "counsellorNote" TEXT,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionRequest_appointmentId_key" ON "SessionRequest"("appointmentId");

-- CreateIndex
CREATE INDEX "SessionRequest_institutionId_status_idx" ON "SessionRequest"("institutionId", "status");

-- CreateIndex
CREATE INDEX "SessionRequest_studentId_status_idx" ON "SessionRequest"("studentId", "status");

-- AddForeignKey
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_preferredTherapistId_fkey" FOREIGN KEY ("preferredTherapistId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
