import { MANUAL_ORIGIN } from "@/lib/origin";
import { plural } from "@/lib/plural";
import type { PersonOrigin as PersonOriginData } from "@/lib/services";
import { HelpLink } from "./HelpLink";
import { OriginChip } from "./OriginChips";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }) : null;

/**
 * Block „Herkunft“ auf der Personenseite (nur für Bearbeiter — die Daten
 * liefert `getPersonOrigin` nur dann): aus welchen Importen die Person
 * stammt und ob sie aus mehreren Einträgen zusammengeführt wurde.
 *
 * Bewusst ehrlich bei den Hauptangaben: Es gibt keine Herkunft je Feld. Der
 * Block sagt das, statt eine zu erfinden.
 */
export function PersonOrigin({ origin }: { origin: PersonOriginData }) {
  const { imports, merged } = origin;
  return (
    <section aria-labelledby="origin-h" className="card space-y-3 p-5" data-testid="person-origin">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="origin-h" className="section-title">
          Herkunft
        </h2>
        <HelpLink to="herkunftPerson" />
      </div>

      {origin.manual ? (
        <p className="flex items-center gap-2 text-sm" data-testid="person-origin-manual">
          <OriginChip entry={MANUAL_ORIGIN} size="md" />
          <span>
            <span className="font-medium">Von Hand erfasst</span> — diese Person stammt aus keinem Import.
          </span>
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm" data-testid="person-origin-imports">
          {imports.map((i) => {
            const first = day(i.firstImportedAt);
            const last = day(i.lastImportedAt);
            return (
              <li key={i.key} className="flex items-start gap-2" data-testid="person-origin-import" data-origin={i.key}>
                <span className="mt-0.5">
                  <OriginChip entry={i} size="md" />
                </span>
                <span className="min-w-0">
                  <span className="sr-only">Import {i.letter}: </span>
                  <span className="break-words font-medium">{i.name}</span>
                  <span className="muted">
                    {first && ` · importiert am ${first}`}
                    {last && last !== first && `, zuletzt aktualisiert am ${last}`}
                    {i.records > 1 && ` · ${i.records} Einträge dieses Imports`}
                    {i.viaMerge && " · durch Zusammenführen dazugekommen"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {merged && (
        <p className="text-sm" data-testid="person-origin-merged">
          {merged.lastAt
            ? merged.entries === 2
              ? `Zusammengeführt am ${day(merged.lastAt)} aus 2 Einträgen.`
              : `Zusammengeführt aus ${merged.entries} Einträgen, zuletzt am ${day(merged.lastAt)}.`
            : `Zusammengeführt aus ${plural(merged.entries, "Eintrag", "Einträgen")}.`}
        </p>
      )}

      <p className="max-w-3xl text-xs muted" data-testid="person-origin-note">
        {origin.manual
          ? "Buchstaben an Ereignissen, weiteren Namen, Beziehungen und Belegen zeigen, welcher Import einen Eintrag geliefert hat; Einträge ohne Buchstaben sind in der App entstanden."
          : "Für Name, Geburt, Tod und Geschlecht gibt es keine Herkunft je Angabe: Sie können aus jedem der genannten Importe stammen oder in der App geändert worden sein — was seit Einführung der Änderungsgeschichte geändert wurde, steht unter „Änderungen“. Buchstaben an Ereignissen, weiteren Namen, Beziehungen und Belegen zeigen, welcher Import den Eintrag geliefert hat; Einträge ohne Buchstaben sind in der App entstanden."}
      </p>
    </section>
  );
}
