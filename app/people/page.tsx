import Link from "next/link";

import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { listFamilies, searchPersons, type PersonSort } from "@/lib/services";
import { lifeSpan } from "@/lib/tree-layout";
import { Avatar } from "@/components/Avatar";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personen" };

const PAGE_SIZE = 40;

const SORTS: { value: PersonSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "birthDate", label: "Geburt, älteste zuerst" },
  { value: "birthDateDesc", label: "Geburt, jüngste zuerst" },
  { value: "updatedAt", label: "Zuletzt geändert" },
];

type Params = { q?: string; sort?: string; family?: string; page?: string; deleted?: string };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const needle = params.q?.trim() || undefined;
  const sort = SORTS.some((s) => s.value === params.sort)
    ? (params.sort as PersonSort)
    : "name";
  const families = (await listFamilies(scope)).map(({ id, name }) => ({ id, name }));
  const familyId = families.some((f) => f.id === params.family) ? params.family : undefined;
  const requestedPage = Math.max(1, Math.floor(Number(params.page) || 1));
  const canCreate = scope.isAdmin || editableFamilyIds(scope).length > 0;

  let { items: persons, total } = await searchPersons(scope, {
    q: needle,
    familyId,
    sort,
    limit: PAGE_SIZE,
    offset: (requestedPage - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  // Seitenzahl jenseits des Endes (z.B. nach dem Löschen): letzte Seite zeigen.
  if (page !== requestedPage) {
    ({ items: persons, total } = await searchPersons(scope, {
      q: needle,
      familyId,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }));
  }

  const familyName = new Map(families.map((f) => [f.id, f.name]));
  const hrefFor = (p: number) => {
    const sp = new URLSearchParams();
    if (needle) sp.set("q", needle);
    if (sort !== "name") sp.set("sort", sort);
    if (familyId) sp.set("family", familyId);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/people?${s}` : "/people";
  };
  const filtered = Boolean(needle || familyId);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

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
          <h1 className="page-title">Personen</h1>
          <p className="text-sm muted" data-testid="people-count">
            {total === 0
              ? "Keine Treffer"
              : `${from}–${to} von ${total} ${filtered ? "Treffern" : "Personen"}`}
          </p>
        </div>
        {canCreate && (
          <Link href="/people/new" className="btn-primary">
            Person anlegen
          </Link>
        )}
      </div>

      <form
        role="search"
        aria-label="Personen filtern"
        className="card flex flex-wrap items-end gap-3 p-3"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="people-q" className="field-label">
            Name
          </label>
          <input
            id="people-q"
            name="q"
            type="search"
            defaultValue={needle}
            placeholder="Vor-, Nach- oder Geburtsname…"
            className="field w-full"
          />
        </div>
        {families.length > 1 && (
          <div>
            <label htmlFor="people-family" className="field-label">
              Familie
            </label>
            <AutoSubmitSelect
              id="people-family"
              name="family"
              defaultValue={familyId ?? ""}
              className="field"
            >
              <option value="">Alle Familien</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </div>
        )}
        <div>
          <label htmlFor="people-sort" className="field-label">
            Sortierung
          </label>
          <AutoSubmitSelect
            id="people-sort"
            name="sort"
            defaultValue={sort}
            className="field"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </div>
        <button className="btn-secondary">Suchen</button>
        {filtered && (
          <Link href="/people" className="btn-link self-center">
            Filter zurücksetzen
          </Link>
        )}
      </form>

      {persons.length === 0 ? (
        <div className="card px-6 py-10 text-center">
          <p className="font-serif text-lg">Keine Person gefunden.</p>
          <p className="mt-1 text-sm muted">
            {filtered
              ? "Andere Schreibweise versuchen oder den Filter zurücksetzen."
              : "Noch keine Personen erfasst."}
          </p>
        </div>
      ) : (
        <ul
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Personenliste"
          data-testid="people-list"
        >
          {persons.map((p) => (
            <li key={p.id}>
              <Link
                href={`/people/${p.id}`}
                className="card group flex h-full items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-lift dark:hover:border-accent-700"
              >
                <Avatar person={p} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold group-hover:text-accent-800 dark:group-hover:text-accent-200">
                    {[p.givenName, p.familyName].filter(Boolean).join(" ")}
                  </span>
                  <span className="block truncate text-sm muted">
                    {lifeSpan(p) || "Lebensdaten unbekannt"}
                    {p.birthName && ` · geb. ${p.birthName}`}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {p.familyIds.slice(0, 2).map((f) => (
                      <span key={f} className="badge px-2 py-0 text-[11px]">
                        {(familyName.get(f) ?? "").replace(/^Familie /, "")}
                      </span>
                    ))}
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">
                      {p.relationCount === 1 ? "1 Beziehung" : `${p.relationCount} Beziehungen`}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Seiten" className="flex flex-wrap items-center justify-center gap-1">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className="btn-secondary" rel="prev">
              ← Zurück
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40" aria-hidden>
              ← Zurück
            </span>
          )}
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={hrefFor(n)}
              aria-current={n === page ? "page" : undefined}
              aria-label={`Seite ${n}`}
              className={
                n === page
                  ? "btn-primary min-w-9"
                  : "btn-secondary min-w-9"
              }
            >
              {n}
            </Link>
          ))}
          {page < pages ? (
            <Link href={hrefFor(page + 1)} className="btn-secondary" rel="next">
              Weiter →
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40" aria-hidden>
              Weiter →
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
