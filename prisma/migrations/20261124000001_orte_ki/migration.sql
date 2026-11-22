-- Ortszuordnung durch den KI-Assistenten (rein ergänzend).
-- AlterEnum
ALTER TYPE "PlaceSource" ADD VALUE 'AI';

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "note" TEXT,
ADD COLUMN     "uncertain" BOOLEAN NOT NULL DEFAULT false;
