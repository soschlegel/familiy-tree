import Link from "next/link";

import { requireScope } from "@/lib/session";
import { loadKinshipPage, type KinshipConnectionView, type KinshipFound } from "@/lib/services/kinship-view";
import { HelpLink } from "@/components/HelpLink";
import { KinshipPersonField } from "@/components/KinshipPersonField";
import { KinshipBloodDiagram, KinshipLegend, KinshipPathDiagram, type Roles } from "@/components/KinshipDiagram";
import { kinshipHref } from "@/components/kinship-url";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wie sind wir verwandt?" };

// Bewusst ohne loading.tsx: Wechsel, die nur Suchparameter ändern (andere
// Person, Tauschen), blieben mit einer Ladeanzeige hängen (siehe /statistics).

type Params = { a?: string | string[]; b?: string | string[] };

const ROLES: Roles = { a: "Erste Person", b: "Zweite Person" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const generations = (n: number) => (n === 1 ? "eine Generation" : `${n} Generationen`);

const ancestorsText = (conn: KinshipConnectionView): string => conn.ancestors.map((c) => c.name).join(" und ");

/** „Du und X“ bzw. Generationen bis zu den gemeinsamen Vorfahren. */
function degreeText(conn: KinshipConnectionView, a: string, b: string): string {
  if (conn.up === 0) return `${a} ist ${generations(conn.down)} über ${b}.`;
  if (conn.down === 0) return `${b} ist ${generations(conn.up)} über ${a}.`;
  if (conn.up === conn.down) return `Beide sind ${generations(conn.up)} von den gemeinsamen Vorfahren entfernt.`;
  return `${a} ist ${generations(conn.up)} von den gemeinsamen Vorfahren entfernt, ${b} ${generations(conn.down)}.`;
}

function Sentence({ subject, term, object, testId }: { subject: string; term: string | null; object: string; testId: string }) {
  if (!term) return null;
  return (
    <p data-testid={testId}>
      <strong className="font-semibold">{subject}</strong> ist <strong className="font-semibold text-accent-800 dark:text-accent-300">{term}</strong>{" "}
      von <strong className="font-semibold">{object}</strong>.
    </p>
  );
}

const KIND_LABEL: Record<KinshipFound["kind"], string> = {
  blood: "Blutsverwandt",
  inLaw: "Angeheiratet",
  other: "Über Stief- oder Pflegeeltern verbunden",
};

function Found({ r }: { r: KinshipFound }) {
  const a = r.a.name;
  const b = r.b.name;
  const main = r.connections[0];
  const more = r.connections.slice(1);
  return (
    <section aria-labelledby="kinship-result-h" className="space-y-5" data-testid="kinship-result">
      <div className="card space-y-2 p-5">
        <p className="eyebrow" data-testid="kinship-kind">
          {KIND_LABEL[r.kind]}
        </p>
        <h2 id="kinship-result-h" className="sr-only">
          Ergebnis
        </h2>
        <div className="space-y-1 font-serif text-lg leading-snug sm:text-xl">
          <Sentence subject={a} term={r.aForB} object={b} testId="kinship-a-for-b" />
          <Sentence subject={b} term={r.bForA} object={a} testId="kinship-b-for-a" />
        </div>
        {(!r.aForB || !r.bForA) && (
          <div className="text-sm" data-testid="kinship-no-term">
            <p>Für diese Verbindung gibt es keinen gängigen Begriff. Schritt für Schritt:</p>
            <ul className="mt-1 list-disc pl-5">
              {!r.bForA && (
                <li>
                  von {a} aus: {r.chainFromA}
                </li>
              )}
              {!r.aForB && (
                <li>
                  von {b} aus: {r.chainFromB}
                </li>
              )}
            </ul>
          </div>
        )}
        {main && (
          <p className="text-sm muted" data-testid="kinship-degree">
            {main.up > 0 && main.down > 0 && (
              <>
                {main.ancestors.length > 1 ? "Gemeinsame Vorfahren" : "Gemeinsamer Vorfahr"}: {ancestorsText(main)}.{" "}
              </>
            )}
            {degreeText(main, a, b)}
          </p>
        )}
        {!main && (
          <p className="text-sm muted" data-testid="kinship-degree">
            Kein gemeinsamer Vorfahr erfasst — die Verbindung läuft über {r.path.length - 1}{" "}
            {r.path.length - 1 === 1 ? "Schritt" : "Schritte"} im Stammbaum
            {r.kind === "inLaw" ? ", darunter Ehen oder Partnerschaften" : ""}.
          </p>
        )}
        {r.pathTerm && (
          <p className="text-sm" data-testid="kinship-path-term">
            Außerdem auf kürzerem Weg: {b} ist <strong className="font-semibold">{r.pathTerm}</strong> von {a}.
          </p>
        )}
      </div>

      <div className="card space-y-4 p-4 sm:p-6">
        <h2 className="section-title">So seid ihr verbunden</h2>
        {main ? <KinshipBloodDiagram conn={main} roles={ROLES} /> : <KinshipPathDiagram path={r.path} roles={ROLES} />}
        <KinshipLegend partner={!main} />
      </div>

      {more.length > 0 && (
        <section aria-labelledby="kinship-more-h" className="card space-y-2 p-5" data-testid="kinship-more">
          <h2 id="kinship-more-h" className="section-title">
            Weitere Verbindungen
          </h2>
          <p className="text-sm muted">
            Die beiden stammen noch über weitere gemeinsame Vorfahren voneinander ab (Ahnenschwund oder doppelte
            Verwandtschaft).
          </p>
          <ul className="space-y-2">
            {more.map((c, i) => (
              <li key={i}>
                <details className="group rounded-lg border border-stone-200 dark:border-stone-700">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {b} ist <strong className="font-semibold">{c.bForA}</strong> von {a} — über {ancestorsText(c)} (
                      {c.up === c.down ? `je ${generations(c.up)}` : `${generations(c.up)} / ${generations(c.down)}`})
                    </span>
                    <span aria-hidden className="text-xs muted transition group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <div className="border-t border-stone-200 p-3 dark:border-stone-700">
                    <KinshipBloodDiagram conn={c} roles={ROLES} testId="kinship-diagram-more" />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {r.moreConnections && <p className="text-sm muted">… und weitere, entferntere Verbindungen.</p>}
        </section>
      )}
    </section>
  );
}

/**
 * „Wie sind wir verwandt?“ — zwei Personen wählen, die App nennt die
 * Verwandtschaft aus beiden Blickrichtungen und zeichnet den Weg. Beide
 * Personen stehen als `a` und `b` in der Adresse. Daten und Rechte:
 * lib/services/kinship-view.ts.
 */
export default async function KinshipPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const aRaw = first(params.a);
  const bRaw = first(params.b);
  const page = await loadKinshipPage(scope, aRaw, bRaw);
  const aId = page.a.state === "ok" ? page.a.card.id : null;
  const bId = page.b.state === "ok" ? page.b.card.id : null;
  const r = page.result;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Forschung</p>
        <h1 className="page-title">Wie sind wir verwandt?</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Wähle zwei Personen — die App nennt die Verwandtschaft in Worten und zeigt, wie die beiden im Stammbaum
          verbunden sind.
        </p>
        <HelpLink to="verwandtschaft" className="mt-1" />
      </div>

      <div className="card flex flex-wrap items-start gap-3 p-4" data-testid="kinship-form">
        <KinshipPersonField
          slot="a"
          label={ROLES.a}
          selected={page.a.state === "ok" ? page.a.card : null}
          notFound={page.a.state === "notFound"}
          otherId={bId}
          self={page.self}
        />
        <div className="flex self-center pt-5 max-sm:w-full max-sm:justify-center max-sm:pt-0">
          {aId || bId ? (
            <Link href={kinshipHref(bId, aId)} className="btn-secondary" data-testid="kinship-swap" aria-label="Personen tauschen">
              <span aria-hidden>⇄</span>
              <span className="ml-1">Tauschen</span>
            </Link>
          ) : (
            <span aria-hidden className="text-stone-400">
              ⇄
            </span>
          )}
        </div>
        <KinshipPersonField
          slot="b"
          label={ROLES.b}
          selected={page.b.state === "ok" ? page.b.card : null}
          notFound={page.b.state === "notFound"}
          otherId={aId}
          self={page.self}
        />
      </div>

      {!r && (page.a.state !== "ok" || page.b.state !== "ok") && (
        <p className="text-sm muted" data-testid="kinship-hint">
          {page.a.state === "ok" || page.b.state === "ok"
            ? "Wähle noch die zweite Person."
            : "Tipp: Auf jeder Personenseite führt „Wie sind wir verwandt?“ direkt hierher."}
        </p>
      )}

      {r?.status === "same" && (
        <p className="alert-info" data-testid="kinship-same">
          Du hast zweimal {r.person.name} gewählt. Wähle als zweite Person jemand anderen.
        </p>
      )}

      {r?.status === "none" && (
        // Wortgleich mit der Personenseite (components/ReferencePanel.tsx).
        // Ob es eine Verbindung über nicht freigegebene Personen gibt, bleibt
        // bewusst offen — die Seite rechnet nur über sichtbare Personen.
        <div className="card space-y-1 p-5" data-testid="kinship-none">
          <p className="font-serif text-lg">
            {r.a.name} und {r.b.name}: keine Verwandtschaft über freigegebene Personen bekannt.
          </p>
          <p className="text-sm muted">
            Das heißt nicht, dass die beiden nicht verwandt sind — vielleicht fehlen noch Einträge, etwa Eltern oder
            eine Ehe, oder die Verbindung führt über Personen, die für dich nicht freigegeben sind.{" "}
            <HelpLink to="verwandtschaftFreigabe" label="Warum?" />
          </p>
        </div>
      )}

      {r?.status === "found" && <Found r={r} />}
    </div>
  );
}
