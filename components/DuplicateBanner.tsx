import Link from "next/link";

import { CONFIDENCE_LABEL } from "@/lib/duplicates";
import { VERDICT_LABEL } from "@/lib/duplicate-verdicts";
import { HELP_LINKS } from "@/lib/help/links";
import { lifeSpan } from "@/lib/tree-layout";
import type { PersonDuplicates } from "@/lib/services/duplicates";

const fullName = (p: { givenName: string; familyName: string | null; birthName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ") + (p.birthName ? ` geb. ${p.birthName}` : "");

/**
 * Hinweis auf der Personenseite: mögliche Dubletten dieser Person, je mit
 * Lebensdaten, Herkunft und Link zum Vergleich. Führt selbst nichts zusammen —
 * „Vergleichen“ öffnet die Vergleichsseite für genau dieses Paar. Wer was
 * sehen darf, entscheidet der Dienst (listDuplicatesOfPerson). Liegt eine
 * KI-Einschätzung zum Paar vor, steht ihr Urteil dezent dabei (Begründung in
 * der Dublettenliste); an Klasse und Reihenfolge ändert sie nichts.
 */
export function DuplicateBanner({ personId, duplicates }: { personId: string; duplicates: PersonDuplicates }) {
  const { total, items } = duplicates;
  if (total === 0) return null;
  const more = total - items.length;
  return (
    <aside aria-labelledby="duplicate-banner-h" className="alert-warning" data-testid="duplicate-banner">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span id="duplicate-banner-h" className="font-semibold">
          {total === 1 ? "1 mögliche Dublette" : `${total} mögliche Dubletten`}
        </span>
        {/* In der Farbe des Hinweises statt der Akzentfarbe (Kontrast). */}
        <Link href={HELP_LINKS.dublettenKlassen} className="text-xs underline underline-offset-2" data-testid="help-link">
          Was bedeuten „sicher“ und „wahrscheinlich“?
        </Link>
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((d) => (
          <li key={d.person.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="duplicate-banner-item" data-confidence={d.confidence}>
            <span>
              <span className="font-medium">{fullName(d.person)}</span> ({lifeSpan(d.person) || "Lebensdaten unbekannt"}, {d.origin.join(", ")})
            </span>
            <span className="badge">{CONFIDENCE_LABEL[d.confidence]}</span>
            {d.review && (
              <span className="text-xs" data-testid="duplicate-banner-review" data-verdict={d.review.verdict}>
                KI-Einschätzung: {VERDICT_LABEL[d.review.verdict]}
                {d.review.stale && " (veraltet)"}
              </span>
            )}
            <Link href={`/people/merge?keep=${personId}&other=${d.person.id}`} className="font-medium underline underline-offset-2" data-testid="duplicate-banner-compare">
              Vergleichen<span className="sr-only"> mit {fullName(d.person)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-1">
          {more === 1 ? "und 1 weitere" : `und ${more} weitere`} — alle unter{" "}
          <Link href="/research/duplicates" className="font-medium underline underline-offset-2">
            Mögliche Dubletten
          </Link>
          .
        </p>
      )}
    </aside>
  );
}
