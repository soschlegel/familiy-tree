import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireScope } from "@/lib/session";
import { getSource, listScanCandidates, type CitationTarget, type PersonRef, type SourceDetail } from "@/lib/services";
import { AttachedMedia, type MediaCandidate } from "@/components/AttachedMedia";
import { CITATION_FACT_LABEL, CONFIDENCE_LABEL, DERIVED_SOURCE_KINDS, SOURCE_KIND_HINT, SOURCE_KIND_LABEL } from "@/lib/source-labels";
import { CitationLink } from "@/components/CitationLink";
import { formatDateOf, lifeSpan } from "@/lib/tree-layout";
import { PARTNER_SUBTYPE_LABEL } from "@/lib/partner-labels";
import { LockIcon } from "@/components/PersonNode";
import { DeleteSourceButton } from "@/components/DeleteSourceButton";

export const dynamic = "force-dynamic";

/** Gruppen (Personen/Beziehungen) je Seite der Beleg-Liste. */
const GROUPS_PER_PAGE = 50;

const name = (p: { givenName: string; familyName: string | null }) =>
  [p.givenName, p.familyName].filter(Boolean).join(" ");

const loadDetail = cache(async (id: string) => {
  const { scope } = await requireScope();
  const detail = await getSource(scope, id);
  // Vorhandene Bilder, die sich an die Quelle hängen lassen (nur für Bearbeiter).
  const candidates = detail?.canEdit ? await listScanCandidates(scope, id) : [];
  return detail ? { ...detail, candidates } : null;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadDetail(id);
  return { title: detail ? detail.source.title : "Nicht gefunden" };
}

function PersonName({ person }: { person: PersonRef }) {
  if (person.restricted) {
    return (
      <span className="inline-flex items-center gap-1 italic text-stone-500 dark:text-stone-400">
        <LockIcon className="h-3.5 w-3.5" /> Nicht freigegeben
      </span>
    );
  }
  return (
    <Link href={`/people/${person.id}`} className="font-medium hover:underline">
      {name(person)}
    </Link>
  );
}

const RELATION_LABEL: Record<string, string> = {
  MARRIED: "Ehe",
  DIVORCED: "Ehe (geschieden)",
  UNMARRIED: "Partnerschaft",
  PARTNER_UNKNOWN: `Partnerschaft (${PARTNER_SUBTYPE_LABEL.PARTNER_UNKNOWN})`,
  BIOLOGICAL: "Eltern – Kind",
  ADOPTIVE: "Adoption",
  STEP: "Stiefelternteil – Kind",
  FOSTER: "Pflegeelternteil – Kind",
};

function Target({ target }: { target: CitationTarget }) {
  if (target.kind === "person") {
    const span = target.person.restricted ? "" : lifeSpan(target.person);
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <PersonName person={target.person} />
        {span && <span className="text-xs muted">{span}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {RELATION_LABEL[target.subtype] ?? "Beziehung"}:
      </span>
      <PersonName person={target.from} />
      <span className="muted">&amp;</span>
      <PersonName person={target.to} />
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}

export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; seite?: string }>;
}) {
  const { id } = await params;
  const { saved, seite } = await searchParams;
  const detail: (SourceDetail & { candidates: { mediaId: string; caption: string | null; owner: string }[] }) | null =
    await loadDetail(id);
  // Unsichtbar = nicht vorhanden (wie bei Personen).
  if (!detail) notFound();
  const { source: s, citations } = detail;
  const date = formatDateOf(s, "date");
  const total = citations.length + detail.hiddenCitationCount;
  // Belege je Person bzw. Beziehung gruppiert (wer doppelt erscheint, ist
  // vermutlich doppelt erfasst) und seitenweise — Quellen aus Importen haben
  // oft tausende Belege.
  const groupKey = (t: CitationTarget) => (t.kind === "person" ? `p:${t.person.id}` : `r:${t.relationshipId}`);
  const groups = new Map<string, typeof citations>();
  for (const c of citations) groups.set(groupKey(c.target), [...(groups.get(groupKey(c.target)) ?? []), c]);
  const groupList = [...groups.values()];
  const pageCount = Math.max(1, Math.ceil(groupList.length / GROUPS_PER_PAGE));
  const page = Math.min(pageCount, Math.max(1, Number(seite ?? 1) || 1));
  const shown = groupList.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE);
  const derived = DERIVED_SOURCE_KINDS.includes(s.kind);
  const moreImages = detail.images.filter((m) => !m.isMain);
  const candidateMap = new Map<string, MediaCandidate>();
  for (const c of detail.candidates) {
    candidateMap.set(c.mediaId, { mediaId: c.mediaId, label: `${c.caption ?? "Bild ohne Beschriftung"} — ${c.owner}` });
  }
  for (const c of citations) {
    for (const m of c.media) {
      if (!candidateMap.has(m.mediaId)) {
        candidateMap.set(m.mediaId, { mediaId: m.mediaId, label: `${m.caption ?? "Bild ohne Beschriftung"} — Beleg ${c.detail ?? ""}`.trim() });
      }
    }
  }
  const mediaCandidates = detail.canEdit ? [...candidateMap.values()].filter((c) => c.mediaId !== s.mediaId) : [];

  return (
    <div className="space-y-8">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/sources" className="btn-link text-sm">
          ← Alle Quellen
        </Link>
      </nav>

      {saved && (
        <p role="status" className="alert-success">
          Quelle gespeichert.
        </p>
      )}

      <header className="card relative overflow-hidden p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brass-100/70 to-transparent dark:from-brass-700/20"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex flex-wrap gap-2" data-testid="source-badges">
              <span className="badge-accent" title={SOURCE_KIND_HINT[s.kind]}>
                {SOURCE_KIND_LABEL[s.kind]}
              </span>
              {s.provider && <span className="badge">{s.provider}</span>}
              {s.kindLabel && <span className="badge-alt">{s.kindLabel}</span>}
            </p>
            <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">{s.title}</h1>
            {s.author && <p className="muted">{s.author}</p>}
            {derived && (
              <p className="alert-warning text-sm" data-testid="source-derived-hint">
                {SOURCE_KIND_HINT[s.kind]} Belege daraus tragen deshalb keine Verlässlichkeit aus der Datei.
              </p>
            )}
          </div>
          {detail.canEdit && (
            <Link href={`/sources/${s.id}/edit`} className="btn-primary self-start">
              Bearbeiten
            </Link>
          )}
        </div>

        <dl className="relative mt-6 grid gap-4 border-t border-stone-200 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-800">
          <Row label="Archiv">{s.repository || "—"}</Row>
          <Row label="Signatur">{s.callNumber || "—"}</Row>
          <Row label="Datum">{date || "—"}</Row>
          <Row label="Internet">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent-700 underline-offset-2 hover:underline dark:text-accent-300">
                {s.url.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            ) : (
              "—"
            )}
          </Row>
        </dl>
      </header>

      {(s.notes || s.mediaId) && (
        <section aria-labelledby="notes-h" className="card grid gap-5 p-5 md:grid-cols-[1fr_auto]">
          <div>
            <h2 id="notes-h" className="section-title mb-2">
              Abschrift und Notizen
            </h2>
            {s.notes ? (
              <p className="whitespace-pre-wrap leading-relaxed">{s.notes}</p>
            ) : (
              <p className="text-sm muted">Keine Abschrift erfasst.</p>
            )}
          </div>
          {s.mediaId && (
            <figure className="md:w-56">
              <a href={`/api/media/${s.mediaId}`} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${s.mediaId}?variant=thumb`}
                  alt={detail.images.find((m) => m.isMain)?.caption ?? `Scan zu ${s.title}`}
                  className="w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                />
              </a>
              <figcaption className="mt-1 text-xs muted">Scan — antippen für volle Größe</figcaption>
            </figure>
          )}
        </section>
      )}

      {(moreImages.length > 0 || detail.canEdit) && (
        <section aria-labelledby="images-h" className="card space-y-2 p-5" data-testid="source-images">
          <h2 id="images-h" className="section-title">
            {s.mediaId ? "Weitere Bilder zur Quelle" : "Bilder zur Quelle"}{" "}
            <span className="font-sans text-sm font-normal muted">({moreImages.length})</span>
          </h2>
          <p className="text-sm muted">
            Erscheinen als Belegbild bei allen Angaben, die diese Quelle belegt — außer ein Bild hängt zugleich an einem
            einzelnen Beleg, dann nur dort.
          </p>
          <AttachedMedia
            target={{ kind: "source", id: s.id }}
            items={moreImages.map((m) => ({ mediaId: m.mediaId, caption: m.caption }))}
            canEdit={detail.canEdit}
            candidates={mediaCandidates}
            label={s.title}
            fallbackAlt={`Bild zu ${s.title}`}
            testId="source-media"
          />
        </section>
      )}

      <section aria-labelledby="cited-h" className="space-y-3" data-testid="source-citations">
        <div>
          <h2 id="cited-h" className="section-title">
            Belegt
          </h2>
          <p className="text-sm muted">
            {total === 0
              ? "Diese Quelle belegt noch nichts. Belege entstehen auf der Personenseite unter „Quellen“."
              : total === 1
                ? "Eine Angabe stützt sich auf diese Quelle."
                : `${total} Angaben stützen sich auf diese Quelle.`}
          </p>
        </div>
        {shown.length > 0 && (
          <ul className="card divide-y divide-stone-200 dark:divide-stone-800">
            {shown.map((group) => (
              <li key={groupKey(group[0].target)} className="px-4 py-2.5 text-sm" data-testid="source-citation-group">
                <Target target={group[0].target} />
                <ul className="mt-1 space-y-1">
                  {group.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="source-citation">
                      <span className="text-xs font-medium uppercase tracking-wide text-accent-700 dark:text-accent-300">
                        {c.eventTitle ? `${CITATION_FACT_LABEL[c.fact]}: ${c.eventTitle}` : CITATION_FACT_LABEL[c.fact]}
                      </span>
                      {c.detail && <span className="text-xs muted">{c.detail}</span>}
                      <CitationLink url={c.url} />
                      {c.confidence && !derived ? (
                        <span className="badge px-2 py-0 text-[11px]">{CONFIDENCE_LABEL[c.confidence]}</span>
                      ) : (
                        derived && (
                          <span className="badge-alt px-2 py-0 text-[11px]" title={SOURCE_KIND_HINT[s.kind]}>
                            nicht bewertet
                          </span>
                        )
                      )}
                      {c.media.length > 0 && (
                        <span className="basis-full">
                          <AttachedMedia
                            target={{ kind: "citation", id: c.id }}
                            items={c.media.map((m) => ({ mediaId: m.mediaId, caption: m.caption }))}
                            canEdit={false}
                            label={`Beleg ${c.detail ?? CITATION_FACT_LABEL[c.fact]}`}
                            fallbackAlt={`Belegbild: ${s.title}${c.detail ? `, ${c.detail}` : ""}`}
                            testId="source-citation-media"
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <nav aria-label="Seiten der Belege" className="flex flex-wrap items-center gap-3 text-sm">
            {page > 1 && (
              <Link href={`/sources/${s.id}?seite=${page - 1}`} className="btn-secondary btn-sm">
                ← Zurück
              </Link>
            )}
            <span className="muted">
              Seite {page} von {pageCount} ({groupList.length} Personen und Beziehungen)
            </span>
            {page < pageCount && (
              <Link href={`/sources/${s.id}?seite=${page + 1}`} className="btn-secondary btn-sm">
                Weiter →
              </Link>
            )}
          </nav>
        )}
        {detail.hiddenCitationCount > 0 && (
          <p className="alert-info" data-testid="source-hidden-citations">
            {detail.hiddenCitationCount === 1
              ? "Ein weiterer Beleg betrifft eine Familie, die für dich nicht freigegeben ist."
              : `${detail.hiddenCitationCount} weitere Belege betreffen Familien, die für dich nicht freigegeben sind.`}
          </p>
        )}
      </section>

      {detail.canDelete && (
        <section aria-label="Quelle löschen" className="rounded-2xl border border-stone-200 bg-stone-100/50 p-5 dark:border-stone-800 dark:bg-stone-900/40">
          <DeleteSourceButton sourceId={s.id} title={s.title} citationCount={total} />
        </section>
      )}
    </div>
  );
}
