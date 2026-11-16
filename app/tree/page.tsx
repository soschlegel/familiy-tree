import Link from "next/link";

import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { listFamilies, loadTree } from "@/lib/services";
import { FamilyTree } from "@/components/FamilyTree";

export const dynamic = "force-dynamic";
export const metadata = { title: "Baum" };

export default async function TreePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; focus?: string }>;
}) {
  const { scope } = await requireScope();
  const { denied, focus } = await searchParams;
  const [data, familyList] = await Promise.all([loadTree(scope), listFamilies(scope)]);
  const canCreate = scope.isAdmin || editableFamilyIds(scope).length > 0;

  // Nur Familien zur Auswahl anbieten, die der Benutzer auch sehen darf.
  const families = familyList.map(({ id, name }) => ({ id, name }));
  const visibleCount = data.persons.filter((p) => !p.restricted).length;
  const hiddenCount = data.persons.length - visibleCount;
  const noAccess = !scope.isAdmin && scope.families.size === 0;

  return (
    <div className="space-y-3">
      {denied && (
        <p role="alert" className="alert-warning mx-auto max-w-6xl">
          Für die aufgerufene Seite fehlt dir die Berechtigung. Du wurdest zum
          Stammbaum weitergeleitet.
        </p>
      )}

      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-2 sm:px-0">
        <div>
          <h1 className="page-title">Stammbaum</h1>
          <p className="text-sm muted" data-testid="tree-counts">
            {visibleCount} Personen
            {hiddenCount > 0 && ` (${hiddenCount} weitere nicht freigegeben)`}
            {" · "}
            {data.relationships.length} Beziehungen
          </p>
        </div>
        {canCreate && (
          <Link href="/people/new" className="btn-primary">
            Person anlegen
          </Link>
        )}
      </div>

      {noAccess || visibleCount === 0 ? (
        <div className="card mx-auto max-w-6xl space-y-2 p-8 text-center">
          <h2 className="font-medium">
            {noAccess ? "Noch keine Familie freigegeben" : "Noch keine Personen erfasst"}
          </h2>
          <p className="text-sm muted">
            {noAccess
              ? "Dein Zugang ist eingerichtet, aber dir ist noch keine Familie zugeordnet. Sobald ein Administrator dich einer Familie zuordnet, erscheint hier ihr Stammbaum."
              : canCreate
                ? "Lege die erste Person an — Beziehungen kommen danach auf der Personenseite dazu."
                : "Sobald jemand Personen erfasst, erscheinen sie hier."}
          </p>
        </div>
      ) : (
        <FamilyTree data={data} families={families} focusId={focus} />
      )}
    </div>
  );
}
