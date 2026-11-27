-- Zeitgeschichte: Geltungsbereich eigener Ereignisse — rein ergänzend.
-- areas: Schlüssel von Ländern („DE“) bzw. Regionen erster Ebene („DE.13“)
-- wie lib/places/area.ts; leer = überall (Standard, auch für alle
-- vorhandenen Zeilen).
-- AlterTable
ALTER TABLE "HistoryEvent" ADD COLUMN     "areas" TEXT[] DEFAULT ARRAY[]::TEXT[];
