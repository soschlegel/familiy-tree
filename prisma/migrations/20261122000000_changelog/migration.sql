-- Changelog (README, „Änderungsgeschichte“): Tabelle ChangeSet für Pakete
-- zusammengehöriger Änderungen; im AuditLog Verweis auf das Paket und eine
-- Momentaufnahme der betroffenen Personen und Familien (mit GIN-Index).
-- Rein ergänzend; ältere Einträge bleiben unverändert (ohne Paket, leere Listen).

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "changeSetId" TEXT,
ADD COLUMN     "familyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "personIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ChangeSet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'APP',
    "userId" TEXT,
    "channel" "AuditChannel",
    "apiTokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeSet_createdAt_idx" ON "ChangeSet"("createdAt");

-- CreateIndex
CREATE INDEX "ChangeSet_userId_kind_lastActivityAt_idx" ON "ChangeSet"("userId", "kind", "lastActivityAt");

-- CreateIndex
CREATE INDEX "AuditLog_changeSetId_idx" ON "AuditLog"("changeSetId");

-- CreateIndex
CREATE INDEX "AuditLog_personIds_idx" ON "AuditLog" USING GIN ("personIds");

-- CreateIndex
CREATE INDEX "AuditLog_familyIds_idx" ON "AuditLog" USING GIN ("familyIds");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

