import Link from "next/link";

import { requireScope } from "@/lib/session";
import { canCreateSources, listSources, type SourceKind } from "@/lib/services";
import { SOURCE_KINDS } from "@/lib/validation";
import { SOURCE_KIND_LABEL } from "@/lib/source-labels";
import { formatDateOf } from "@/lib/tree-layout";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quellen" };

const PAGE_SIZE = 40;

type Params = { q?: string; kind?: string; page?: string; deleted?: string };

/**
 * Übersicht der Quellen, die der Benutzer sehen darf (siehe
 * lib/services/sources.ts): Suche nach Titel, Verfasser, Archiv, Signatur.
 */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const needle = params.q?.trim() || undefined;
  const kind = (SOURCE_KINDS as readonly string[]).includes(params.kind ?? "")
    ? (params.kind as SourceKind)
    : undefined;
  const requestedPage = Math.max(1, Math.floor(Number(params.page) || 1));

  const { items, total } = await listSources(scope, {
    q: needle,
    kind,
    limit: PAGE_SIZE,
    offset: (requestedPage - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  const filtered = Boolean(needle || kind);
  const hrefFor = (p: number) => {
    const sp = new URLSearchParams();
    if (needle) sp.set("q", needle);
    if (kind) sp.set("kind", kind);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/sources?${s}` : "/sources";
  };

  return (
    <div className="space-y-5">
      {params.deleted && (
        <p role="status" className="alert-success">
          „{params.deleted}“ wurde gelöscht.
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Archiv</p>
          <h1 className="page-title">Quellen</h1>
          <p className="text-sm muted" data-testid="sources-count">
            {total === 0
              ? filtered
                ? "Keine Treffer"
                : "Noch keine Quellen"
              : `${total} ${total === 1 ? "Quelle" : "Quellen"}${filtered ? " gefunden" : ""}`}
          </p>
        </div>
        {canCreateSources(scope) && (
          <Link href="/sources/new" className="btn-primary">
            Quelle anlegen
          </Link>
        )}
      </div>

      <form role="search" aria-label="Quellen filtern" className="card flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="sources-q" className="field-label">
            Suche
          </label>
          <input
            id="sources-q"
            name="q"
            type="search"
            defaultValue={needle}
            placeholder="Titel, Verfasser, Archiv oder Signatur…"
            className="field w-full"
          />
        </div>
        <div>
          <label htmlFor="sources-kind" className="field-label">
            Art
          </label>
          <AutoSubmitSelect id="sources-kind" name="kind" defaultValue={kind ?? ""} className="field">
            <option value="">Alle Arten</option>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_KIND_LABEL[k]}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>
        <button className="btn-secondary">Suchen</button>
        {filtered && (
          <Link href="/sources" className="btn-link self-center">
            Filter zurücksetzen
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="font-serif text-lg">Keine Quelle gefunden.</p>
          <p className="mt-1 text-sm muted">
            {filtered
              ? "Andere Suchbegriffe versuchen oder den Filter zurücksetzen."
              : "Quellen entstehen hier oder direkt auf einer Personenseite unter „Quellen“."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Quellenliste" data-testid="sources-list">
          {items.map((s) => {
            const where = [s.repository, s.callNumber].filter(Boolean).join(" · ");
            const date = formatDateOf(s, "date");
            return (
              <li key={s.id}>
                <Link
                  href={`/sources/${s.id}`}
                  className="card group flex h-full flex-col gap-1 p-3 transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-lift dark:hover:border-accent-700"
                >
                  <span className="font-semibold leading-snug group-hover:text-accent-800 dark:group-hover:text-accent-200">
                    {s.title}
                  </span>
                  {(where || s.author || date) && (
                    <span className="line-clamp-2 text-sm muted">
                      {[s.author, where, date].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="badge px-2 py-0 text-[11px]">{SOURCE_KIND_LABEL[s.kind]}</span>
                    {s.provider && <span className="badge-alt px-2 py-0 text-[11px]">{s.provider}</span>}
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">
                      {s.citationCount === 0
                        ? "noch kein Beleg"
                        : s.citationCount === 1
                          ? "1 Beleg"
                          : `${s.citationCount} Belege`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Seiten" className="flex flex-wrap items-center justify-center gap-1">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={hrefFor(n)}
              aria-current={n === page ? "page" : undefined}
              aria-label={`Seite ${n}`}
              className={n === page ? "btn-primary min-w-9" : "btn-secondary min-w-9"}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
