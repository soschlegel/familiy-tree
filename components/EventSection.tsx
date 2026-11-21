"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { DateInput, dateFieldFrom, dateInputError, datePayload } from "./DateInput";
import { toDateInput, toFuzzyDate, type DatePrecision, type DateQualifier } from "@/lib/dates";
import {
  ALTERNATIVE_ONLY_TYPES,
  EVENT_TYPE_LABEL,
  type EventOwner,
  type EventTypeName,
} from "@/lib/events";
import { eventTypeGroups, valueCaption } from "@/lib/event-labels";
import { AttachedMedia, type AttachedItem, type InheritedItem, type MediaCandidate } from "./AttachedMedia";

/** Ereignis, wie die Personenseite es übergibt (EventDto + Träger + Belege). */
export type EventRow = {
  id: string;
  type: EventTypeName;
  label: string | null;
  title: string;
  isAlternative: boolean;
  date: string | null;
  datePrecision: DatePrecision;
  dateQualifier: DateQualifier;
  dateTo: string | null;
  dateToPrecision: DatePrecision;
  datePhrase: string | null;
  /** Fertige Anzeige samt Bereich und Wortlaut. */
  dateText: string;
  place: string | null;
  address: string | null;
  value: string | null;
  cause: string | null;
  age: string | null;
  agency: string | null;
  notes: string | null;
  canEdit: boolean;
  /** "person" oder die ID der Beziehung. */
  ownerKey: string;
  /** Bei Ereignissen einer Beziehung, z.B. „mit Margarethe Becker“. */
  ownerLabel: string | null;
  citations: { id: string; sourceId: string; sourceTitle: string; detail: string | null }[];
  /** Bilder am Ereignis. */
  media: AttachedItem[];
  /** Bilder seiner Belege bzw. deren Quellen (nur angezeigt, mit Herkunft). */
  documentImages: InheritedItem[];
};

/** Wo ein neues Ereignis hängen kann: die Person oder eine ihrer Partnerschaften. */
export type EventOwnerOption = { key: string; label: string; owner: EventOwner };

const isAltOnly = (t: EventTypeName) => ALTERNATIVE_ONLY_TYPES.includes(t);

/** Wozu eine abweichende Hauptangabe gehört — für die Kennzeichnung. */
const ALT_OF: Partial<Record<EventTypeName, string>> = {
  BIRTH: "zur Geburt",
  DEATH: "zum Tod",
  MARRIAGE: "zur Hochzeit",
  DIVORCE: "zur Scheidung",
};

type FormValues = {
  ownerKey: string;
  type: EventTypeName;
  label: string;
  isAlternative: boolean;
  date: string;
  dateAsPhrase: boolean;
  place: string;
  value: string;
  cause: string;
  age: string;
  agency: string;
  address: string;
  notes: string;
};

function valuesOf(e: EventRow): FormValues {
  const date = dateFieldFrom(
    toDateInput(toFuzzyDate(e.date, e.datePrecision, e.dateQualifier, e.dateTo, e.dateToPrecision)),
    e.datePhrase,
  );
  return {
    ownerKey: e.ownerKey,
    type: e.type,
    label: e.label ?? "",
    isAlternative: e.isAlternative,
    date: date.text,
    dateAsPhrase: date.asPhrase,
    place: e.place ?? "",
    value: e.value ?? "",
    cause: e.cause ?? "",
    age: e.age ?? "",
    agency: e.agency ?? "",
    address: e.address ?? "",
    notes: e.notes ?? "",
  };
}

const EMPTY = (ownerKey: string): FormValues => ({
  ownerKey,
  type: "BAPTISM",
  label: "",
  isAlternative: false,
  date: "",
  dateAsPhrase: false,
  place: "",
  value: "",
  cause: "",
  age: "",
  agency: "",
  address: "",
  notes: "",
});

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function EventForm({
  initial,
  owners,
  editing,
  storedPhrase,
  busy,
  fields,
  onSave,
  onCancel,
}: {
  initial: FormValues;
  owners: EventOwnerOption[];
  /** Beim Ändern bleibt der Träger fest. */
  editing: boolean;
  storedPhrase?: string | null;
  busy: boolean;
  fields: Record<string, string>;
  onSave: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [v, setV] = useState<FormValues>(initial);
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const owner = owners.find((o) => o.key === v.ownerKey) ?? owners[0];
  const groups = eventTypeGroups(owner.owner);
  const altOnly = isAltOnly(v.type);
  const more =
    Boolean(initial.cause || initial.age || initial.agency || initial.address || initial.notes) ||
    Boolean(fields.cause || fields.age || fields.agency || fields.address || fields.notes);
  const err = (k: string) => localError[k] || fields[k];

  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    if (localError[k]) setLocalError((e) => ({ ...e, [k]: "" }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const issues: Record<string, string> = {};
    const dateError = dateInputError(v.date, v.dateAsPhrase);
    if (dateError) issues.date = dateError;
    if (v.type === "CUSTOM" && !v.label.trim()) issues.label = "Bitte eine Bezeichnung für das eigene Ereignis angeben.";
    if (Object.keys(issues).length > 0) {
      setLocalError(issues);
      return;
    }
    onSave({ ...v, isAlternative: altOnly ? true : v.isAlternative });
  }

  const input = (k: "place" | "value" | "cause" | "age" | "agency" | "address" | "label", label: string, className = "") => (
    <div className={className}>
      <label htmlFor={`${id}-${k}`} className="field-label">
        {label}
      </label>
      <input
        id={`${id}-${k}`}
        className={`field w-full ${err(k) ? "field-invalid" : ""}`}
        value={v[k]}
        aria-invalid={err(k) ? true : undefined}
        onChange={(e) => set(k, e.target.value)}
      />
      {err(k) && <span className="field-error">{err(k)}</span>}
    </div>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={editing ? "Ereignis ändern" : "Ereignis hinzufügen"}
      className="space-y-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700"
      data-testid="event-form"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!editing && owners.length > 1 && (
          <div>
            <label htmlFor={`${id}-owner`} className="field-label">
              Gehört zu
            </label>
            <select
              id={`${id}-owner`}
              className="field w-full"
              value={v.ownerKey}
              onChange={(e) => {
                const next = owners.find((o) => o.key === e.target.value) ?? owners[0];
                const g = eventTypeGroups(next.owner);
                setV((prev) => ({ ...prev, ownerKey: next.key, type: g.common[0] ?? g.more[0] ?? "CUSTOM", isAlternative: false }));
              }}
            >
              {owners.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-type`} className="field-label">
            Art
          </label>
          <select
            id={`${id}-type`}
            className={`field w-full ${err("type") ? "field-invalid" : ""}`}
            value={v.type}
            onChange={(e) => {
              const t = e.target.value as EventTypeName;
              setV((prev) => ({ ...prev, type: t, isAlternative: isAltOnly(t) ? true : prev.isAlternative }));
            }}
          >
            {groups.common.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
            <option value="CUSTOM">Eigenes Ereignis …</option>
            <optgroup label="Weitere">
              {groups.more.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABEL[t]}
                </option>
              ))}
            </optgroup>
            {groups.alternativeOnly.length > 0 && (
              <optgroup label="Abweichende Angabe">
                {groups.alternativeOnly.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABEL[t]} (abweichende Angabe)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {err("type") && <span className="field-error">{err("type")}</span>}
        </div>
        {(v.type === "CUSTOM" || v.label) &&
          input("label", v.type === "CUSTOM" ? "Bezeichnung des Ereignisses" : "Bezeichnung (Präzisierung)")}
        <DateInput
          id={`${id}-date`}
          label="Datum"
          compact
          value={v.date}
          onChange={(t) => set("date", t)}
          error={err("date") || fields.datePhrase}
          allowPhrase
          asPhrase={v.dateAsPhrase}
          onAsPhraseChange={(on) => {
            set("dateAsPhrase", on);
            setLocalError((e) => ({ ...e, date: "" }));
          }}
          phrase={storedPhrase}
        />
        {input("place", "Ort")}
        {input("value", valueCaption(v.type))}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={altOnly || v.isAlternative}
          disabled={altOnly}
          onChange={(e) => set("isAlternative", e.target.checked)}
        />
        <span>
          Abweichende Angabe
          <span className="block text-xs muted">
            {altOnly
              ? "Die Hauptangabe steht bei der Person bzw. Partnerschaft — hier nur eine zweite, abweichende Überlieferung."
              : "Widerspricht einer anderen Angabe derselben Art; zählt nicht für Zeitleiste und Prüfungen."}
          </span>
        </span>
      </label>

      <details className="rounded-lg bg-stone-100/60 px-3 py-2 dark:bg-stone-900/40" open={more}>
        <summary className="cursor-pointer text-xs font-medium text-accent-700 max-md:py-3 max-md:text-sm dark:text-accent-300">
          Weitere Felder (Ursache, Alter, Institution, Anschrift, Notizen)
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {input("cause", "Ursache")}
          {input("age", "Alter laut Quelle")}
          {input("agency", "Institution / Behörde / Pfarrei")}
          {input("address", "Anschrift")}
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-notes`} className="field-label">
              Notizen
            </label>
            <textarea
              id={`${id}-notes`}
              rows={3}
              className="field w-full"
              value={v.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Speichert…" : editing ? "Speichern" : "Ereignis speichern"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function payloadOf(v: FormValues): Record<string, unknown> {
  return {
    type: v.type,
    label: orNull(v.label),
    isAlternative: v.isAlternative,
    ...datePayload("date", v.date, v.dateAsPhrase),
    place: orNull(v.place),
    value: orNull(v.value),
    cause: orNull(v.cause),
    age: orNull(v.age),
    agency: orNull(v.agency),
    address: orNull(v.address),
    notes: orNull(v.notes),
  };
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="mr-3 inline-block">
      <span className="muted">{label}:</span> {children}
    </span>
  );
}

function EventItem({
  e,
  canEdit,
  busy,
  onEdit,
  onDelete,
  mediaCandidates,
  children,
}: {
  e: EventRow;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  mediaCandidates: MediaCandidate[];
  children?: React.ReactNode;
}) {
  const altOf = e.isAlternative ? ALT_OF[e.type] : undefined;
  return (
    <li
      id={`ereignis-${e.id}`}
      className="scroll-mt-4 py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4"
      data-testid="event-row"
      data-event-id={e.id}
      data-alternative={e.isAlternative ? "true" : undefined}
    >
      <div className="text-sm tabular-nums text-stone-600 dark:text-stone-400" data-testid="event-date">
        {e.dateText || <span className="italic">ohne Datum</span>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold" data-testid="event-title">
            {e.title}
          </span>
          {e.type !== "CUSTOM" && e.label && <span className="text-sm muted">({e.label})</span>}
          {e.value && <span className="text-sm">— {e.value}</span>}
          {e.isAlternative && (
            <span className="badge-alt" data-testid="event-alternative">
              abweichende Angabe{altOf ? ` ${altOf}` : ""}
            </span>
          )}
          {e.ownerLabel && <span className="text-xs muted">· {e.ownerLabel}</span>}
          {canEdit && e.canEdit && (
            <span className="ml-auto flex shrink-0 gap-3">
              <a href={`#beleg-event:${e.id}`} className="btn-link" data-testid="event-cite">
                Beleg{e.citations.length ? ` (${e.citations.length})` : " hinzufügen"}
              </a>
              <button type="button" className="btn-link" disabled={busy} onClick={onEdit} aria-label={`${e.title} ändern`}>
                ändern
              </button>
              <button
                type="button"
                className="btn-link-danger"
                disabled={busy}
                onClick={onDelete}
                aria-label={`${e.title} entfernen`}
              >
                entfernen
              </button>
            </span>
          )}
        </div>
        {(e.place || e.address || e.cause || e.age || e.agency) && (
          <p className="mt-0.5 text-sm">
            {e.place && <Detail label="Ort">{e.place}</Detail>}
            {e.address && <Detail label="Anschrift">{e.address}</Detail>}
            {e.cause && <Detail label="Ursache">{e.cause}</Detail>}
            {e.age && <Detail label="Alter">{e.age}</Detail>}
            {e.agency && <Detail label="Institution">{e.agency}</Detail>}
          </p>
        )}
        {e.notes && <p className="mt-1 whitespace-pre-wrap text-sm muted">{e.notes}</p>}
        {e.citations.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="event-citations">
            {e.citations.map((c) => (
              <li key={c.id}>
                <span className="muted">Quelle:</span>{" "}
                <Link href={`/sources/${c.sourceId}`} className="font-medium hover:underline">
                  {c.sourceTitle}
                </Link>
                {c.detail && <span className="muted"> · {c.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        <AttachedMedia
          target={{ kind: "event", id: e.id }}
          items={e.media}
          inherited={e.documentImages}
          canEdit={canEdit && e.canEdit}
          candidates={mediaCandidates}
          label={[e.title, e.dateText].filter(Boolean).join(" ")}
          fallbackAlt={`Bild zu ${[e.title, e.dateText].filter(Boolean).join(" ")}`}
          testId="event-media"
        />
        {children}
      </div>
    </li>
  );
}

/**
 * Abschnitt „Lebensereignisse“ der Personenseite: Ereignisse der Person und
 * ihrer Partnerschaften in einer chronologischen Liste (undatierte nach
 * Reihenfolge am Ende), abweichende Hauptangaben (zweite Geburt, …) in einer
 * eigenen Gruppe. Bearbeiter können hier anlegen, ändern und löschen; ein
 * Verweis `#ereignis-<id>` springt zur Zeile.
 */
export function EventSection({
  personId,
  events,
  owners,
  canEdit,
  mediaCandidates = [],
}: {
  personId: string;
  events: EventRow[];
  owners: EventOwnerOption[];
  canEdit: boolean;
  /** Bilder dieser Seite, die sich an ein Ereignis hängen lassen. */
  mediaCandidates?: MediaCandidate[];
}) {
  const router = useRouter();
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  // Aus dem Kopf verlinkt (#ereignis-<id>): Zeile kurz hervorheben.
  useEffect(() => {
    const m = window.location.hash.match(/^#ereignis-(.+)$/);
    if (m) document.getElementById(`ereignis-${m[1]}`)?.scrollIntoView({ block: "center" });
  }, []);

  const main = events.filter((e) => !(e.isAlternative && isAltOnly(e.type)));
  const alternatives = events.filter((e) => e.isAlternative && isAltOnly(e.type));

  if (!canEdit && events.length === 0) return null;

  function begin() {
    setBusy(true);
    setError(null);
    setFields({});
    setNotice(null);
  }

  async function create(v: FormValues) {
    if (busy) return;
    begin();
    const url =
      v.ownerKey === "person" ? `/api/persons/${personId}/events` : `/api/relationships/${v.ownerKey}/events`;
    const res = await apiFetch(url, jsonBody("POST", payloadOf(v)));
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      setFields(res.fields);
      return;
    }
    setAdding(false);
    setFormKey((k) => k + 1);
    setNotice("Ereignis gespeichert.");
    router.refresh();
  }

  async function update(id: string, v: FormValues) {
    if (busy) return;
    begin();
    const res = await apiFetch(`/api/events/${id}`, jsonBody("PATCH", payloadOf(v)));
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

  async function remove(e: EventRow) {
    if (busy) return;
    const extra = e.citations.length > 0 ? ` Seine ${e.citations.length} Beleg(e) werden mit entfernt; die Quellen bleiben erhalten.` : "";
    if (!confirm(`Ereignis „${e.title}${e.dateText ? ` (${e.dateText})` : ""}“ wirklich entfernen?${extra}`)) return;
    begin();
    const res = await apiFetch(`/api/events/${e.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice("Ereignis entfernt.");
    router.refresh();
  }

  const item = (e: EventRow) => (
    <EventItem
      key={e.id}
      e={e}
      canEdit={canEdit}
      busy={busy}
      mediaCandidates={mediaCandidates}
      onEdit={() => {
        setEditing(editing === e.id ? null : e.id);
        setAdding(false);
        setFields({});
        setError(null);
      }}
      onDelete={() => void remove(e)}
    >
      {editing === e.id && (
        <div className="mt-2">
          <EventForm
            initial={valuesOf(e)}
            owners={owners.some((o) => o.key === e.ownerKey) ? owners : [...owners, ownerFallback(e)]}
            editing
            storedPhrase={e.datePhrase}
            busy={busy}
            fields={fields}
            onSave={(v) => void update(e.id, v)}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </EventItem>
  );

  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="person-events">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={headingId} className="section-title">
            Lebensereignisse
          </h2>
          <p className="text-sm muted">Taufe, Beruf, Wohnorte, Beerdigung — alles außer Geburt, Tod und Heirat.</p>
        </div>
        {canEdit && !adding && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setAdding(true);
              setEditing(null);
              setFields({});
              setError(null);
            }}
          >
            Ereignis hinzufügen
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <p className="card px-4 py-3 text-sm muted">Noch keine Lebensereignisse erfasst.</p>
      ) : (
        <div className="card px-4">
          {main.length > 0 && (
            <ul className="divide-y divide-stone-200 dark:divide-stone-800" data-testid="event-list">
              {main.map(item)}
            </ul>
          )}
          {alternatives.length > 0 && (
            <div className={main.length > 0 ? "border-t border-stone-200 dark:border-stone-800" : ""} data-testid="event-alternatives">
              <h3 className="eyebrow pt-3">Abweichende Angaben zu Hauptdaten</h3>
              <ul className="divide-y divide-stone-200 dark:divide-stone-800">{alternatives.map(item)}</ul>
            </div>
          )}
        </div>
      )}

      {canEdit && adding && (
        <EventForm
          key={formKey}
          initial={EMPTY("person")}
          owners={owners}
          editing={false}
          busy={busy}
          fields={fields}
          onSave={(v) => void create(v)}
          onCancel={() => {
            setAdding(false);
            setError(null);
            setFields({});
          }}
        />
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

/** Träger eines Ereignisses, das nicht in der Auswahl steht (z.B. Eltern-Kind-Beziehung). */
function ownerFallback(e: EventRow): EventOwnerOption {
  return {
    key: e.ownerKey,
    label: e.ownerLabel ?? "Beziehung",
    owner: e.ownerKey === "person" ? { kind: "person" } : { kind: "relationship", type: "PARENT_OF" },
  };
}
