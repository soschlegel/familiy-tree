import Link from "next/link";

import { requireScope } from "@/lib/session";
import { listDuplicateCandidates } from "@/lib/services";
import { DuplicateList } from "@/components/DuplicateList";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mögliche Dubletten" };

const PAGE_SIZE = 25;
const CLASSES = [
  { key: "", label: "Alle" },
  { key: "high", label: "Sicher" },
  { key: "medium", label: "Wahrscheinlich" },
  { key: "low", label: "Unklar" },
] as const;

/** Filter „Von der KI vorgeprüft“ (Adressparameter `ki`). */
const KI_FILTERS = [
  { key: "", label: "Alle Paare", review: undefined },
  { key: "vorgeprueft", label: "Vorgeprüft", review: "any" },
  { key: "zusammenfuehren", label: "KI: zusammenführen", review: "MERGE" },
  { key: "strittig", label: "KI: strittig", review: "DISPUTED" },
  { key: "kein-duplikat", label: "KI: kein Duplikat", review: "NOT_DUPLICATE" },
  { key: "offen", label: "Noch nicht vorgeprüft", review: "none" },
] as const;

/**
 * Alle möglichen Dubletten, nach Klasse und Punkten sortiert, seitenweise.
 * Was als „kein Duplikat“ markiert oder zusammengeführt ist, verschwindet —
 * die Liste wird kürzer, je weiter man kommt. Einschätzungen der KI
 * (MCP review_duplicate) stehen am Paar und lassen sich filtern; sie ändern
 * weder Klasse noch Reihenfolge und wählen nichts vor.
 */
export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ klasse?: string; seite?: string; ki?: string }> }) {
  const { scope } = await requireScope();
  const sp = await searchParams;
  const klasse = (["high", "medium", "low"] as const).find((k) => k === sp.klasse);
  const page = Math.max(1, Number(sp.seite ?? 1) || 1);
  const ki = KI_FILTERS.find((f) => f.key && f.key === sp.ki) ?? KI_FILTERS[0];
  const list = await listDuplicateCandidates(scope, { confidence: klasse, review: ki.review, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const href = (k: string, p = 1, f: string = ki.key) =>
    `/research/duplicates?${new URLSearchParams({ ...(k ? { klasse: k } : {}), ...(f ? { ki: f } : {}), ...(p > 1 ? { seite: String(p) } : {}) })}`;
  const rc = list.reviewCounts;
  const kiCount = (review: (typeof KI_FILTERS)[number]["review"]) => (review === undefined ? rc.any + rc.none : rc[review]);
  const all = list.counts.high + list.counts.medium + list.counts.low;

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">
          <Link href="/research" className="hover:underline">
            Recherche
          </Link>
        </p>
        <h1 className="page-title">Mögliche Dubletten</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Einträge, die vermutlich dieselbe Person meinen — auch unter Ehe- und Geburtsnamen und aus verschiedenen
          Importen. „Sicher“ heißt: gleicher Name, gleiches tagesgenaues Geburts- und Sterbedatum (oder
          dieselben Eltern) und kein Widerspruch. {list.dismissed > 0 && `${list.dismissed} Paare sind als „kein Duplikat“ markiert.`}
        </p>
        <p className="mt-1">
          <HelpLink to="dubletten" label="Wie funktionieren Dubletten und Zusammenführen?" />
        </p>
      </div>

      <nav aria-label="Klasse" className="flex flex-wrap gap-2">
        {CLASSES.map((c) => {
          const n = c.key ? list.counts[c.key] : all;
          const active = (klasse ?? "") === c.key;
          return (
            <Link key={c.key} href={href(c.key)} aria-current={active ? "page" : undefined} className={active ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
              {c.label} <span className="tabular-nums">({n})</span>
            </Link>
          );
        })}
      </nav>

      {(rc.any > 0 || ki.key) && (
        <nav aria-label="Von der KI vorgeprüft" className="flex flex-wrap items-center gap-2" data-testid="dup-ki-filter">
          <span className="text-sm muted">Von der KI vorgeprüft:</span>
          {KI_FILTERS.map((f) => {
            const active = ki.key === f.key;
            return (
              <Link
                key={f.key}
                href={href(klasse ?? "", 1, f.key)}
                aria-current={active ? "page" : undefined}
                className={active ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                data-testid={`dup-ki-${f.key || "alle"}`}
              >
                {f.label} <span className="tabular-nums">({kiCount(f.review)})</span>
              </Link>
            );
          })}
          <HelpLink to="dublettenKi" label="Was bedeutet die KI-Einschätzung?" />
        </nav>
      )}

      <DuplicateList items={list.items} emptyText="Keine (weiteren) möglichen Dubletten in dieser Auswahl." />

      {pages > 1 && (
        <nav aria-label="Seiten" className="flex flex-wrap items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={href(klasse ?? "", page - 1)} className="btn-secondary btn-sm">
              ← Zurück
            </Link>
          )}
          <span className="muted">
            Seite {page} von {pages}
          </span>
          {page < pages && (
            <Link href={href(klasse ?? "", page + 1)} className="btn-secondary btn-sm">
              Weiter →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
