-- Neuigkeiten: zuletzt gesehenes Release je Benutzer (rein ergänzend).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenReleaseId" TEXT;
