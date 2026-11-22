import { formatReleaseDate, type Release } from "@/lib/release-notes";

/**
 * Darstellung von Releases aus CHANGELOG.md (Neuigkeiten): je Release Datum,
 * Kurztitel und Stichpunkte. Gemeinsam für die Seite „Neuigkeiten“ und das
 * Fenster „Was ist neu?“. `headingLevel` passt die Überschriften an die
 * Umgebung an (Seite: h2, Fenster unter seinem h2: h3).
 */
export function ReleaseNoteList({ releases, headingLevel = 2 }: { releases: Release[]; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="space-y-5">
      {releases.map((r) => (
        <section key={r.id} aria-labelledby={`release-${r.id}`} data-testid="release" data-release-id={r.id}>
          <Heading id={`release-${r.id}`} className="font-serif text-lg font-semibold leading-snug break-words">
            {r.title}
          </Heading>
          <p className="text-xs muted">
            <time dateTime={r.date}>{formatReleaseDate(r.date)}</time>
            {r.seq > 1 && <span> · {r.seq}. Version des Tages</span>}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {r.items.map((item, i) => (
              <li key={i} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
