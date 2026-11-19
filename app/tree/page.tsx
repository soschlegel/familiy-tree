import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { listFamilies, loadFocusTree, loadTree, type TreeCounts } from "@/lib/services";
import { FOCUS_COOKIE, FOCUS_DEPTH, parseDepth, type TreeView } from "@/lib/focus-tree";
import { FamilyTree } from "@/components/FamilyTree";
import { BrandMark } from "@/components/NavBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Baum" };

/**
 * Ansicht aus der URL:
 * - `view=generations|timeline` — ganzer Baum (`focus` zentriert nur darauf)
 * - sonst Fokus-Ansicht: `focus` (sonst die zuletzt fokussierte Person aus
 *   dem Cookie, sonst eine Startperson), Tiefe über `up` und `down`.
 */
function parseView(view: string | undefined): TreeView {
  return view === "generations" || view === "timeline" ? view : "focus";
}

const ID_PATTERN = /^[\w-]{1,64}$/;

export default async function TreePage({
  searchParams,
}: {
  searchParams: Promise<{
    denied?: string;
    focus?: string;
    view?: string;
    up?: string;
    down?: string;
  }>;
}) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const view = parseView(params.view);
  const noAccess = !scope.isAdmin && scope.families.size === 0;
  const canCreate = scope.isAdmin || editableFamilyIds(scope).length > 0;
  const requested = params.focus && ID_PATTERN.test(params.focus) ? params.focus : null;

  let counts: TreeCounts = { visible: 0, hidden: 0, relationships: 0 };
  let content: ReactNode = null;

  // Ohne freigegebene Familie gäbe es nur Platzhalter — dann gar nicht erst
  // laden (und auch keine Zahlen über fremde Familien nennen).
  const familyList = noAccess ? [] : await listFamilies(scope);
  // Nur Familien zur Auswahl anbieten, die der Benutzer auch sehen darf.
  const families = familyList.map(({ id, name }) => ({ id, name }));

  if (!noAccess && view === "focus") {
    const remembered = (await cookies()).get(FOCUS_COOKIE)?.value;
    const result = await loadFocusTree(scope, {
      focusId: requested ?? (remembered && ID_PATTERN.test(remembered) ? remembered : null),
      // Eine gemerkte Person darf verschwunden sein; eine angefragte nicht.
      fallback: !requested,
      up: parseDepth(params.up, FOCUS_DEPTH.up),
      down: parseDepth(params.down, FOCUS_DEPTH.down),
    });
    counts = result.counts;
    if (result.notFound) {
      content = (
        <div className="card mx-auto max-w-2xl space-y-4 px-6 py-10 text-center" role="alert" data-testid="tree-focus-missing">
          <h2 className="section-title">Person nicht gefunden</h2>
          <p className="text-sm muted">
            Diese Person gibt es nicht, oder sie gehört zu einer Familie, für die du keine
            Freigabe hast. Deshalb lässt sie sich nicht in den Mittelpunkt stellen.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/tree?view=focus" className="btn-primary">
              Fokus-Ansicht öffnen
            </Link>
            <Link href="/tree?view=generations" className="btn-secondary">
              Ganzen Baum zeigen
            </Link>
          </div>
        </div>
      );
    } else if (result.tree) {
      content = <FamilyTree key="focus" view="focus" data={result.tree} families={families} />;
    }
  } else if (!noAccess) {
    const data = await loadTree(scope);
    const visible = data.persons.filter((p) => !p.restricted).length;
    counts = {
      visible,
      hidden: data.persons.length - visible,
      relationships: data.relationships.length,
    };
    if (visible > 0) {
      content = (
        <FamilyTree
          key="full"
          view={view}
          data={data}
          families={families}
          focusId={requested ?? undefined}
        />
      );
    }
  }

  // Die Seite füllt genau den Bildschirm unter der Kopfzeile (55px) samt
  // Innenabstand von <main> (2 × 12px) und über der Fußzeile mit der
  // Build-Angabe (--footer-h); die Baumfläche nimmt den Rest ein, wie viele
  // Zeilen die Werkzeugleiste auch braucht (auf dem Telefon mehrere).
  return (
    <div className="flex h-[calc(100dvh-79px-var(--footer-h))] flex-col gap-3">
      {params.denied && (
        <p role="alert" className="alert-warning">
          Für die aufgerufene Seite fehlt dir die Berechtigung. Du wurdest zum
          Stammbaum weitergeleitet.
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Stammbaum</h1>
          {!noAccess && (
            <p className="text-sm muted" data-testid="tree-counts">
              {counts.visible} Personen
              {counts.hidden > 0 && ` (${counts.hidden} weitere nicht freigegeben)`}
              {" · "}
              {counts.relationships} Beziehungen
            </p>
          )}
        </div>
        {canCreate && (
          <Link href="/people/new" className="btn-primary">
            Person anlegen
          </Link>
        )}
      </div>

      {content ?? (
        <div className="card mx-auto max-w-2xl space-y-3 px-6 py-12 text-center" data-testid="tree-empty">
          <BrandMark className="mx-auto h-12 w-12" />
          <h2 className="section-title">
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
      )}
    </div>
  );
}
