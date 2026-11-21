-- Bezugsperson „das bin ich“ (README, „Bezugsperson“): jeder Benutzer kann
-- sich eine Person zuordnen. Rein ergänzend; wird die Person gelöscht, bleibt
-- der Benutzer ohne Zuordnung (ON DELETE SET NULL).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "personId" TEXT;

-- CreateIndex
CREATE INDEX "User_personId_idx" ON "User"("personId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
