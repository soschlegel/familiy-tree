import { notFound } from "next/navigation";

import { requireScope } from "@/lib/session";
import { ConnectImports } from "@/components/ConnectImports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importe verbinden" };

/**
 * Importe verbinden: Personen, die in mehreren Importen vorkommen, finden und
 * zusammenführen — aus mehreren Importen wird ein gemeinsamer Stammbaum. Nur
 * für Administratoren (sie sehen alle Personen und alle Importe).
 */
export default async function ConnectPage() {
  const { scope } = await requireScope();
  if (!scope.isAdmin) notFound();
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Recherche</p>
        <h1 className="page-title">Importe verbinden</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Wer in mehreren Importen vorkommt, verbindet sie: Diese Verbindungspersonen werden gefunden und nach deiner Bestätigung
          zusammengeführt — so wird aus den Importen ein gemeinsamer Stammbaum. Sichere Paare sind vorausgewählt; alles andere wählst du
          selbst. Vor dem Zusammenführen zeigt eine gemeinsame Vorschau, was geschieht.
        </p>
      </div>
      <ConnectImports />
    </div>
  );
}
