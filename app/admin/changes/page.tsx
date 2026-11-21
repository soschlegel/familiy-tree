import Link from "next/link";

import { requirePage, requireScope } from "@/lib/session";
import { changeFilterFrom, changeFilterOptions, listChangeSets } from "@/lib/services";
import { ChangeSetList } from "@/components/ChangeSetList";
import { formatChangeTime } from "@/lib/change-time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Änderungen" };

type Search = Record<string, string | string[] | undefined>;

const DEFAULT_DAYS = 30;

/**
 * Änderungsübersicht für Administratoren: eine Zeile je Paket (Anfrage in
 * der App, Import, Zusammenführen, Paket über den KI-Zugang), gefiltert nach
 * Familie, Zeitraum, Benutzer und Kanal; aufklappbar bis zum einzelnen Feld.
 */
export default async function ChangesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePage("audit:read");
  const { scope } = await requireScope();
  const params = await searchParams;
  const filter = changeFilterFrom(params);
  // Ohne Angabe die letzten 30 Tage (die Übersicht gruppiert alle Einträge des
  // Zeitraums); ein bewusst geleertes „Von“ zeigt alles.
  const defaultFrom = params.from === undefined;
  if (defaultFrom) filter.from = new Date(Date.now() - DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const pageRaw = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number(pageRaw) || 1);

  const [options, result] = await Promise.all([changeFilterOptions(scope), listChangeSets(scope, filter, { page })]);

  // Filter als Suchparameter — für Seitenwechsel und das Nachladen der Einträge.
  const query = new URLSearchParams();
  if (filter.familyId) query.set("family", filter.familyId);
  if (filter.userId) query.set("user", filter.userId);
  if (filter.channel) query.set("channel", filter.channel);
  if (filter.from) query.set("from", filter.from);
  else query.set("from", "");
  if (filter.to) query.set("to", filter.to);
  const pageHref = (p: number) => {
    const q = new URLSearchParams(query);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/admin/changes?${s}` : "/admin/changes";
  };
  const filtered = Boolean(filter.familyId || filter.userId || filter.channel || filter.to || (filter.from && !defaultFrom));

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Verwaltung</p>
        <h1 className="page-title">Änderungen</h1>
        <p className="mt-1 text-sm muted">
          Wer hat wann was geändert — je Paket zusammengefasst: eine Aktion in der App, ein Import, ein
          Zusammenführen oder ein Paket über den KI-Zugang.
          {defaultFrom && ` Ohne Angabe: die letzten ${DEFAULT_DAYS} Tage.`}
        </p>
      </div>

      <form method="get" action="/admin/changes" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Änderungen filtern">
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="filter-family" className="field-label">
            Familie
          </label>
          <select id="filter-family" name="family" defaultValue={filter.familyId ?? ""} className="field w-full">
            <option value="">alle</option>
            {options.families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="filter-user" className="field-label">
            Benutzer
          </label>
          <select id="filter-user" name="user" defaultValue={filter.userId ?? ""} className="field w-full">
            <option value="">alle</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="filter-channel" className="field-label">
            Kanal
          </label>
          <select id="filter-channel" name="channel" defaultValue={filter.channel ?? ""} className="field w-full">
            <option value="">alle</option>
            <option value="APP">App</option>
            <option value="MCP">KI über MCP</option>
          </select>
        </div>
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="filter-from" className="field-label">
            Von
          </label>
          <input id="filter-from" type="date" name="from" defaultValue={filter.from ?? ""} className="field w-full" />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <label htmlFor="filter-to" className="field-label">
            Bis
          </label>
          <input id="filter-to" type="date" name="to" defaultValue={filter.to ?? ""} className="field w-full" />
        </div>
        <div className="flex flex-wrap items-end gap-2 lg:col-span-2">
          <button type="submit" className="btn-primary">
            Filtern
          </button>
          {filtered && (
            <Link href="/admin/changes" className="btn-secondary">
              Zurücksetzen
            </Link>
          )}
        </div>
      </form>

      {result.items.length === 0 ? (
        <p className="alert-info">
          {filtered || defaultFrom ? "Keine Änderungen für diese Auswahl." : "Noch keine Änderungen erfasst."}
          {defaultFrom && ` Angezeigt werden die letzten ${DEFAULT_DAYS} Tage — für ältere Änderungen „Von“ leeren oder ändern.`}
        </p>
      ) : (
        <ChangeSetList
          sets={result.items.map((s) => ({ ...s, lastText: formatChangeTime(s.last) }))}
          filterQuery={query.toString()}
        />
      )}

      {(page > 1 || result.hasMore) && (
        <nav aria-label="Seiten" className="flex flex-wrap items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-secondary" rel="prev">
              ← Neuere
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm muted">Seite {page}</span>
          {result.hasMore ? (
            <Link href={pageHref(page + 1)} className="btn-secondary" rel="next">
              Ältere →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
