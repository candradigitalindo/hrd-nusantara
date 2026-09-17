/*
  Warnings:

  - You are about to alter the column `overtimeHours` on the `Attendance` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(6,2)`.
  - You are about to alter the column `basicSalary` on the `Payroll` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(15,2)`.
  - You are about to alter the column `overtimePay` on the `Payroll` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(15,2)`.
  - You are about to alter the column `netSalary` on the `Payroll` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(15,2)`.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "Attendance" ALTER COLUMN "overtimeHours" SET DATA TYPE DECIMAL(6,2);

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "password" TEXT,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'EMPLOYEE';

-- AlterTable
ALTER TABLE "Payroll" ALTER COLUMN "basicSalary" SET DATA TYPE DECIMAL(15,2),
ALTER COLUMN "overtimePay" SET DATA TYPE DECIMAL(15,2),
ALTER COLUMN "netSalary" SET DATA TYPE DECIMAL(15,2);

-- CreateIndex
CREATE INDEX "Announcement_targetDepartmentId_publishDate_idx" ON "Announcement"("targetDepartmentId", "publishDate");

-- CreateIndex
CREATE INDEX "Announcement_authorId_idx" ON "Announcement"("authorId");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_checkInTime_idx" ON "Attendance"("employeeId", "checkInTime");

-- CreateIndex
CREATE INDEX "Attendance_shiftScheduleId_idx" ON "Attendance"("shiftScheduleId");

-- CreateIndex
CREATE INDEX "Candidate_appliedPositionId_status_idx" ON "Candidate"("appliedPositionId", "status");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "CertificationRecord_employeeId_idx" ON "CertificationRecord"("employeeId");

-- CreateIndex
CREATE INDEX "CertificationRecord_expiryDate_idx" ON "CertificationRecord"("expiryDate");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_timestamp_idx" ON "ChatMessage"("roomId", "timestamp");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");

-- CreateIndex
CREATE INDEX "CompetencyStandard_positionId_idx" ON "CompetencyStandard"("positionId");

-- CreateIndex
CREATE INDEX "ComplaintOrDisciplinaryAction_employeeId_status_idx" ON "ComplaintOrDisciplinaryAction"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_positionId_idx" ON "Employee"("positionId");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Interview_candidateId_idx" ON "Interview"("candidateId");

-- CreateIndex
CREATE INDEX "Interview_interviewerId_idx" ON "Interview"("interviewerId");

-- CreateIndex
CREATE INDEX "JobPosting_positionId_idx" ON "JobPosting"("positionId");

-- CreateIndex
CREATE INDEX "JobPosting_status_idx" ON "JobPosting"("status");

-- CreateIndex
CREATE INDEX "JobPosting_createdById_idx" ON "JobPosting"("createdById");

-- CreateIndex
CREATE INDEX "Leave_employeeId_status_idx" ON "Leave"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Leave_approvedById_idx" ON "Leave"("approvedById");

-- CreateIndex
CREATE INDEX "Leave_startDate_endDate_idx" ON "Leave"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Payroll_employeeId_payPeriodStart_idx" ON "Payroll"("employeeId", "payPeriodStart");

-- CreateIndex
CREATE INDEX "Payroll_status_idx" ON "Payroll"("status");

-- CreateIndex
CREATE INDEX "PerformanceReview_revieweeId_period_idx" ON "PerformanceReview"("revieweeId", "period");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerId_idx" ON "PerformanceReview"("reviewerId");

-- CreateIndex
CREATE INDEX "PerformanceReview_formTemplateId_idx" ON "PerformanceReview"("formTemplateId");

-- CreateIndex
CREATE INDEX "Position_departmentId_idx" ON "Position"("departmentId");

-- CreateIndex
CREATE INDEX "PsychometricTestResult_candidateId_idx" ON "PsychometricTestResult"("candidateId");

-- CreateIndex
CREATE INDEX "ShiftSchedule_employeeId_date_idx" ON "ShiftSchedule"("employeeId", "date");

-- CreateIndex
CREATE INDEX "ShiftSchedule_date_idx" ON "ShiftSchedule"("date");

-- CreateIndex
CREATE INDEX "Survey_status_startDate_endDate_idx" ON "Survey"("status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "SurveyResponse_surveyId_idx" ON "SurveyResponse"("surveyId");

-- CreateIndex
CREATE INDEX "SurveyResponse_respondentId_idx" ON "SurveyResponse"("respondentId");

-- CreateIndex
CREATE INDEX "TrainingRegistration_employeeId_idx" ON "TrainingRegistration"("employeeId");

-- CreateIndex
CREATE INDEX "TrainingRegistration_trainingSessionId_idx" ON "TrainingRegistration"("trainingSessionId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_timestamp_idx" ON "WhatsAppConversation"("timestamp");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_employeeId_idx" ON "WhatsAppConversation"("employeeId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_senderWhatsappNumber_idx" ON "WhatsAppConversation"("senderWhatsappNumber");
