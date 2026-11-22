-- CreateEnum
CREATE TYPE "PlaceSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "PlacePrecision" AS ENUM ('PLACE', 'REGION', 'COUNTRY');

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" "PlaceSource" NOT NULL,
    "unresolvable" BOOLEAN NOT NULL DEFAULT false,
    "precision" "PlacePrecision",
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "label" TEXT,
    "countryCode" TEXT,
    "gazetteerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Place_key_key" ON "Place"("key");

-- CreateIndex
CREATE INDEX "Place_source_idx" ON "Place"("source");

