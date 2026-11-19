-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "DateQualifier" AS ENUM ('EXACT', 'ABOUT', 'BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('CHURCH_BOOK', 'CIVIL_REGISTRY', 'CENSUS', 'GRAVESTONE', 'FAMILY_DOCUMENT', 'ORAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "CitationFact" AS ENUM ('NAME', 'BIRTH', 'DEATH', 'PARTNERSHIP', 'PARENTAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "CitationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "birthDatePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "birthDateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT',
ADD COLUMN     "deathDatePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "deathDateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "Relationship" ADD COLUMN     "endDatePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "endDateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT',
ADD COLUMN     "startDatePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "startDateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT';

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL DEFAULT 'OTHER',
    "author" TEXT,
    "repository" TEXT,
    "callNumber" TEXT,
    "url" TEXT,
    "date" TIMESTAMP(3),
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
    "dateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT',
    "notes" TEXT,
    "mediaId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "personId" TEXT,
    "relationshipId" TEXT,
    "fact" "CitationFact" NOT NULL DEFAULT 'OTHER',
    "detail" TEXT,
    "confidence" "CitationConfidence",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_title_idx" ON "Source"("title");

-- CreateIndex
CREATE INDEX "Citation_sourceId_idx" ON "Citation"("sourceId");

-- CreateIndex
CREATE INDEX "Citation_personId_idx" ON "Citation"("personId");

-- CreateIndex
CREATE INDEX "Citation_relationshipId_idx" ON "Citation"("relationshipId");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

