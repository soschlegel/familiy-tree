import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireScope } from "@/lib/session";
import { getPlacePage } from "@/lib/services/place-pages";
import { PlaceMiniMap } from "@/components/PlaceMiniMap";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = { AUTO: "automatisch aus dem Ortsverzeichnis", AI: "vom KI-Assistenten (noch nicht bestätigt)", MANUAL: "von Hand bestätigt" } as const;
const PRECISION_LABEL: Record<string, string> = { PLACE: "Ort", REGION: "nur Region", COUNTRY: "nur Land" };

const load = cache(async (ref: string, page: number) => {
  const { scope } = await requireScope();
  return { scope, place: await getPlacePage(scope, decodeURIComponent(ref), { page }) };
});

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { place } = await load(ref, 1);
  return { title: place ? place.name : "Nicht gefunden" };
}

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4).replace(".", ",")}° ${v < 0 ? neg : pos}`;
const years = (a: number | null, b: number | null) => (a || b ? `${a ?? "?"} – ${b ?? ""}`.trim() : "");

/**
 * Ortsseite (README, „Karte und Orte“): ein zugeordneter Ort mit Lage,
 * Herkunft der Zuordnung, weiteren Namen, den Freitexten, die auf ihn zeigen,
 * und den Angaben sichtbarer Personen. Für alle Angemeldeten; gesperrte
 * Personen erscheinen weder als Eintrag noch in einer Zahl.
 */
export default async function PlacePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { ref } = await params;
  const sp = await searchParams;
  const { scope, place } = await load(ref, Number(sp.page) || 1);
  if (!place) notFound();
  const pages = Math.max(1, Math.ceil(place.total / place.pageSize));
  const href = (p: number) => `/places/${place.ref}${p > 1 ? `?page=${p}` : ""}`;

  return (
    <div className="space-y-6">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/map" className="btn-link text-sm">
          ← Karte
        </Link>
        {scope.isAdmin && (
          <>
            {" · "}
            <Link href={`/admin/places?q=${encodeURIComponent(place.texts[0]?.text ?? place.name)}`} className="btn-link text-sm">
              Zuordnung bearbeiten
            </Link>
          </>
        )}
      </nav>

      <header className="card space-y-1 p-5 sm:p-6">
        <p className="eyebrow">{place.kind}</p>
        <h1 className="page-title" data-testid="place-title">
          {place.label}
        </h1>
        {place.historicName && (
          <p className="text-sm muted" data-testid="place-historic">
            Früherer bzw. deutscher Name: {place.historicName}
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 p-4 text-sm" aria-labelledby="place-facts">
          <h2 id="place-facts" className="font-semibold">
            Lage und Zuordnung
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="muted">Heutiger Name</dt>
            <dd>{place.name}</dd>
            {place.region && (
              <>
                <dt className="muted">Region</dt>
                <dd>{place.region}</dd>
              </>
            )}
            {place.country && (
              <>
                <dt className="muted">Land</dt>
                <dd>{place.country}</dd>
              </>
            )}
            <dt className="muted">Koordinaten</dt>
            <dd data-testid="place-coords">
              {coord(place.latitude, "N", "S")}, {coord(place.longitude, "O", "W")}
              {place.precision && place.precision !== "PLACE" && <> ({PRECISION_LABEL[place.precision]})</>}
            </dd>
            {place.population ? (
              <>
                <dt className="muted">Einwohner</dt>
                <dd>{place.population.toLocaleString("de-DE")}</dd>
              </>
            ) : null}
            <dt className="muted">Zuordnung</dt>
            <dd data-testid="place-sources">{place.sources.map((s) => SOURCE_LABEL[s]).join("; ")}</dd>
          </dl>
          {place.notes && place.notes.length > 0 && (
            <p className="text-xs" data-testid="place-notes">
              <span className="muted">Begründung bzw. Notiz (nur für Administratoren): </span>
              {place.notes.join(" · ")}
            </p>
          )}
          <p>
            <Link href="/map?mode=alle" className="btn-link">
              Auf der Karte „Wurzeln nach Jahr“ ansehen
            </Link>
          </p>
        </section>
        <PlaceMiniMap latitude={place.latitude} longitude={place.longitude} label={place.name} />
      </div>

      <section className="card space-y-2 p-4 text-sm" aria-labelledby="place-names">
        <h2 id="place-names" className="font-semibold">
          Schreibweisen
        </h2>
        <p>
          <span className="muted">In den Daten: </span>
          <span data-testid="place-texts">
            {place.texts.length
              ? place.texts.map((t, i) => (
                  <span key={t.text}>
                    {i > 0 && " · "}„{t.text}“{t.count > 0 && <span className="muted"> ({t.count}×)</span>}
                  </span>
                ))
              : "—"}
          </span>
        </p>
        {place.otherNames.length > 0 && (
          <p>
            <span className="muted">Weitere Namen im Ortsverzeichnis: </span>
            <span data-testid="place-other-names">{place.otherNames.join(", ")}</span>
          </p>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="place-persons">
        <h2 id="place-persons" className="text-lg font-semibold">
          Personen mit Angaben an diesem Ort <span className="muted text-sm font-normal">({place.total})</span>
        </h2>
        {place.entries.length === 0 ? (
          <p className="card p-4 text-sm muted">Keine Angaben, die du sehen darfst.</p>
        ) : (
          <ul className="card divide-y divide-stone-200 text-sm dark:divide-stone-800" data-testid="place-entries">
            {place.entries.map((e, i) => (
              <li key={`${e.person.id}-${e.kind}-${e.label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2">
                <span>
                  <Link href={`/people/${e.person.id}`} className="btn-link">
                    {e.person.name}
                  </Link>
                  {years(e.person.birthYear, e.person.deathYear) && (
                    <span className="muted"> ({years(e.person.birthYear, e.person.deathYear)})</span>
                  )}
                </span>
                <span className="muted">
                  {e.label}
                  {e.alternative && " (abweichende Angabe)"}
                  {e.year && ` ${e.year}`}
                  {e.text && ` · „${e.text}“`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Seiten" className="flex items-center justify-center gap-3 text-sm">
            {place.page > 1 && (
              <Link href={href(place.page - 1)} className="btn-secondary">
                Zurück
              </Link>
            )}
            <span className="muted">
              Seite {place.page} von {pages}
            </span>
            {place.page < pages && (
              <Link href={href(place.page + 1)} className="btn-secondary">
                Weiter
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
