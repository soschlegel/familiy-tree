-- Einstellungen der Installation (/admin/settings) — rein ergänzend.
-- Eine Zeile entsteht erst, wenn ein Administrator einen Wert in der App
-- setzt; ohne Zeile gilt weiter die Umgebungsvariable.
-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
