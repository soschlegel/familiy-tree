"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { DateInput, dateInputError, datePayload } from "./DateInput";
import { SOURCE_KIND_LABEL } from "@/lib/source-labels";
import { SOURCE_KINDS, type SourceKindName } from "@/lib/validation";

export type SourceFormValues = {
  id?: string;
  title: string;
  kind: SourceKindName;
  author: string;
  repository: string;
  callNumber: string;
  url: string;
  /** Eingabetext, z.B. „1858“ oder „um 1900“ (lib/dates.ts). */
  date: string;
  /** Unlesbarer Text im Datumsfeld wird als Wortlaut gespeichert. */
  dateAsPhrase?: boolean;
  /** Gespeicherter Wortlaut neben einem Datum (nur Anzeige). */
  datePhrase?: string | null;
  notes: string;
  mediaId: string;
};

const EMPTY: SourceFormValues = {
  title: "",
  kind: "CHURCH_BOOK",
  author: "",
  repository: "",
  callNumber: "",
  url: "",
  date: "",
  notes: "",
  mediaId: "",
};

type TextKey = "title" | "author" | "repository" | "callNumber" | "url";

/**
 * Quelle anlegen bzw. bearbeiten. Der Scan wird aus Bildern gewählt, die
 * schon an Personen oder Ehen hängen, für die die Quelle zitiert wird — so
 * gelten für ihn dieselben Rechte wie für diese Bilder.
 */
export function SourceForm({
  initial,
  scanCandidates = [],
}: {
  initial?: SourceFormValues;
  scanCandidates?: { mediaId: string; caption: string | null; owner: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<SourceFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(initial?.id);

  const set = <K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (fields[key as string]) setFields((f) => ({ ...f, [key]: "" }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const local: Record<string, string> = {};
    if (!values.title.trim()) local.title = "Bitte einen Titel angeben.";
    const dateError = dateInputError(values.date, values.dateAsPhrase);
    if (dateError) local.date = dateError;
    if (Object.keys(local).length > 0) {
      setFields(local);
      setError("Bitte die markierten Felder prüfen.");
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});
    const { date, dateAsPhrase, datePhrase: _phrase, ...rest } = values;
    const payload = Object.fromEntries(
      Object.entries({ ...rest, ...datePayload("date", date, dateAsPhrase) })
        // Den Scan nur mitschicken, wenn er geändert wurde — ein Bild, das der
        // Benutzer nicht sehen darf, kommt hier leer an und bliebe sonst
        // versehentlich gelöscht.
        .filter(([k, v]) => k !== "id" && !(isEdit && k === "mediaId" && v === (initial?.mediaId ?? "")))
        .map(([k, v]) => [k, typeof v === "string" && v.trim() === "" && k !== "title" ? null : v]),
    );
    const res = await apiFetch<{ id: string }>(
      isEdit ? `/api/sources/${initial!.id}` : "/api/sources",
      jsonBody(isEdit ? "PATCH" : "POST", payload),
    );
    if (!res.ok) {
      setSaving(false);
      setError(res.message);
      setFields(res.fields);
      return;
    }
    router.push(`/sources/${res.data.id}?saved=1`);
    router.refresh();
  }

  const text = (key: TextKey, label: string, opts: { required?: boolean; placeholder?: string; type?: string } = {}) => {
    const id = `source-${key}`;
    const err = fields[key];
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
          autoComplete="off"
          placeholder={opts.placeholder}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : undefined}
          className={`field w-full ${err ? "field-invalid" : ""}`}
          value={values[key]}
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
    <form
      onSubmit={submit}
      noValidate
      className="card max-w-2xl space-y-5 p-5 sm:p-6"
      aria-label={isEdit ? "Quelle bearbeiten" : "Quelle anlegen"}
    >
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-2">Quelle</legend>
        {text("title", "Titel", { required: true, placeholder: "z.B. Kirchenbuch St. Marien Celle, Taufen 1850–1870" })}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="source-kind" className="field-label">
              Art
            </label>
            <select
              id="source-kind"
              className="field w-full"
              value={values.kind}
              onChange={(e) => set("kind", e.target.value as SourceKindName)}
            >
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SOURCE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <DateInput
            id="source-date"
            label="Datum der Quelle"
            value={values.date}
            error={fields.date || fields.datePhrase}
            onChange={(v) => set("date", v)}
            allowPhrase
            asPhrase={Boolean(values.dateAsPhrase)}
            onAsPhraseChange={(on) => {
              set("dateAsPhrase", on);
              setFields((f) => ({ ...f, date: "" }));
            }}
            phrase={values.datePhrase}
          />
          {text("author", "Verfasser / Herkunft", { placeholder: "z.B. Pfarrer Meyer, Oma Erna" })}
          {text("url", "Internetadresse", { type: "url", placeholder: "https://…" })}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-2">Fundort</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("repository", "Archiv / Aufbewahrungsort", { placeholder: "z.B. Kirchenbuchamt Hannover" })}
          {text("callNumber", "Signatur", { placeholder: "z.B. KB Celle 12" })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="source-notes" className="field-label">
          Abschrift und Notizen
        </label>
        <textarea
          id="source-notes"
          rows={6}
          className="field w-full"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
        {fields.notes && <span className="field-error">{fields.notes}</span>}
      </div>

      {isEdit && (
        <div>
          <label htmlFor="source-media" className="field-label">
            Scan
          </label>
          {scanCandidates.length === 0 && !values.mediaId ? (
            <p className="text-sm muted">
              Als Scan lässt sich ein Bild wählen, das bereits bei einer belegten Person oder Ehe hochgeladen ist.
            </p>
          ) : (
            <select
              id="source-media"
              className="field w-full"
              value={values.mediaId}
              onChange={(e) => set("mediaId", e.target.value)}
            >
              <option value="">kein Scan</option>
              {values.mediaId && !scanCandidates.some((c) => c.mediaId === values.mediaId) && (
                <option value={values.mediaId}>bisheriger Scan</option>
              )}
              {scanCandidates.map((c) => (
                <option key={c.mediaId} value={c.mediaId}>
                  {c.caption || "Bild ohne Beschriftung"} — {c.owner}
                </option>
              ))}
            </select>
          )}
          {fields.mediaId && <span className="field-error">{fields.mediaId}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Speichert…" : isEdit ? "Änderungen speichern" : "Quelle anlegen"}
        </button>
        <Link href={isEdit ? `/sources/${initial!.id}` : "/sources"} className="btn-secondary">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
