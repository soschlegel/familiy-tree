"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { PersonPicker, type PickerPerson } from "./PersonPicker";
import { apiFetch, jsonBody } from "./api-client";
import { DateInput } from "./DateInput";
import { formatDate } from "@/lib/tree-layout";
import { parseFuzzyDate, toDateInput, toFuzzyDate } from "@/lib/dates";

export type RelationRow = {
  id: string;
  label: string; // "Elternteil" | "Kind" | "Partner"
  subtype: string;
  startDate: string | null;
  endDate: string | null;
  startDatePrecision?: string;
  startDateQualifier?: string;
  endDatePrecision?: string;
  endDateQualifier?: string;
  otherId: string;
  otherName: string;
  /** Andere Seite ist für den Benutzer nicht sichtbar — kein Verweis. */
  otherRestricted?: boolean;
  /** Zahl der Belege an dieser Beziehung. */
  citationCount?: number;
};

const SUBTYPE_LABEL: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "adoptiert",
  STEP: "Stief",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
};

// Beschriftung der Datumsfelder je Beziehungsart. null = Feld ausblenden.
const DATE_FIELDS: Record<string, { start: string | null; end: string | null }> =
  {
    MARRIED: { start: "Hochzeitsdatum", end: null },
    UNMARRIED: { start: "Zusammen seit", end: null },
    DIVORCED: { start: "Hochzeitsdatum", end: "Scheidungsdatum" },
    ADOPTIVE: { start: "Adoption am", end: null },
    FOSTER: { start: "In Pflege seit", end: null },
    BIOLOGICAL: { start: null, end: null },
    STEP: { start: null, end: null },
  };

const fmt = (d: string | null, precision?: string, qualifier?: string) =>
  d ? formatDate(d, precision, qualifier) : null;

/** "verheiratet seit 01.08.1984" bzw. "geschieden, um 1984 – 2001" */
function describe(r: RelationRow): string {
  const base = SUBTYPE_LABEL[r.subtype] ?? r.subtype;
  const start = fmt(r.startDate, r.startDatePrecision, r.startDateQualifier);
  const end = fmt(r.endDate, r.endDatePrecision, r.endDateQualifier);

  if (start && end) return `${base}, ${start} – ${end}`;
  if (start) return `${base} seit ${start}`;
  if (end) return `${base} bis ${end}`;
  return base;
}

type PatchData = {
  subtype: string;
  startDate: string | null;
  endDate: string | null;
};

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/** Nachträgliche Korrektur von Art und Zeitraum einer bestehenden Beziehung. */
function RelationDateEditor({
  relation,
  busy,
  fields,
  onSave,
  onCancel,
}: {
  relation: RelationRow;
  busy: boolean;
  fields: Record<string, string>;
  onSave: (data: PatchData) => void;
  onCancel: () => void;
}) {
  const [subtype, setSubtype] = useState(relation.subtype);
  // Eingabetext in der gespeicherten Genauigkeit („um 1950“, „03.1950“).
  const [start, setStart] = useState(
    toDateInput(toFuzzyDate(relation.startDate, relation.startDatePrecision, relation.startDateQualifier)),
  );
  const [end, setEnd] = useState(
    toDateInput(toFuzzyDate(relation.endDate, relation.endDatePrecision, relation.endDateQualifier)),
  );
  const invalid = !parseFuzzyDate(start).ok || !parseFuzzyDate(end).ok;

  const labels = DATE_FIELDS[subtype] ?? { start: null, end: null };
  const isPartner = relation.label === "Partner";
  const choices = isPartner
    ? ["MARRIED", "UNMARRIED", "DIVORCED"]
    : ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        onSave({
          subtype,
          startDate: labels.start && start ? start : null,
          endDate: labels.end && end ? end : null,
        });
      }}
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3 dark:border-stone-800"
    >
      <Field label="Näheres" error={fields.subtype}>
        {(id) => (
          <select id={id} className="field" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
            {choices.map((s) => (
              <option key={s} value={s}>
                {SUBTYPE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
      </Field>

      {labels.start && (
        <DateInput compact className="w-48" label={labels.start} error={fields.startDate} value={start} onChange={setStart} />
      )}

      {labels.end && (
        <DateInput compact className="w-48" label={labels.end} error={fields.endDate} value={end} onChange={setEnd} />
      )}

      <button type="submit" disabled={busy || invalid} className="btn-primary">
        {busy ? "Speichert…" : "Speichern"}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary">
        Abbrechen
      </button>
    </form>
  );
}

/**
 * Beziehungen einer Person bearbeiten: vorhandene ändern oder entfernen,
 * neue hinzufügen. Die Ansicht der Verwandten selbst steht als Karten auf der
 * Personenseite — hier geht es nur ums Bearbeiten.
 */
export function RelationshipEditor({
  personId,
  relations,
  people,
  canEdit,
}: {
  personId: string;
  relations: RelationRow[];
  people: PickerPerson[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"PARENT" | "CHILD" | "PARTNER">("CHILD");
  const [otherId, setOtherId] = useState("");
  const [subtype, setSubtype] = useState("BIOLOGICAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const pickerLabel = useId();

  // Neu angelegte Personen sofort auswählbar machen, ohne die Seite neu zu
  // laden — sonst ginge die halbfertige Zuordnung verloren.
  const [extraPeople, setExtraPeople] = useState<PickerPerson[]>([]);
  const options = [...people, ...extraPeople];

  const dateLabels = DATE_FIELDS[subtype] ?? { start: null, end: null };

  function begin() {
    setBusy(true);
    setError(null);
    setFields({});
    setNotice(null);
  }

  function resetForm() {
    setOtherId("");
    setStartDate("");
    setEndDate("");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!otherId) {
      setError("Bitte zuerst eine Person auswählen.");
      return;
    }
    if (!parseFuzzyDate(startDate).ok || !parseFuzzyDate(endDate).ok) {
      setError("Bitte das Datum prüfen.");
      return;
    }
    begin();

    // Richtung auflösen: PARENT_OF zeigt immer vom Elternteil zum Kind.
    const body =
      kind === "PARENT"
        ? { type: "PARENT_OF", fromPersonId: otherId, toPersonId: personId }
        : kind === "CHILD"
          ? { type: "PARENT_OF", fromPersonId: personId, toPersonId: otherId }
          : { type: "PARTNER_OF", fromPersonId: personId, toPersonId: otherId };

    const res = await apiFetch(
      "/api/relationships",
      jsonBody("POST", {
        ...body,
        subtype,
        startDate: dateLabels.start && startDate ? startDate : null,
        endDate: dateLabels.end && endDate ? endDate : null,
      }),
    );
    setBusy(false);

    if (!res.ok) {
      setError(res.message);
      setFields(res.fields);
      return;
    }

    const other = options.find((p) => p.id === otherId);
    setNotice(
      `Beziehung zu ${other ? [other.givenName, other.familyName].filter(Boolean).join(" ") : "der Person"} hinzugefügt.`,
    );
    resetForm();
    router.refresh();
  }

  async function save(id: string, data: PatchData) {
    if (busy) return;
    begin();
    const res = await apiFetch(`/api/relationships/${id}`, jsonBody("PATCH", data));
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

  async function remove(r: RelationRow) {
    if (busy) return;
    const who = r.otherRestricted ? "einer nicht freigegebenen Person" : `„${r.otherName}"`;
    if (!confirm(`Beziehung zu ${who} (${r.label}) wirklich entfernen?`)) return;
    begin();
    const res = await apiFetch(`/api/relationships/${r.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice("Beziehung entfernt.");
    router.refresh();
  }

  const subtypeOptions =
    kind === "PARTNER"
      ? ["MARRIED", "UNMARRIED", "DIVORCED"]
      : ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"];

  return (
    <section aria-labelledby="rel-editor-h" className="space-y-3" data-testid="relationship-editor">
      <h3 id="rel-editor-h" className="font-serif text-base font-semibold">
        Beziehungen
      </h3>

      {relations.length === 0 ? (
        <p className="text-sm muted">Keine Beziehungen erfasst.</p>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-surface dark:divide-stone-800 dark:border-stone-800">
          {relations.map((r) => (
            <li key={r.id} className="px-3 py-2 text-sm" data-testid="relation-row">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {r.label}
                </span>
                {r.otherRestricted ? (
                  <span className="italic text-stone-500 dark:text-stone-400">{r.otherName}</span>
                ) : (
                  <Link href={`/people/${r.otherId}`} className="font-medium hover:underline">
                    {r.otherName}
                  </Link>
                )}
                <span className="text-xs muted">{describe(r)}</span>

                {canEdit && (
                  <span className="ml-auto flex shrink-0 gap-3">
                    {/* Belege zu dieser Beziehung stehen im Abschnitt „Quellen“;
                        der Verweis öffnet dort das Formular für genau sie. */}
                    <a href={`#beleg-${r.id}`} className="btn-link" data-testid="relation-citations-link">
                      Belege{r.citationCount ? ` (${r.citationCount})` : ""}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(editing === r.id ? null : r.id);
                        setFields({});
                      }}
                      disabled={busy}
                      aria-expanded={editing === r.id}
                      className="btn-link"
                    >
                      ändern
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(r)}
                      disabled={busy}
                      className="btn-link-danger"
                      aria-label={`Beziehung zu ${r.otherName} entfernen`}
                    >
                      entfernen
                    </button>
                  </span>
                )}
              </div>

              {canEdit && editing === r.id && (
                <RelationDateEditor
                  relation={r}
                  busy={busy}
                  fields={fields}
                  onSave={(data) => void save(r.id, data)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          onSubmit={add}
          aria-label="Beziehung hinzufügen"
          className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700"
        >
          <Field label="Art">
            {(id) => (
              <select
                id={id}
                className="field"
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as typeof kind;
                  setKind(next);
                  setSubtype(next === "PARTNER" ? "MARRIED" : "BIOLOGICAL");
                  resetForm();
                }}
              >
                <option value="CHILD">Kind</option>
                <option value="PARENT">Elternteil</option>
                <option value="PARTNER">Partner</option>
              </select>
            )}
          </Field>

          <div>
            <span id={pickerLabel} className="field-label">
              Person
            </span>
            <PersonPicker
              people={options.filter((p) => p.id !== personId)}
              value={otherId}
              onChange={setOtherId}
              onCreated={(p) => setExtraPeople((prev) => [...prev, p])}
              placeholder="Suchen oder neu anlegen…"
              labelledBy={pickerLabel}
            />
          </div>

          <Field label="Näheres" error={fields.subtype}>
            {(id) => (
              <select id={id} className="field" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                {subtypeOptions.map((s) => (
                  <option key={s} value={s}>
                    {SUBTYPE_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {dateLabels.start && (
            <DateInput
              compact
              className="w-48"
              label={dateLabels.start}
              error={fields.startDate}
              value={startDate}
              onChange={setStartDate}
            />
          )}

          {dateLabels.end && (
            <DateInput
              compact
              className="w-48"
              label={dateLabels.end}
              error={fields.endDate}
              value={endDate}
              onChange={setEndDate}
            />
          )}

          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Speichert…" : "Hinzufügen"}
          </button>
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
