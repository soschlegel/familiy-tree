import { requirePage } from "@/lib/session";
import { can } from "@/lib/authz";
import { DataTransfer } from "@/components/DataTransfer";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const session = await requirePage();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Daten sichern und einspielen</h1>
        <p className="text-sm text-stone-500">
          Austauschformat für Umzüge und Sicherungen.
        </p>
      </div>

      <DataTransfer canImport={can(session.user.role, "data:import")} />
    </div>
  );
}
