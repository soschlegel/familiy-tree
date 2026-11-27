import Link from "next/link";
import { cookies } from "next/headers";

import { requireScope } from "@/lib/session";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { loadMapView, type MapMode } from "@/lib/services/map";
import { MapExplorer } from "@/components/MapExplorer";
import { MapPersonChooser } from "@/components/MapPersonChooser";
import { HelpLink } from "@/components/HelpLink";
import { LifePathMap } from "@/components/LifePathMap";
import type { Scope } from "@/lib/scope";
import { loadLifePathView, type LifePathKind } from "@/lib/services/life-path";

export const dynamic = "force-dynamic";
export const metadata = { title: "Karte" };

const ID_PATTERN = /^[\w-]{1,64}$/;

/** Betriebsart „Lebensweg“: Wert in ?art= ↔ Art des Wegs. */
const LIFE_PATH_ART: Record<string, LifePathKind> = { person: "person", vaterlinie: "father", mutterlinie: "mother" };
const ART_OF: Record<LifePathKind, string> = { person: "person", father: "vaterlinie", mother: "mutterlinie" };

/** Umschalter der Betriebsart (Vorfahren, alle, Lebensweg) — auf beiden Ansichten gleich. */
function ModeSwitch({ personParam, current }: { personParam: string; current: MapMode | "lifepath" }) {
  const items = [
    { mode: "ancestors", href: `/map?${personParam}mode=vorfahren`, label: "Vorfahren", testId: "map-mode-ancestors" },
    { mode: "all", href: `/map?${personParam}mode=alle`, label: "Alle sichtbaren Personen", testId: "map-mode-all" },
    { mode: "lifepath", href: `/map?${personParam}mode=lebensweg`, label: "Lebensweg", testId: "map-mode-lifepath" },
  ] as const;
  return (
    <div role="group" aria-label="Auswahl" className="flex flex-wrap gap-1 sm:ml-auto">
      {items.map((i) => (
        <Link
          key={i.mode}
          href={i.href}
          className="btn-secondary"
          aria-current={current === i.mode ? "true" : undefined}
          data-testid={i.testId}
          style={current === i.mode ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Karte „Wurzeln nach Jahr“ (docs/fachlich/karte-und-orte.md).
 * Adresse: /map?person=<id>&mode=vorfahren|alle|lebensweg&jahr=<JJJJ>&art=…
 * - person: Ausgangsperson; ohne Angabe die Bezugsperson (Cookie bzw. „das
 *   bin ich“). Ändert die Bezugsperson des Baums nicht.
 * - mode: Vorfahren der Ausgangsperson (Standard), alle sichtbaren Personen
 *   oder „lebensweg“ (eigene Betriebsart, siehe LifePathPage).
 * - jahr: Startjahr (sonst das Jahr mit den meisten Personen auf der Karte).
 * - art (nur Lebensweg): person (Standard), vaterlinie, mutterlinie.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; mode?: string; jahr?: string; art?: string }>;
}) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const jar = await cookies();
  const person = params.person && ID_PATTERN.test(params.person) ? params.person : null;
  if (params.mode === "lebensweg") {
    return (
      <LifePathPage
        scope={scope}
        person={person}
        cookie={jar.get(REFERENCE_COOKIE)?.value ?? null}
        kind={LIFE_PATH_ART[params.art ?? ""] ?? "person"}
      />
    );
  }
  const mode: MapMode | undefined = params.mode === "alle" ? "all" : params.mode === "vorfahren" ? "ancestors" : undefined;

  const view = await loadMapView(scope, {
    person,
    cookie: jar.get(REFERENCE_COOKIE)?.value ?? null,
    mode,
  });
  const p = view.payload;
  const requestedYear = Number(params.jahr);
  const initialYear = Number.isInteger(requestedYear) && requestedYear > 0 ? requestedYear : p.defaultYear;
  const modeParam = view.mode === "all" ? "alle" : "vorfahren";
  const personParam = person && view.person?.id === person ? `person=${encodeURIComponent(person)}&` : "";
  // Linien gibt es nur mit Ausgangsperson; auf der Karte immer an.
  const linesOn = view.person !== null;

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Karte</p>
        <h1 className="page-title">Wurzeln nach Jahr</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Wo lebten die Vorfahren in einem bestimmten Jahr? Jede Person steht am zuletzt bekannten Ort; mit dem
          Zeitstrahl oder „Abspielen“ reist du durch die Familiengeschichte — daneben steht, wer damals lebte und wie
          alt er war.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" data-testid="map-controls">
        <div className="min-w-0">
          <span className="muted">Ausgangsperson: </span>
          {view.person ? (
            <>
              <Link href={`/people/${view.person.id}`} className="font-medium text-accent-700 hover:underline dark:text-accent-300" data-testid="map-person">
                {view.person.name}
              </Link>
              {view.person.isSelf && <span className="muted"> (ich)</span>}
              {!view.person.isSelf && view.person.source !== "param" && <span className="muted"> (Bezugsperson)</span>}
            </>
          ) : (
            <span className="muted" data-testid="map-person">
              keine — „Das bin ich“ auf der eigenen Personenseite setzen oder eine Person wählen
            </span>
          )}
        </div>
        <MapPersonChooser mode={modeParam} />
        {person && (
          <Link href={`/map?mode=${modeParam}`} className="btn-link">
            zurück zur Bezugsperson
          </Link>
        )}
        <ModeSwitch personParam={personParam} current={view.mode} />
      </div>

      {view.mode === "ancestors" && !view.person ? (
        <p className="card p-4 text-sm" data-testid="map-empty">
          Für „Vorfahren“ fehlt eine Ausgangsperson. Wähle oben eine Person oder zeige{" "}
          <Link href="/map?mode=alle" className="btn-link">
            alle sichtbaren Personen
          </Link>
          .
        </p>
      ) : (
        <MapExplorer payload={p} initialYear={initialYear} grandparents={view.grandparents} showLines={linesOn} />
      )}

      {scope.isAdmin && p.unmappedTexts > 0 && (
        <p className="text-sm" data-testid="map-admin-hint">
          {p.unmappedTexts} {p.unmappedTexts === 1 ? "Ortsangabe hat" : "Ortsangaben haben"} in dieser Auswahl noch keine
          Koordinaten —{" "}
          <Link href="/admin/places" className="btn-link">
            Orte zuordnen
          </Link>{" "}
          <HelpLink to="orteZuordnen" compact label="Wie funktioniert das Zuordnen der Orte?" className="ml-1 align-middle" />
        </p>
      )}

      <details className="card p-3 text-sm" data-testid="map-rules">
        <summary className="cursor-pointer font-medium">Wie wird gezählt?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Lebend</strong> ist eine Person von ihrem Geburtsjahr bis zum Todesjahr. Fehlt die Geburt, zählt das
            früheste datierte Ereignis (Taufe, Heirat …); fehlt der Tod, das Jahr der Beerdigung, sonst höchstens 100 Jahre
            nach dem Beginn (nicht über das laufende Jahr hinaus).
          </li>
          <li>
            <strong>Ort</strong> ist der zuletzt bekannte bis zu diesem Jahr: Geburt, Ereignisse mit Ort und Datum (Wohnort,
            Volkszählung, Beruf, Auswanderung …), Heirat, Scheidung, Tod. Vor der ersten Ortsangabe gilt „ohne bekannten
            Ort“.
          </li>
          <li>
            <strong>Ungenaue Daten</strong> zählen mit ihrem Jahr: „um 1850“, „vor 1850“ und „nach 1850“ als 1850,
            „zwischen 1850 und 1854“ als 1852, ein Zeitraum mit seinem Beginn.
          </li>
          <li>
            <strong>Alter</strong> ist das Alter, das die Person in diesem Jahr erreicht: Jahr minus Geburtsjahr (fehlt die
            Geburt, das Jahr der Taufe). „Etwa“ steht davor, wenn die Geburt ungenau ist oder nur die Taufe bekannt ist; ohne
            beides „Alter unbekannt“.
          </li>
          <li>
            <strong>In diesem Jahr</strong> zählt Geburten (ersatzweise Taufen), Hochzeiten und Todesfälle (ersatzweise
            Beerdigungen) des Jahres. Eine Hochzeit erscheint nur, wenn du beide Partner sehen darfst.
          </li>
          <li>
            Orte, die nur als Region oder Land bekannt sind, stehen in deren Mitte. Gezählt werden nur Personen, die du sehen
            darfst.
          </li>
        </ul>
        <p className="mt-2">
          <HelpLink to="karte" label="Ausführlich mit Beispiel: wie die Karte zählt" />
        </p>
      </details>

      <p className="text-xs muted" data-testid="map-attribution">
        Ländergrenzen (heutige Grenzen): Natural Earth, gemeinfrei. Ortsverzeichnis: GeoNames (geonames.org), Lizenz CC BY
        4.0. Die Karte lädt nichts von fremden Servern.
        {view.ms > 0 && <span> · berechnet in {view.ms} ms</span>}
      </p>
    </div>
  );
}

/**
 * Betriebsart „Lebensweg“ (/map?mode=lebensweg&person=<id>&art=…): die Orte
 * eines Lebens bzw. die Geburtsorte der Vater- oder Mutterlinie als Weg
 * (lib/services/life-path.ts, components/LifePathMap.tsx). Lädt nicht die
 * Kartendaten der anderen Betriebsarten.
 */
async function LifePathPage({
  scope,
  person,
  cookie,
  kind,
}: {
  scope: Scope;
  person: string | null;
  cookie: string | null;
  kind: LifePathKind;
}) {
  const view = await loadLifePathView(scope, { person, cookie, kind });
  const personParam = person && view.person?.id === person ? `person=${encodeURIComponent(person)}&` : "";
  const kinds: { kind: LifePathKind; label: string }[] = [
    { kind: "person", label: "Person" },
    { kind: "father", label: "Vaterlinie" },
    { kind: "mother", label: "Mutterlinie" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Karte</p>
        <h1 className="page-title">Lebensweg</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          {kind === "person"
            ? "Die Orte eines Lebens als Weg: Geburt, Taufe, Wohnorte, Heirat, Auswanderung, Tod — in zeitlicher Reihenfolge, mit Jahreszahlen."
            : `Die ${kind === "father" ? "Vaterlinie" : "Mutterlinie"} hinauf: je Generation der Geburtsort, von der ältesten bekannten bis zur Person — so siehst du, wie die Familie gewandert ist.`}
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" data-testid="map-controls">
        <div className="min-w-0">
          <span className="muted">Person: </span>
          {view.person ? (
            <>
              <Link href={`/people/${view.person.id}`} className="font-medium text-accent-700 hover:underline dark:text-accent-300" data-testid="map-person">
                {view.person.name}
              </Link>
              {view.person.isSelf && <span className="muted"> (ich)</span>}
              {!view.person.isSelf && view.person.source !== "param" && <span className="muted"> (Bezugsperson)</span>}
            </>
          ) : (
            <span className="muted" data-testid="map-person">
              keine — „Das bin ich“ auf der eigenen Personenseite setzen oder eine Person wählen
            </span>
          )}
        </div>
        <MapPersonChooser mode="lebensweg" art={ART_OF[kind]} />
        {person && (
          <Link href={`/map?mode=lebensweg&art=${ART_OF[kind]}`} className="btn-link">
            zurück zur Bezugsperson
          </Link>
        )}
        <ModeSwitch personParam={personParam} current="lifepath" />
      </div>

      <div role="group" aria-label="Art des Wegs" className="flex flex-wrap gap-1" data-testid="lifepath-kinds">
        {kinds.map((k) => (
          <Link
            key={k.kind}
            href={`/map?${personParam}mode=lebensweg&art=${ART_OF[k.kind]}`}
            className="btn-secondary"
            aria-current={kind === k.kind ? "true" : undefined}
            data-testid={`lifepath-kind-${ART_OF[k.kind]}`}
            style={kind === k.kind ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
          >
            {k.label}
          </Link>
        ))}
      </div>

      {view.person && view.path ? (
        <LifePathMap key={`${view.person.id}-${kind}`} path={view.path} kind={kind} lineEnd={view.lineEnd} />
      ) : (
        <p className="card p-4 text-sm" data-testid="map-empty">
          Für den Lebensweg fehlt eine Person. Wähle oben eine Person.
        </p>
      )}

      <details className="card p-3 text-sm" data-testid="lifepath-rules">
        <summary className="cursor-pointer font-medium">Wie entsteht der Weg?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Person:</strong> alle Angaben mit Ort — Geburt, Taufe, Wohnorte, Ausbildung und Beruf, Heirat,
            Aus- und Einwanderung, Tod, Beerdigung … Die Geburt steht vorn, Tod und Beerdigung hinten, dazwischen nach
            Datum. Angaben ohne Datum stehen unter „ohne Datum“ und gehören nicht zum Weg.
          </li>
          <li>
            <strong>Ungenaue Daten</strong> („um 1850“, nur das Jahr) werden mit ihrem Jahr eingeordnet und so
            beschriftet. Abweichende Zweitangaben zählen nicht.
          </li>
          <li>
            <strong>Vater- und Mutterlinie:</strong> je Generation der leibliche Vater bzw. die leibliche Mutter, mit
            Geburtsort (sonst Taufort). Die Linie endet, wo niemand erfasst ist, das Geschlecht nicht eindeutig ist
            oder eine Person nicht freigegeben ist.
          </li>
          <li>
            Auf der Karte stehen nur Orte mit Zuordnung. Folgen Stationen am selben Ort aufeinander, ist das ein
            Punkt; gestrichelt heißt: dazwischen liegt eine Station ohne Ort auf der Karte.
          </li>
        </ul>
        <p className="mt-2">
          <HelpLink to="lebensweg" label="Ausführlich mit Beispiel: wie der Lebensweg entsteht" />
        </p>
      </details>

      <p className="text-xs muted" data-testid="map-attribution">
        Ländergrenzen (heutige Grenzen): Natural Earth, gemeinfrei. Ortsverzeichnis: GeoNames (geonames.org), Lizenz CC BY
        4.0. Die Karte lädt nichts von fremden Servern.
        {view.ms > 0 && <span> · berechnet in {view.ms} ms</span>}
      </p>
    </div>
  );
}
