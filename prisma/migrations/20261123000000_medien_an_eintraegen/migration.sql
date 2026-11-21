-- Bilder an Quellen (mehrere), Ereignissen und Belegen (README, „Bilder an
-- Quellen, Ereignissen und Belegen“). Rein ergänzend: drei neue
-- Verknüpfungstabellen nach dem Muster von PersonMedia, beim Löschen des
-- Eintrags bzw. des Bildes verschwindet nur die Verknüpfung (CASCADE).
--
-- "Source"."mediaId" bleibt unverändert der Hauptscan einer Quelle. Bestehende
-- Scans werden bewusst NICHT hierher kopiert: die App liest beide Stellen
-- (lib/services/attached-media.ts) — so braucht die Migration keine
-- Datenänderung, die an vorhandenen Daten scheitern könnte, und eine ältere
-- App-Version sieht ihre Scans unverändert.

-- CreateTable
CREATE TABLE "SourceMedia" (
    "sourceId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceMedia_pkey" PRIMARY KEY ("sourceId","mediaId")
);

-- CreateTable
CREATE TABLE "EventMedia" (
    "eventId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMedia_pkey" PRIMARY KEY ("eventId","mediaId")
);

-- CreateTable
CREATE TABLE "CitationMedia" (
    "citationId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationMedia_pkey" PRIMARY KEY ("citationId","mediaId")
);

-- CreateIndex
CREATE INDEX "SourceMedia_mediaId_idx" ON "SourceMedia"("mediaId");

-- CreateIndex
CREATE INDEX "EventMedia_mediaId_idx" ON "EventMedia"("mediaId");

-- CreateIndex
CREATE INDEX "CitationMedia_mediaId_idx" ON "CitationMedia"("mediaId");

-- AddForeignKey
ALTER TABLE "SourceMedia" ADD CONSTRAINT "SourceMedia_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMedia" ADD CONSTRAINT "SourceMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMedia" ADD CONSTRAINT "EventMedia_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMedia" ADD CONSTRAINT "EventMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationMedia" ADD CONSTRAINT "CitationMedia_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationMedia" ADD CONSTRAINT "CitationMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
