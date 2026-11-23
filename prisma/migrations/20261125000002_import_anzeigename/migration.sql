-- Anzeigename je Import (Quell-Baum, sourceTreeId) — rein ergänzend.
-- Eine Zeile entsteht erst, wenn ein Administrator einen Import benennt.
-- CreateTable
CREATE TABLE "ImportSource" (
    "sourceTreeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSource_pkey" PRIMARY KEY ("sourceTreeId")
);
