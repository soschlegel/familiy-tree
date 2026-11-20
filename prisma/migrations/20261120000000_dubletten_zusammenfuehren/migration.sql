-- Dubletten zusammenführen (README, „Dubletten zusammenführen“).
--
-- 1. ImportLink: mehrere Herkunftsangaben je Datensatz. Bisher erlaubte je
--    ein Unique-Index auf den sieben Träger-Spalten genau einen Link je
--    Person, Beziehung, Ereignis …; nach dem Zusammenführen zweier
--    importierter Personen braucht die verbleibende die Links BEIDER
--    Quell-Bäume (bzw. beider Datensätze desselben Baums), damit ein
--    erneuter Import jedes Baums sie wiedererkennt. Die Unique-Indizes werden
--    durch gewöhnliche Indizes ersetzt. Bestehende Zeilen erfüllen die
--    gelockerte Regel trivialerweise (aus „höchstens eine“ wird „beliebig
--    viele“) — es wird keine Zeile verändert oder gelöscht.
-- 2. ImportLink.mergedFromId/mergedAt: woher ein Link beim Zusammenführen kam.
-- 3. DuplicateDismissal: als „kein Duplikat“ markierte Paare.

-- DropIndex
DROP INDEX "ImportLink_personId_key";

-- DropIndex
DROP INDEX "ImportLink_relationshipId_key";

-- DropIndex
DROP INDEX "ImportLink_eventId_key";

-- DropIndex
DROP INDEX "ImportLink_personNameId_key";

-- DropIndex
DROP INDEX "ImportLink_citationId_key";

-- DropIndex
DROP INDEX "ImportLink_sourceId_key";

-- DropIndex
DROP INDEX "ImportLink_mediaId_key";

-- AlterTable
ALTER TABLE "ImportLink" ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedFromId" TEXT;

-- CreateTable
CREATE TABLE "DuplicateDismissal" (
    "personAId" TEXT NOT NULL,
    "personBId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("personAId","personBId")
);

-- CreateIndex
CREATE INDEX "DuplicateDismissal_personBId_idx" ON "DuplicateDismissal"("personBId");

-- CreateIndex
CREATE INDEX "ImportLink_personId_idx" ON "ImportLink"("personId");

-- CreateIndex
CREATE INDEX "ImportLink_relationshipId_idx" ON "ImportLink"("relationshipId");

-- CreateIndex
CREATE INDEX "ImportLink_eventId_idx" ON "ImportLink"("eventId");

-- CreateIndex
CREATE INDEX "ImportLink_personNameId_idx" ON "ImportLink"("personNameId");

-- CreateIndex
CREATE INDEX "ImportLink_citationId_idx" ON "ImportLink"("citationId");

-- CreateIndex
CREATE INDEX "ImportLink_sourceId_idx" ON "ImportLink"("sourceId");

-- CreateIndex
CREATE INDEX "ImportLink_mediaId_idx" ON "ImportLink"("mediaId");

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_personAId_fkey" FOREIGN KEY ("personAId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_personBId_fkey" FOREIGN KEY ("personBId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
