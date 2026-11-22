import Link from "next/link";
import { cookies } from "next/headers";

import { requireScope } from "@/lib/session";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { loadMapView, type MapMode } from "@/lib/services/map";
import { MapExplorer } from "@/components/MapExplorer";
import { MapPersonChooser } from "@/components/MapPersonChooser";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Karte" };

const ID_PATTERN = /^[\w-]{1,64}$/;

/**
 * Karte „Wurzeln nach Jahr“ (README, „Karte und Orte“).
 * Adresse: /map?person=<id>&mode=vorfahren|alle&jahr=<JJJJ>
 * - person: Ausgangsperson; ohne Angabe die Bezugsperson (Cookie bzw. „das
 *   bin ich“). Ändert die Bezugsperson des Baums nicht.
 * - mode: Vorfahren der Ausgangsperson (Standard) oder alle sichtbaren Personen.
 * - jahr: Startjahr (sonst das Jahr mit den meisten Personen auf der Karte).
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; mode?: string; jahr?: string }>;
}) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const jar = await cookies();
  const person = params.person && ID_PATTERN.test(params.person) ? params.person : null;
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
          Wo lebten die Vorfahren in einem bestimmten Jahr? Jede Person steht am zuletzt bekannten Ort; mit dem Regler
          oder „Abspielen“ wandert die Karte durch die Zeit.
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
        <div role="group" aria-label="Auswahl" className="flex gap-1 sm:ml-auto">
          <Link
            href={`/map?${personParam}mode=vorfahren`}
            className="btn-secondary"
            aria-current={view.mode === "ancestors" ? "true" : undefined}
            data-testid="map-mode-ancestors"
            style={view.mode === "ancestors" ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
          >
            Vorfahren
          </Link>
          <Link
            href={`/map?${personParam}mode=alle`}
            className="btn-secondary"
            aria-current={view.mode === "all" ? "true" : undefined}
            data-testid="map-mode-all"
            style={view.mode === "all" ? { boxShadow: "inset 0 0 0 2px rgb(var(--accent-600))" } : undefined}
          >
            Alle sichtbaren Personen
          </Link>
        </div>
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
