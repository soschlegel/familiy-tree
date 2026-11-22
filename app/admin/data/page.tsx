import Link from "next/link";

import { requireScope } from "@/lib/session";
import { can } from "@/lib/authz";
import { listFamilies } from "@/lib/services";
import { exportFamilyOverview } from "@/lib/services/export-selection";
import { DataTransfer } from "@/components/DataTransfer";
import { GedcomImport } from "@/components/GedcomImport";
import { ImportHistory } from "@/components/ImportHistory";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daten" };

export default async function DataPage() {
  const { session, scope } = await requireScope();
  const canImport = can(session.user.role, "data:import");
  const [families, gedcomOverview] = await Promise.all([
    canImport ? listFamilies(scope).then((list) => list.map((f) => ({ id: f.id, name: f.name }))) : Promise.resolve([]),
    // Familien und Personenzahlen für den Auswahldialog des GEDCOM-Exports.
    exportFamilyOverview(scope),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Daten</p>
        <h1 className="page-title">Sichern und einspielen</h1>
        <p className="mt-1 text-sm muted">
          Austauschformat für Umzüge und Sicherungen, GEDCOM für den Austausch mit anderen Stammbaumprogrammen.
        </p>
      </div>

      <DataTransfer canImport={canImport} gedcomOverview={gedcomOverview} />
      {canImport && <GedcomImport families={families} />}
      {canImport && <ImportHistory />}
      {can(session.user.role, "place:manage") && (
        <p className="card p-4 text-sm" data-testid="data-places-link">
          Ortsangaben für die Karte:{" "}
          <Link href="/admin/places" className="btn-link">
            Orte zuordnen
          </Link>{" "}
          <HelpLink to="orteZuordnen" compact label="Wie funktioniert das Zuordnen der Orte?" className="ml-1 align-middle" />
        </p>
      )}
    </div>
  );
}
