import { requireScope } from "@/lib/session";
import { can } from "@/lib/authz";
import { listFamilies } from "@/lib/services";
import { DataTransfer } from "@/components/DataTransfer";
import { GedcomImport } from "@/components/GedcomImport";
import { ImportHistory } from "@/components/ImportHistory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daten" };

export default async function DataPage() {
  const { session, scope } = await requireScope();
  const canImport = can(session.user.role, "data:import");
  const families = canImport ? (await listFamilies(scope)).map((f) => ({ id: f.id, name: f.name })) : [];

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Daten</p>
        <h1 className="page-title">Sichern und einspielen</h1>
        <p className="mt-1 text-sm muted">
          Austauschformat für Umzüge und Sicherungen, GEDCOM für den Austausch mit anderen Stammbaumprogrammen.
        </p>
      </div>

      <DataTransfer canImport={canImport} />
      {canImport && <GedcomImport families={families} />}
      {canImport && <ImportHistory />}
    </div>
  );
}
