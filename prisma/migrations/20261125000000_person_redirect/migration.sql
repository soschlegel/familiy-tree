-- Alte Kennung als Umleitung (rein ergänzend): Nach einem Zusammenführen
-- zeigt die Kennung der aufgegangenen Person auf die bleibende.
-- Bewusst nur die Tabelle: Die Rückfüllung aus dem AuditLog geschieht
-- idempotent im Code (lib/services/redirects.ts, backfillPersonRedirects),
-- damit diese Migration an keinen Daten scheitern kann.
-- CreateTable
CREATE TABLE "PersonRedirect" (
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonRedirect_pkey" PRIMARY KEY ("fromId")
);

-- CreateIndex
CREATE INDEX "PersonRedirect_toId_idx" ON "PersonRedirect"("toId");

-- AddForeignKey
ALTER TABLE "PersonRedirect" ADD CONSTRAINT "PersonRedirect_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
