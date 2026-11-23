"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { PERSON_NAME_TYPES, PERSON_NAME_TYPE_LABEL, type PersonNameTypeName } from "@/lib/events";
import { OriginChips } from "./OriginChips";
import type { OriginChipMap } from "@/lib/origin";

/** Weiterer Name, wie die Personenseite ihn übergibt (PersonNameDto). */
export type NameRow = {
  id: string;
  type: PersonNameTypeName;
  typeLabel: string;
  givenName: string | null;
  familyName: string | null;
  prefix: string | null;
  suffix: string | null;
  nickname: string | null;
  label: string | null;
  notes: string | null;
  display: string;
};

type Values = Record<"givenName" | "familyName" | "prefix" | "suffix" | "nickname" | "label" | "notes", string> & {
  type: PersonNameTypeName;
};

const EMPTY: Values = {
  type: "MARRIED",
  givenName: "",
  familyName: "",
  prefix: "",
  suffix: "",
  nickname: "",
  label: "",
  notes: "",
};

const valuesOf = (n: NameRow): Values => ({
  type: n.type,
  givenName: n.givenName ?? "",
  familyName: n.familyName ?? "",
  prefix: n.prefix ?? "",
  suffix: n.suffix ?? "",
  nickname: n.nickname ?? "",
  label: n.label ?? "",
  notes: n.notes ?? "",
});

function NameForm({
  initial,
  editing,
  busy,
  fields,
  onSave,
  onCancel,
}: {
  initial: Values;
  editing: boolean;
  busy: boolean;
  fields: Record<string, string>;
  onSave: (v: Values) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [v, setV] = useState(initial);
  const [local, setLocal] = useState<string | null>(null);
  const input = (k: Exclude<keyof Values, "type">, label: string) => (
    <div>
      <label htmlFor={`${id}-${k}`} className="field-label">
        {label}
      </label>
      <input
        id={`${id}-${k}`}
        className={`field w-full ${fields[k] ? "field-invalid" : ""}`}
        value={v[k]}
        onChange={(e) => {
          setV((p) => ({ ...p, [k]: e.target.value }));
          setLocal(null);
        }}
      />
      {fields[k] && <span className="field-error">{fields[k]}</span>}
    </div>
  );
  return (
    <form
      noValidate
      aria-label={editing ? "Namen ändern" : "Namen hinzufügen"}
      className="space-y-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700"
      data-testid="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.givenName.trim() && !v.familyName.trim() && !v.nickname.trim()) {
          setLocal("Bitte mindestens Vorname, Nachname oder Rufname angeben.");
          return;
        }
        onSave(v);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-type`} className="field-label">
            Art des Namens
          </label>
          <select
            id={`${id}-type`}
            className="field w-full"
            value={v.type}
            onChange={(e) => setV((p) => ({ ...p, type: e.target.value as PersonNameTypeName }))}
          >
            {PERSON_NAME_TYPES.map((t) => (
              <option key={t} value={t}>
                {PERSON_NAME_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {v.type === "OTHER" ? input("label", "Bezeichnung (z.B. Künstlername)") : <div className="hidden sm:block" />}
        {input("givenName", "Vorname")}
        {input("familyName", "Nachname")}
        {input("prefix", "Zusatz vorn")}
        {input("suffix", "Zusatz hinten")}
        {input("nickname", "Rufname")}
        {input("notes", "Notiz (z.B. wo belegt)")}
      </div>
      {local && <p className="field-error">{local}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Speichert…" : editing ? "Speichern" : "Namen speichern"}
        </button>
        <button type="button" disabled={busy} className="btn-secondary" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

const payload = (v: Values) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" && k !== "type" ? x.trim() || null : x]));

/**
 * Weitere Namen der Person (Ehename, Schreibvariante, „auch bekannt als“ …).
 * Lesende sehen die Liste, Bearbeiter können ergänzen, ändern und entfernen.
 * Ohne Namen und ohne Bearbeitungsrecht erscheint nichts.
 */
export function NameVariants({
  personId,
  names,
  canEdit,
  origin,
}: {
  personId: string;
  names: NameRow[];
  canEdit: boolean;
  /** Herkunft je Name als Chips (nur für Bearbeiter geladen). */
  origin?: OriginChipMap | null;
}) {
  const router = useRouter();
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  if (!canEdit && names.length === 0) return null;

  async function send(url: string, init: RequestInit, done: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setFields({});
    setNotice(null);
    const res = await apiFetch(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      setFields(res.fields);
      return false;
    }
    setNotice(done);
    router.refresh();
    return true;
  }

  return (
    <section aria-labelledby={headingId} className={`card space-y-3 ${names.length === 0 && !adding ? "px-4 py-3 sm:px-5" : "p-4 sm:p-5"}`} data-testid="person-names">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="section-title">
          Weitere Namen
          {names.length === 0 && (
            <span className="ml-2 font-sans text-sm font-normal muted">keine erfasst (z.B. Ehename, Schreibvariante)</span>
          )}
        </h2>
        {canEdit && !adding && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setAdding(true);
              setEditing(null);
              setFields({});
            }}
          >
            Namen hinzufügen
          </button>
        )}
      </div>
      {names.length === 0 ? null : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {names.map((n) => (
            <li key={n.id} className="py-2 text-sm" data-testid="name-row">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{n.display}</span>
                <span className="badge px-2 py-0 text-[11px]">{n.typeLabel}</span>
                <OriginChips keys={origin?.names[n.id]} entries={origin?.entries} />
                {n.notes && <span className="text-xs muted">· {n.notes}</span>}
                {canEdit && (
                  <span className="ml-auto flex shrink-0 gap-3">
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      aria-expanded={editing === n.id}
                      aria-label={`Namen ${n.display} ändern`}
                      onClick={() => {
                        setEditing(editing === n.id ? null : n.id);
                        setAdding(false);
                        setFields({});
                      }}
                    >
                      ändern
                    </button>
                    <button
                      type="button"
                      className="btn-link-danger"
                      disabled={busy}
                      aria-label={`Namen ${n.display} entfernen`}
                      onClick={() => {
                        if (confirm(`Namen „${n.display}“ (${n.typeLabel}) wirklich entfernen?`)) {
                          void send(`/api/names/${n.id}`, { method: "DELETE" }, "Name entfernt.");
                        }
                      }}
                    >
                      entfernen
                    </button>
                  </span>
                )}
              </div>
              {canEdit && editing === n.id && (
                <div className="mt-2">
                  <NameForm
                    initial={valuesOf(n)}
                    editing
                    busy={busy}
                    fields={fields}
                    onCancel={() => setEditing(null)}
                    onSave={async (v) => {
                      if (await send(`/api/names/${n.id}`, jsonBody("PATCH", payload(v)), "Änderung gespeichert.")) {
                        setEditing(null);
                      }
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && adding && (
        <NameForm
          initial={EMPTY}
          editing={false}
          busy={busy}
          fields={fields}
          onCancel={() => setAdding(false)}
          onSave={async (v) => {
            if (await send(`/api/persons/${personId}/names`, jsonBody("POST", payload(v)), "Name gespeichert.")) {
              setAdding(false);
            }
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
