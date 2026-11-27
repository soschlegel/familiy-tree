-- Zeitgeschichte: Herkunft und Bestätigung eigener Ereignisse — rein ergänzend.
-- origin: MANUAL (von Hand, Standard für alle vorhandenen Zeilen), AI (von
-- der KI über MCP angelegt), AI_EDITED (von Hand angelegt, von der KI
-- geändert). aiReason/aiSourceUrl: Begründung bzw. Quelle der KI.
-- confirmedAt/confirmedById: Bestätigung durch einen Administrator (leer =
-- unbestätigt; nur bei AI/AI_EDITED von Bedeutung).
-- CreateEnum
CREATE TYPE "HistoryOrigin" AS ENUM ('MANUAL', 'AI', 'AI_EDITED');

-- AlterTable
ALTER TABLE "HistoryEvent" ADD COLUMN     "aiReason" TEXT,
ADD COLUMN     "aiSourceUrl" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "origin" "HistoryOrigin" NOT NULL DEFAULT 'MANUAL';

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
