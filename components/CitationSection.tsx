"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import {
  CITATION_FACT_LABEL,
  CONFIDENCE_LABEL,
  SOURCE_KIND_LABEL,
} from "@/lib/source-labels";
import {
  CITATION_CONFIDENCES,
  CITATION_FACTS,
  SOURCE_KINDS,
  type CitationConfidenceName,
  type CitationFactName,
  type SourceKindName,
} from "@/lib/validation";

/** Beleg in der Form, die die Personenseite übergibt (PersonCitation). */
export type CitationRow = {
  id: string;
  fact: CitationFactName;
  detail: string | null;
  confidence: CitationConfidenceName | null;
  canEdit: boolean;
  source: { id: string; title: string; kind: SourceKindName };
  relationshipId: string | null;
  /** Bezug bei Belegen an einer Beziehung, z.B. „Ehe mit Anna Becker“. */
  relationLabel: string | null;
  /** Beleg für ein Lebensereignis. */
  eventId?: string | null;
  /** Bezug bei Belegen für ein Ereignis, z.B. „Taufe 1858“. */
  eventLabel?: string | null;
};

/**
 * Wofür sich hier etwas belegen lässt: die Person selbst, eine ihrer
 * Beziehungen oder eines der Lebensereignisse.
 */
export type CitationTargetOption = {
  /** "person", die ID der Beziehung oder "event:<ID des Ereignisses>". */
  value: string;
  label: string;
  facts: CitationFactName[];
};

const FACT_ORDER = CITATION_FACTS;

const confidenceBadge: Record<CitationConfidenceName, string> = {
  HIGH: "badge-accent",
  MEDIUM: "badge",
  LOW: "badge border-brass-300 bg-brass-100 text-brass-700 dark:border-brass-700 dark:bg-brass-700/20 dark:text-brass-300",
};

function CitationEditor({
  row,
  facts,
  busy,
  fields,
  onSave,
  onCancel,
}: {
  row: CitationRow;
  facts: CitationFactName[];
  busy: boolean;
  fields: Record<string, string>;
  onSave: (data: { fact: CitationFactName; detail: string | null; confidence: CitationConfidenceName | null }) => void;
  onCancel: () => void;
}) {
  const [fact, setFact] = useState(row.fact);
  const [detail, setDetail] = useState(row.detail ?? "");
  const [confidence, setConfidence] = useState<string>(row.confidence ?? "");
  const id = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          fact,
          detail: detail.trim() || null,
          confidence: (confidence || null) as CitationConfidenceName | null,
        });
      }}
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3 dark:border-stone-800"
      aria-label="Beleg ändern"
    >
      <div>
        <label htmlFor={`${id}-fact`} className="field-label">
          Belegt
        </label>
        <select id={`${id}-fact`} className="field" value={fact} onChange={(e) => setFact(e.target.value as CitationFactName)}>
          {facts.map((f) => (
            <option key={f} value={f}>
              {CITATION_FACT_LABEL[f]}
            </option>
          ))}
        </select>
        {fields.fact && <span className="field-error">{fields.fact}</span>}
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <label htmlFor={`${id}-detail`} className="field-label">
          Fundstelle
        </label>
        <input id={`${id}-detail`} className="field w-full" value={detail} onChange={(e) => setDetail(e.target.value)} />
        {fields.detail && <span className="field-error">{fields.detail}</span>}
      </div>
      <div>
        <label htmlFor={`${id}-conf`} className="field-label">
          Verlässlichkeit
        </label>
        <select id={`${id}-conf`} className="field" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
          <option value="">nicht bewertet</option>
          {CITATION_CONFIDENCES.map((c) => (
            <option key={c} value={c}>
              {CONFIDENCE_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? "Speichert…" : "Speichern"}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary">
        Abbrechen
      </button>
    </form>
  );
}

/**
 * Abschnitt „Quellen“ auf der Personenseite: Belege nach Angabe gruppiert,
 * für Bearbeiter mit Ändern, Entfernen und Hinzufügen — auch für die
 * Beziehungen der Person (Heirat, Abstammung). Ein Verweis auf
 * `#beleg-<Beziehungs-ID>` öffnet das Formular direkt für diese Beziehung.
 */
export function CitationSection({
  personId,
  citations,
  targets,
  sources,
  canEdit,
  canCreateSource,
}: {
  personId: string;
  citations: CitationRow[];
  targets: CitationTargetOption[];
  sources: { id: string; title: string; kind: SourceKindName }[];
  canEdit: boolean;
  canCreateSource: boolean;
}) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(`person|BIRTH`);
  const [sourceId, setSourceId] = useState<string>(sources.length > 0 ? "" : "__new");
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<SourceKindName>("CHURCH_BOOK");
  const [detail, setDetail] = useState("");
  const [confidence, setConfidence] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Aus der Beziehungsliste verlinkt (#beleg-<id>): Formular für diese
  // Beziehung öffnen und hierher scrollen.
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#beleg-(.+)$/);
      if (!m) return;
      const target = targets.find((t) => t.value === decodeURIComponent(m[1]));
      if (!target || !canEdit) return;
      setOpen(true);
      setChoice(`${target.value}|${target.facts[0]}`);
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [targets, canEdit]);

  const factsFor = (row: CitationRow) =>
    row.eventId
      ? (["EVENT"] as CitationFactName[])
      : (row.relationshipId
      ? targets.find((t) => t.value === row.relationshipId)?.facts
      : targets.find((t) => t.value === "person")?.facts) ?? [row.fact];

  function begin() {
    setBusy(true);
    setError(null);
    setFields({});
    setNotice(null);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const [target, fact] = choice.split("|");
    if (!sourceId) {
      setError("Bitte eine Quelle wählen oder eine neue anlegen.");
      setFields({ sourceId: "Bitte eine Quelle wählen." });
      return;
    }
    if (sourceId === "__new" && !newTitle.trim()) {
      setError("Bitte die markierten Felder prüfen.");
      setFields({ title: "Bitte einen Titel für die neue Quelle angeben." });
      return;
    }
    begin();

    let useSource = sourceId;
    if (sourceId === "__new") {
      const created = await apiFetch<{ id: string }>(
        "/api/sources",
        jsonBody("POST", { title: newTitle, kind: newKind }),
      );
      if (!created.ok) {
        setBusy(false);
        setError(created.message);
        setFields(created.fields);
        return;
      }
      useSource = created.data.id;
    }

    const res = await apiFetch(
      "/api/citations",
      jsonBody("POST", {
        sourceId: useSource,
        ...(target === "person"
          ? { personId }
          : target.startsWith("event:")
            ? { eventId: target.slice("event:".length) }
            : { relationshipId: target }),
        fact,
        detail: detail.trim() || null,
        confidence: confidence || null,
      }),
    );
    setBusy(false);
    if (!res.ok) {
      setError(
        sourceId === "__new"
          ? `${res.message} (Die neue Quelle wurde angelegt und steht jetzt in der Auswahl.)`
          : res.message,
      );
      setFields(res.fields);
      if (sourceId === "__new") setSourceId(useSource);
      router.refresh();
      return;
    }
    setNotice("Beleg gespeichert.");
    setDetail("");
    setConfidence("");
    setNewTitle("");
    if (sourceId === "__new") setSourceId(useSource);
    router.refresh();
  }

  async function save(id: string, data: Record<string, unknown>) {
    if (busy) return;
    begin();
    const res = await apiFetch(`/api/citations/${id}`, jsonBody("PATCH", data));
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      setFields(res.fields);
      return;
    }
    setEditing(null);
    setNotice("Änderung gespeichert.");
    router.refresh();
  }

  async function remove(row: CitationRow) {
    if (busy) return;
    if (!confirm(`Beleg „${row.source.title}“ (${CITATION_FACT_LABEL[row.fact]}) wirklich entfernen? Die Quelle selbst bleibt erhalten.`)) return;
    begin();
    const res = await apiFetch(`/api/citations/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice("Beleg entfernt.");
    router.refresh();
  }

  const groups = FACT_ORDER.map((fact) => ({
    fact,
    rows: citations.filter((c) => c.fact === fact),
  })).filter((g) => g.rows.length > 0);

  return (
    <section
      ref={sectionRef}
      id="quellen"
      aria-labelledby={`${formId}-h`}
      className="scroll-mt-4 space-y-3"
      data-testid="person-sources"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`${formId}-h`} className="section-title">
            Quellen
          </h2>
          <p className="text-sm muted">Woher die Angaben stammen — Kirchenbücher, Urkunden, Grabsteine, Erzählungen.</p>
        </div>
        {canEdit && !open && (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Beleg hinzufügen
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="card px-4 py-3 text-sm muted">Noch keine Belege erfasst.</p>
      ) : (
        <div className="card divide-y divide-stone-200 dark:divide-stone-800">
          {groups.map((g) => (
            <div key={g.fact} className="px-4 py-3" data-testid={`citations-${g.fact.toLowerCase()}`}>
              <h3 className="eyebrow mb-1.5">{CITATION_FACT_LABEL[g.fact]}</h3>
              <ul className="space-y-1.5">
                {g.rows.map((row) => (
                  <li key={row.id} className="text-sm" data-testid="citation-row">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <Link href={`/sources/${row.source.id}`} className="font-medium hover:underline">
                        {row.source.title}
                      </Link>
                      <span className="badge px-2 py-0 text-[11px]">{SOURCE_KIND_LABEL[row.source.kind]}</span>
                      {row.eventLabel && <span className="text-xs muted">· {row.eventLabel}</span>}
                      {!row.eventLabel && row.relationLabel && <span className="text-xs muted">· {row.relationLabel}</span>}
                      {row.detail && <span className="text-xs muted">· {row.detail}</span>}
                      {row.confidence && (
                        <span className={`${confidenceBadge[row.confidence]} px-2 py-0 text-[11px]`}>
                          {CONFIDENCE_LABEL[row.confidence]}
                        </span>
                      )}
                      {row.canEdit && (
                        <span className="ml-auto flex shrink-0 gap-3">
                          <button
                            type="button"
                            className="btn-link"
                            disabled={busy}
                            aria-expanded={editing === row.id}
                            onClick={() => {
                              setEditing(editing === row.id ? null : row.id);
                              setFields({});
                            }}
                          >
                            ändern
                          </button>
                          <button
                            type="button"
                            className="btn-link-danger"
                            disabled={busy}
                            onClick={() => void remove(row)}
                            aria-label={`Beleg ${row.source.title} entfernen`}
                          >
                            entfernen
                          </button>
                        </span>
                      )}
                    </div>
                    {row.canEdit && editing === row.id && (
                      <CitationEditor
                        row={row}
                        facts={factsFor(row)}
                        busy={busy}
                        fields={fields}
                        onSave={(data) => void save(row.id, data)}
                        onCancel={() => setEditing(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canEdit && open && (
        <form
          onSubmit={add}
          aria-label="Beleg hinzufügen"
          className="space-y-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${formId}-what`} className="field-label">
                Was wird belegt?
              </label>
              <select
                id={`${formId}-what`}
                className="field w-full"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                {targets
                  .filter((t) => !t.value.startsWith("event:"))
                  .map((t) => (
                    <optgroup key={t.value} label={t.label}>
                      {t.facts.map((f) => (
                        <option key={f} value={`${t.value}|${f}`}>
                          {t.value === "person" ? CITATION_FACT_LABEL[f] : `${t.label} – ${CITATION_FACT_LABEL[f]}`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                {targets.some((t) => t.value.startsWith("event:")) && (
                  <optgroup label="Lebensereignisse">
                    {targets
                      .filter((t) => t.value.startsWith("event:"))
                      .map((t) => (
                        <option key={t.value} value={`${t.value}|EVENT`}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
              {fields.fact && <span className="field-error">{fields.fact}</span>}
            </div>
            <div>
              <label htmlFor={`${formId}-source`} className="field-label">
                Quelle
              </label>
              <select
                id={`${formId}-source`}
                className={`field w-full ${fields.sourceId ? "field-invalid" : ""}`}
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setFields({});
                }}
              >
                <option value="">Bitte wählen…</option>
                {canCreateSource && <option value="__new">+ Neue Quelle anlegen…</option>}
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({SOURCE_KIND_LABEL[s.kind]})
                  </option>
                ))}
              </select>
              {fields.sourceId && <span className="field-error">{fields.sourceId}</span>}
            </div>
          </div>

          {sourceId === "__new" && (
            <div className="grid gap-3 rounded-lg bg-stone-100/60 p-3 sm:grid-cols-[1fr_auto] dark:bg-stone-900/40">
              <div>
                <label htmlFor={`${formId}-title`} className="field-label">
                  Titel der neuen Quelle
                </label>
                <input
                  id={`${formId}-title`}
                  className={`field w-full ${fields.title ? "field-invalid" : ""}`}
                  placeholder="z.B. Kirchenbuch St. Marien Celle, Taufen 1850–1870"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                {fields.title && <span className="field-error">{fields.title}</span>}
              </div>
              <div>
                <label htmlFor={`${formId}-kind`} className="field-label">
                  Art
                </label>
                <select
                  id={`${formId}-kind`}
                  className="field w-full"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as SourceKindName)}
                >
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs muted sm:col-span-2">
                Archiv, Signatur, Abschrift und Scan lassen sich danach auf der Seite der Quelle ergänzen.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor={`${formId}-detail`} className="field-label">
                Fundstelle
              </label>
              <input
                id={`${formId}-detail`}
                className="field w-full"
                placeholder="z.B. Taufen 1858, Nr. 12, S. 34"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
              {fields.detail && <span className="field-error">{fields.detail}</span>}
            </div>
            <div>
              <label htmlFor={`${formId}-conf`} className="field-label">
                Verlässlichkeit
              </label>
              <select
                id={`${formId}-conf`}
                className="field w-full"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
              >
                <option value="">nicht bewertet</option>
                {CITATION_CONFIDENCES.map((c) => (
                  <option key={c} value={c}>
                    {CONFIDENCE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Speichert…" : "Beleg speichern"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
                setFields({});
              }}
            >
              Schließen
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && <p className="alert-success">{notice}</p>}
      </div>
    </section>
  );
}
