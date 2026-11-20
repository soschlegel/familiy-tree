-- Quellen aus dem Import sauber übernehmen (README, „Quellen und Belege“):
-- neue Quellenarten für Online-Stammbäume und Online-Sammlungen, Anbieter
-- einer Quelle, Internetadresse eines Belegs. Rein ergänzend.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceKind" ADD VALUE 'ONLINE_TREE';
ALTER TYPE "SourceKind" ADD VALUE 'ONLINE_COLLECTION';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "provider" TEXT;

-- AlterTable
ALTER TABLE "Citation" ADD COLUMN     "url" TEXT;

