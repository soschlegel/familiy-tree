-- Zeitgeschichte („historischer Rahmen“) — rein ergänzend.
-- HistoryEvent: eigene Ereignisse der Administratoren (/admin/history);
-- HistoryHiddenBuiltin: ausgeblendete Einträge der mitgelieferten Liste
-- (lib/history/builtin.ts). Ohne Zeilen gilt die mitgelieferte Liste.
-- CreateTable
CREATE TABLE "HistoryEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryHiddenBuiltin" (
    "builtinId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryHiddenBuiltin_pkey" PRIMARY KEY ("builtinId")
);

-- CreateIndex
CREATE INDEX "HistoryEvent_yearFrom_idx" ON "HistoryEvent"("yearFrom");
