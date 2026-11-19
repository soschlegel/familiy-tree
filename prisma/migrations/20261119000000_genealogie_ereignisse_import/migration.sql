-- CreateEnum
CREATE TYPE "PersonNameType" AS ENUM ('BIRTH', 'MARRIED', 'ALIAS', 'RELIGIOUS', 'IMMIGRANT', 'VARIANT', 'OTHER');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BIRTH', 'DEATH', 'BAPTISM', 'CHRISTENING', 'ADULT_CHRISTENING', 'BURIAL', 'CREMATION', 'ADOPTION', 'CONFIRMATION', 'FIRST_COMMUNION', 'BAR_MITZVAH', 'BAS_MITZVAH', 'BLESSING', 'ORDINATION', 'GRADUATION', 'EDUCATION', 'OCCUPATION', 'RETIREMENT', 'RESIDENCE', 'CENSUS', 'EMIGRATION', 'IMMIGRATION', 'NATURALIZATION', 'MILITARY_SERVICE', 'RELIGION', 'NATIONALITY', 'TITLE', 'PROPERTY', 'PHYSICAL_DESCRIPTION', 'ID_NUMBER', 'CASTE', 'CHILDREN_COUNT', 'MARRIAGE_COUNT', 'WILL', 'PROBATE', 'MARRIAGE', 'DIVORCE', 'ENGAGEMENT', 'MARRIAGE_BANNS', 'MARRIAGE_CONTRACT', 'MARRIAGE_LICENSE', 'MARRIAGE_SETTLEMENT', 'DIVORCE_FILED', 'ANNULMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DateQualifier" ADD VALUE 'ESTIMATED';
ALTER TYPE "DateQualifier" ADD VALUE 'CALCULATED';
ALTER TYPE "DateQualifier" ADD VALUE 'BETWEEN';
ALTER TYPE "DateQualifier" ADD VALUE 'PERIOD';
ALTER TYPE "DateQualifier" ADD VALUE 'UNTIL';

-- AlterEnum
ALTER TYPE "RelationSubtype" ADD VALUE 'PARTNER_UNKNOWN';

-- AlterEnum
ALTER TYPE "CitationFact" ADD VALUE 'EVENT';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "birthDatePhrase" TEXT,
ADD COLUMN     "birthDateTo" TIMESTAMP(3),
ADD COLUMN     "birthDateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "deathCause" TEXT,
ADD COLUMN     "deathDatePhrase" TEXT,
ADD COLUMN     "deathDateTo" TIMESTAMP(3),
ADD COLUMN     "deathDateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "namePrefix" TEXT,
ADD COLUMN     "nameSuffix" TEXT,
ADD COLUMN     "nickname" TEXT;

-- AlterTable
ALTER TABLE "Relationship" ADD COLUMN     "endDatePhrase" TEXT,
ADD COLUMN     "endDateTo" TIMESTAMP(3),
ADD COLUMN     "endDateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "endPlace" TEXT,
ADD COLUMN     "startDatePhrase" TEXT,
ADD COLUMN     "startDateTo" TIMESTAMP(3),
ADD COLUMN     "startDateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "startPlace" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "datePhrase" TEXT,
ADD COLUMN     "dateTo" TIMESTAMP(3),
ADD COLUMN     "dateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "kindLabel" TEXT;

-- AlterTable
ALTER TABLE "Citation" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "text" TEXT;

-- CreateTable
CREATE TABLE "PersonName" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "PersonNameType" NOT NULL DEFAULT 'OTHER',
    "givenName" TEXT,
    "familyName" TEXT,
    "prefix" TEXT,
    "suffix" TEXT,
    "nickname" TEXT,
    "label" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "relationshipId" TEXT,
    "type" "EventType" NOT NULL,
    "label" TEXT,
    "isAlternative" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3),
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
    "dateQualifier" "DateQualifier" NOT NULL DEFAULT 'EXACT',
    "dateTo" TIMESTAMP(3),
    "dateToPrecision" "DatePrecision" NOT NULL DEFAULT 'DAY',
    "datePhrase" TEXT,
    "place" TEXT,
    "address" TEXT,
    "value" TEXT,
    "cause" TEXT,
    "age" TEXT,
    "agency" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "sourceTreeId" TEXT,
    "sourceSystem" TEXT,
    "sourceSystemName" TEXT,
    "sourceVersion" TEXT,
    "gedcomVersion" TEXT,
    "charset" TEXT,
    "header" JSONB,
    "counts" JSONB,
    "warnings" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLink" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "personId" TEXT,
    "relationshipId" TEXT,
    "eventId" TEXT,
    "personNameId" TEXT,
    "citationId" TEXT,
    "sourceId" TEXT,
    "mediaId" TEXT,
    "sourceTreeId" TEXT,
    "externalKey" TEXT,
    "firstBatchId" TEXT,
    "lastBatchId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importHash" TEXT NOT NULL,
    "sourceStamp" TEXT,
    "missingSinceBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalId" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "batchId" TEXT,
    "personId" TEXT,
    "relationshipId" TEXT,
    "eventId" TEXT,
    "sourceId" TEXT,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRawRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "personId" TEXT,
    "relationshipId" TEXT,
    "sourceId" TEXT,
    "recordType" TEXT NOT NULL,
    "xref" TEXT,
    "content" JSONB NOT NULL,
    "reason" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRawRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonName_personId_idx" ON "PersonName"("personId");

-- CreateIndex
CREATE INDEX "Event_personId_idx" ON "Event"("personId");

-- CreateIndex
CREATE INDEX "Event_relationshipId_idx" ON "Event"("relationshipId");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_storageKey_key" ON "ImportBatch"("storageKey");

-- CreateIndex
CREATE INDEX "ImportBatch_fileSha256_idx" ON "ImportBatch"("fileSha256");

-- CreateIndex
CREATE INDEX "ImportBatch_sourceTreeId_createdAt_idx" ON "ImportBatch"("sourceTreeId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_personId_key" ON "ImportLink"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_relationshipId_key" ON "ImportLink"("relationshipId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_eventId_key" ON "ImportLink"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_personNameId_key" ON "ImportLink"("personNameId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_citationId_key" ON "ImportLink"("citationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_sourceId_key" ON "ImportLink"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportLink_mediaId_key" ON "ImportLink"("mediaId");

-- CreateIndex
CREATE INDEX "ImportLink_sourceTreeId_externalKey_idx" ON "ImportLink"("sourceTreeId", "externalKey");

-- CreateIndex
CREATE INDEX "ImportLink_firstBatchId_idx" ON "ImportLink"("firstBatchId");

-- CreateIndex
CREATE INDEX "ImportLink_lastBatchId_idx" ON "ImportLink"("lastBatchId");

-- CreateIndex
CREATE INDEX "ExternalId_system_value_idx" ON "ExternalId"("system", "value");

-- CreateIndex
CREATE INDEX "ExternalId_batchId_idx" ON "ExternalId"("batchId");

-- CreateIndex
CREATE INDEX "ExternalId_personId_idx" ON "ExternalId"("personId");

-- CreateIndex
CREATE INDEX "ExternalId_relationshipId_idx" ON "ExternalId"("relationshipId");

-- CreateIndex
CREATE INDEX "ExternalId_eventId_idx" ON "ExternalId"("eventId");

-- CreateIndex
CREATE INDEX "ExternalId_sourceId_idx" ON "ExternalId"("sourceId");

-- CreateIndex
CREATE INDEX "ExternalId_mediaId_idx" ON "ExternalId"("mediaId");

-- CreateIndex
CREATE INDEX "ImportRawRecord_batchId_idx" ON "ImportRawRecord"("batchId");

-- CreateIndex
CREATE INDEX "ImportRawRecord_personId_idx" ON "ImportRawRecord"("personId");

-- CreateIndex
CREATE INDEX "ImportRawRecord_relationshipId_idx" ON "ImportRawRecord"("relationshipId");

-- CreateIndex
CREATE INDEX "ImportRawRecord_sourceId_idx" ON "ImportRawRecord"("sourceId");

-- CreateIndex
CREATE INDEX "Citation_eventId_idx" ON "Citation"("eventId");

-- AddForeignKey
ALTER TABLE "PersonName" ADD CONSTRAINT "PersonName_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_firstBatchId_fkey" FOREIGN KEY ("firstBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_lastBatchId_fkey" FOREIGN KEY ("lastBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_personNameId_fkey" FOREIGN KEY ("personNameId") REFERENCES "PersonName"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLink" ADD CONSTRAINT "ImportLink_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalId" ADD CONSTRAINT "ExternalId_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRawRecord" ADD CONSTRAINT "ImportRawRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRawRecord" ADD CONSTRAINT "ImportRawRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRawRecord" ADD CONSTRAINT "ImportRawRecord_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRawRecord" ADD CONSTRAINT "ImportRawRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

