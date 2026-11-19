import { requirePage } from "@/lib/session";
import { can } from "@/lib/authz";
import { DataTransfer } from "@/components/DataTransfer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daten" };

export default async function DataPage() {
  const session = await requirePage();

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Daten</p>
        <h1 className="page-title">Sichern und einspielen</h1>
        <p className="mt-1 text-sm muted">
          Austauschformat für Umzüge und Sicherungen.
        </p>
      </div>

      <DataTransfer canImport={can(session.user.role, "data:import")} />
    </div>
  );
}
