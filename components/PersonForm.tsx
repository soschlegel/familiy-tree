"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { DateInput } from "./DateInput";
import { parseFuzzyDate } from "@/lib/dates";
import { personDateIssues } from "@/lib/validation";

export type PersonFormValues = {
  id?: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  /** Datum als Eingabetext (z.B. „12.03.1850“, „um 1850“), siehe lib/dates.ts. */
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
  notes: string | null;
};

const EMPTY: PersonFormValues = {
  givenName: "",
  familyName: "",
  birthName: "",
  gender: "UNKNOWN",
  birthDate: "",
  birthPlace: "",
  deathDate: "",
  deathPlace: "",
  notes: "",
};

type TextKey = Exclude<keyof PersonFormValues, "id" | "gender">;

/**
 * Dieselben Datumsregeln wie im Server schon vor dem Absenden prüfen — der
 * Server bleibt maßgeblich, aber so steht der Hinweis gleich am Feld.
 */
function localIssues(v: PersonFormValues): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!v.givenName.trim()) issues.givenName = "Bitte einen Vornamen angeben.";
  const birth = parseFuzzyDate(v.birthDate);
  const death = parseFuzzyDate(v.deathDate);
  if (!birth.ok) issues.birthDate = birth.error;
  if (!death.ok) issues.deathDate = death.error;
  if (birth.ok && death.ok) {
    for (const issue of personDateIssues({ birthDate: birth.value, deathDate: death.value })) {
      issues[issue.path] ??= `${issue.message}.`;
    }
  }
  return issues;
}

export function PersonForm({
  initial,
  families = [],
}: {
  initial?: PersonFormValues;
  families?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<PersonFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Beim Anlegen entscheidet die Familie darüber, wer die Person sieht.
  // Vorbelegt mit der ersten, damit sie nicht versehentlich unsichtbar wird.
  const [familyIds, setFamilyIds] = useState<string[]>(
    families.length > 0 ? [families[0].id] : [],
  );
  const isEdit = Boolean(initial?.id);

  const set = <K extends keyof PersonFormValues>(
    key: K,
    value: PersonFormValues[K],
  ) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (fields[key as string]) setFields((f) => ({ ...f, [key]: "" }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const local = localIssues(values);
    if (Object.keys(local).length > 0) {
      setFields(local);
      setError("Bitte die markierten Felder prüfen.");
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    // Leere Felder als null schicken, damit sie beim Bearbeiten wirklich
    // geleert werden.
    const payload = Object.fromEntries(
      Object.entries(values)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => [k, typeof v === "string" && v.trim() === "" && k !== "givenName" ? null : v]),
    );

    const res = await apiFetch<{ id: string }>(
      isEdit ? `/api/persons/${initial!.id}` : "/api/persons",
      jsonBody(isEdit ? "PATCH" : "POST", isEdit ? payload : { ...payload, familyIds }),
    );

    if (!res.ok) {
      setSaving(false);
      setError(res.message);
      setFields(res.fields);
      return;
    }

    // `saving` bleibt gesetzt, bis die Folgeseite da ist — kein Doppelklick.
    router.push(`/people/${res.data.id}`);
    router.refresh();
  }

  const date = (key: "birthDate" | "deathDate", label: string) => (
    <DateInput
      id={`person-${key}`}
      label={label}
      value={values[key] ?? ""}
      error={fields[key]}
      onChange={(v) => set(key, v)}
    />
  );

  const text = (key: TextKey, label: string, opts: { type?: string; required?: boolean; autoComplete?: string } = {}) => {
    const id = `person-${key}`;
    const err = fields[key];
    const raw = values[key] ?? "";
    return (
      <div>
        <label htmlFor={id} className="field-label">
          {label}
          {opts.required && <span aria-hidden className="text-red-700 dark:text-red-400"> *</span>}
        </label>
        <input
          id={id}
          type={opts.type ?? "text"}
          required={opts.required}
          autoComplete={opts.autoComplete ?? "off"}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : undefined}
          className={`field w-full ${err ? "field-invalid" : ""}`}
          value={raw}
          onChange={(e) => set(key, e.target.value)}
        />
        {err && (
          <span id={`${id}-error`} className="field-error">
            {err}
          </span>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="card max-w-2xl space-y-5 p-5 sm:p-6" aria-label={isEdit ? "Person bearbeiten" : "Person anlegen"}>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-2">Name</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("givenName", "Vorname", { required: true })}
          {text("familyName", "Nachname")}
          {text("birthName", "Geburtsname")}
          <div>
            <label htmlFor="person-gender" className="field-label">
              Geschlecht
            </label>
            <select
              id="person-gender"
              className="field w-full"
              value={values.gender}
              onChange={(e) => set("gender", e.target.value as PersonFormValues["gender"])}
            >
              <option value="UNKNOWN">unbekannt</option>
              <option value="FEMALE">weiblich</option>
              <option value="MALE">männlich</option>
              <option value="OTHER">divers</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-2">Lebensdaten</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {date("birthDate", "Geburtsdatum")}
          {text("birthPlace", "Geburtsort")}
          {date("deathDate", "Sterbedatum")}
          {text("deathPlace", "Sterbeort")}
        </div>
      </fieldset>

      {!isEdit && families.length > 0 && (
        <fieldset>
          <legend className="eyebrow mb-1">Familien</legend>
          <p className="mb-2 text-sm muted">Bestimmen, wer diese Person sehen kann.</p>
          <div className="flex flex-wrap gap-2">
            {families.map((f) => {
              const active = familyIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setFamilyIds((prev) =>
                      active ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                    active
                      ? "border-accent-700 bg-accent-700 text-white dark:border-accent-300 dark:bg-accent-300 dark:text-stone-950"
                      : "border-stone-300 bg-surface text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  }`}
                >
                  <span aria-hidden>{active ? "✓" : "+"}</span>
                  {f.name}
                </button>
              );
            })}
          </div>
          {familyIds.length === 0 && (
            <p className="alert-warning mt-2">
              Ohne Familie ist die Person nur für Administratoren sichtbar.
            </p>
          )}
          {fields.familyIds && <span className="field-error">{fields.familyIds}</span>}
        </fieldset>
      )}

      <div>
        <label htmlFor="person-notes" className="field-label">
          Notizen
        </label>
        <textarea
          id="person-notes"
          rows={4}
          className="field w-full"
          value={values.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Speichert…" : isEdit ? "Änderungen speichern" : "Person anlegen"}
        </button>
        <Link href={isEdit ? `/people/${initial!.id}` : "/people"} className="btn-secondary">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
