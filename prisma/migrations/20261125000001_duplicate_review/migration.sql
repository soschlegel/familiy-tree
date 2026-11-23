-- KI-Vorprüfung möglicher Dubletten (rein ergänzend): Einschätzung des
-- KI-Assistenten je Paar (MCP review_duplicate). Sie führt nichts zusammen
-- und blendet nichts aus. Kanonisch gespeichert (personAId < personBId);
-- apiTokenId bewusst ohne Fremdschlüssel (wie im AuditLog).
-- CreateEnum
CREATE TYPE "DuplicateVerdict" AS ENUM ('MERGE', 'DISPUTED', 'NOT_DUPLICATE');

-- CreateTable
CREATE TABLE "DuplicateReview" (
    "personAId" TEXT NOT NULL,
    "personBId" TEXT NOT NULL,
    "verdict" "DuplicateVerdict" NOT NULL,
    "reason" TEXT NOT NULL,
    "suggestedKeepId" TEXT,
    "userId" TEXT,
    "apiTokenId" TEXT,
    "stateA" TEXT NOT NULL,
    "stateB" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateReview_pkey" PRIMARY KEY ("personAId","personBId")
);

-- CreateIndex
CREATE INDEX "DuplicateReview_personBId_idx" ON "DuplicateReview"("personBId");

-- AddForeignKey
ALTER TABLE "DuplicateReview" ADD CONSTRAINT "DuplicateReview_personAId_fkey" FOREIGN KEY ("personAId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReview" ADD CONSTRAINT "DuplicateReview_personBId_fkey" FOREIGN KEY ("personBId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReview" ADD CONSTRAINT "DuplicateReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

