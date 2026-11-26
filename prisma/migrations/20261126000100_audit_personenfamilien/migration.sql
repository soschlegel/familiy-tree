-- Änderungsgeschichte: Familien der betroffenen Person im Eintrag selbst
-- (lib/audit.ts, auditRefs). Damit lässt sich das Leserecht auch prüfen, wenn
-- es die Person nicht mehr gibt (gelöscht oder aufgegangen).
-- Rein ergänzend, ohne Rückfüllung: ältere Einträge bleiben „nicht erfasst“
-- (subjectFamiliesKnown = false) und für Nicht-Admins ohne Feldwerte.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "subjectFamiliesKnown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subjectFamilyIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
