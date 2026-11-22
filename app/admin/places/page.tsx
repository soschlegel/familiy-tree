import Link from "next/link";

import { requirePage, requireScope } from "@/lib/session";
import { listPlaces, PLACE_STATUS_LABEL, type PlaceStatus } from "@/lib/services/places";
import { PlaceAutoAssign, PlaceTable } from "@/components/PlaceAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orte zuordnen" };

type Search = { status?: string; q?: string; page?: string };
const FILTERS: (PlaceStatus | "all")[] = ["all", "open", "auto", "manual", "unresolvable"];

/**
 * Orte zuordnen (nur Administratoren, README „Karte und Orte“): alle
 * vorkommenden Ortstexte mit Häufigkeit, Zuordnung und Vorschlag aus dem
 * mitgelieferten Ortsverzeichnis.
 */
export default async function PlacesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePage("place:manage");
  const { scope } = await requireScope();
  const params = await searchParams;
  const status = FILTERS.includes(params.status as PlaceStatus) ? (params.status as PlaceStatus | "all") : "all";
  const q = params.q?.trim() ?? "";
  const list = await listPlaces(scope, { status, q, page: Number(params.page) || 1 });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (over: Partial<Search>) => {
    const s = new URLSearchParams();
    const st = over.status ?? status;
    if (st !== "all") s.set("status", st);
    const qq = over.q ?? q;
    if (qq) s.set("q", qq);
    if (over.page && over.page !== "1") s.set("page", over.page);
    const str = s.toString();
    return str ? `/admin/places?${str}` : "/admin/places";
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Verwaltung</p>
        <h1 className="page-title">Orte zuordnen</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Für die <Link href="/map" className="btn-link">Karte</Link> braucht jeder Ortstext Koordinaten. Vorschläge kommen
          aus dem mitgelieferten Ortsverzeichnis (GeoNames, CC BY 4.0) — ohne Dienst im Netz, die Ortsnamen verlassen den
          Server nicht. Von Hand Bestätigtes überschreibt die automatische Zuordnung nie.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm" data-testid="places-summary">
        <span>
          <strong>{list.counts.all}</strong> Ortstexte, <strong>{list.counts.occurrences}</strong> Angaben:
        </span>
        <nav aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const n = f === "all" ? list.counts.all : list.counts[f];
            return (
              <Link
                key={f}
                href={href({ status: f, page: "1" })}
                className="badge"
                aria-current={status === f ? "true" : undefined}
                data-testid={`places-filter-${f}`}
                style={status === f ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--accent-600))" } : undefined}
              >
                {f === "all" ? "alle" : PLACE_STATUS_LABEL[f]} {n}
              </Link>
            );
          })}
        </nav>
        <div className="sm:ml-auto">
          <PlaceAutoAssign open={list.counts.open} />
        </div>
      </div>

      <form method="get" action="/admin/places" className="flex flex-wrap items-end gap-2" role="search">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="places-q" className="field-label">
            Ortstext suchen
          </label>
          <input id="places-q" name="q" defaultValue={q} className="field w-full" placeholder="z.B. Kiel" />
        </div>
        <button className="btn-secondary">Suchen</button>
        {q && (
          <Link href={href({ q: "", page: "1" })} className="btn-link">
            Suche aufheben
          </Link>
        )}
      </form>

      <PlaceTable rows={list.rows} />

      {pages > 1 && (
        <nav aria-label="Seiten" className="flex items-center justify-center gap-3 text-sm">
          {list.page > 1 && (
            <Link href={href({ page: String(list.page - 1) })} className="btn-secondary">
              Zurück
            </Link>
          )}
          <span className="muted">
            Seite {list.page} von {pages}
          </span>
          {list.page < pages && (
            <Link href={href({ page: String(list.page + 1) })} className="btn-secondary">
              Weiter
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
