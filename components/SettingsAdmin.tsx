"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import type { SettingSource, SettingStateDto } from "@/lib/services/settings";

/** Herkunft des wirksamen Werts in Worten. */
export const SETTING_SOURCE_LABEL: Record<SettingSource, string> = {
  app: "in der App gesetzt",
  env: "aus der Server-Konfiguration",
  none: "nicht gesetzt",
};

/**
 * Verwaltung der Einstellungen (/admin/settings): je Schlüssel des
 * Verzeichnisses (lib/settings/registry.ts) eine Karte mit wirksamem Wert
 * und Herkunft; in der App gesetzte Werte lassen sich ändern und entfernen.
 * Neue Einträge: Schlüssel aus einem Drop-down (nur noch nicht in der App
 * gesetzte), dazu der Wert. Geprüft wird auf dem Server; die Meldung
 * erscheint am Feld.
 */
export function SettingsAdmin({ settings }: { settings: SettingStateDto[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const available = settings.filter((s) => s.appValue === null);
  const [newKey, setNewKey] = useState<string>(available[0]?.key ?? "");
  const [newValue, setNewValue] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  // Gewählter Schlüssel kann nach dem Anlegen verschwinden — dann den ersten freien nehmen.
  const chosen = available.find((s) => s.key === newKey) ?? available[0] ?? null;

  async function send(url: string, init: RequestInit, success: string): Promise<{ ok: boolean; field?: string }> {
    if (busy) return { ok: false };
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(url, init);
    setBusy(false);
    if (!res.ok) {
      if (res.fields.value) return { ok: false, field: res.fields.value };
      setError(res.message);
      return { ok: false };
    }
    setNotice(success);
    router.refresh();
    return { ok: true };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setNewError(null);
    const r = await send("/api/settings", jsonBody("POST", { key: chosen.key, value: newValue }), `„${chosen.label}“ gesetzt.`);
    if (r.field) setNewError(r.field);
    if (r.ok) {
      setNewValue("");
      setNewKey("");
    }
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && <p className="alert-success">{notice}</p>}
      </div>

      <section className="space-y-3" aria-labelledby="settings-list-title">
        <h2 id="settings-list-title" className="section-title">
          Übersicht
        </h2>
        <ul className="space-y-3">
          {settings.map((s) => (
            <SettingCard key={s.key} setting={s} busy={busy} send={send} />
          ))}
        </ul>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="settings-add-title">
        <h2 id="settings-add-title" className="section-title">
          Einstellung hinzufügen
        </h2>
        {chosen ? (
          <form onSubmit={create} className="space-y-3" aria-label="Einstellung hinzufügen" noValidate>
            <div>
              <label htmlFor="setting-new-key" className="field-label">
                Einstellung
              </label>
              <select
                id="setting-new-key"
                className="field w-full sm:w-96"
                value={chosen.key}
                onChange={(e) => {
                  setNewKey(e.target.value);
                  setNewError(null);
                }}
                disabled={busy}
              >
                {available.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 max-w-3xl text-xs muted" data-testid="setting-new-description">
                {chosen.description}
              </p>
            </div>
            <div>
              <label htmlFor="setting-new-value" className="field-label">
                Wert
              </label>
              <input
                id="setting-new-value"
                type={chosen.kind === "httpUrl" ? "url" : "text"}
                inputMode={chosen.kind === "httpUrl" ? "url" : undefined}
                className={`field w-full ${newError ? "field-invalid" : ""}`}
                placeholder={chosen.placeholder ?? undefined}
                value={newValue}
                onChange={(e) => {
                  setNewValue(e.target.value);
                  setNewError(null);
                }}
                aria-invalid={newError ? true : undefined}
                aria-describedby={newError ? "setting-new-error" : undefined}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              {newError && (
                <span id="setting-new-error" className="field-error" role="alert">
                  {newError}
                </span>
              )}
            </div>
            <button className="btn-primary" disabled={busy || !newValue.trim()}>
              Anlegen
            </button>
          </form>
        ) : (
          <p className="text-sm muted" data-testid="settings-all-set">
            Alle Einstellungen sind in der App gesetzt. Ändern oder entfernen kannst du sie oben.
          </p>
        )}
      </section>
    </div>
  );
}

function SettingCard({
  setting: s,
  busy,
  send,
}: {
  setting: SettingStateDto;
  busy: boolean;
  send: (url: string, init: RequestInit, success: string) => Promise<{ ok: boolean; field?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.appValue ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const url = `/api/settings/${encodeURIComponent(s.key)}`;
  const inputId = `setting-${s.key}-value`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    const r = await send(url, jsonBody("PATCH", { value }), `„${s.label}“ geändert.`);
    if (r.field) setFieldError(r.field);
    if (r.ok) setEditing(false);
  }

  async function remove() {
    const after = s.envValue
      ? `Danach gilt wieder der Wert aus der Server-Konfiguration:\n${s.envValue}`
      : "Danach ist kein Wert gesetzt.";
    if (!confirm(`„${s.label}“ entfernen?\n\n${after}`)) return;
    await send(url, { method: "DELETE" }, `„${s.label}“ entfernt.`);
  }

  return (
    <li className="card space-y-2 p-4" data-testid={`setting-${s.key}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{s.label}</h3>
        <span className={s.source === "app" ? "badge-accent" : "badge"} data-testid="setting-source">
          {SETTING_SOURCE_LABEL[s.source]}
        </span>
      </div>
      <p className="max-w-3xl text-sm muted">{s.description}</p>

      <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="muted">Wirksamer Wert</dt>
        <dd className="min-w-0">
          {s.effective ? (
            <code className="break-all rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs dark:bg-stone-800" data-testid="setting-effective">
              {s.effective}
            </code>
          ) : (
            <span className="muted" data-testid="setting-effective">
              —
            </span>
          )}
        </dd>
        {s.envVar && (
          <>
            <dt className="muted">Server-Konfiguration</dt>
            <dd className="min-w-0 break-words">
              <code className="font-mono text-xs">{s.envVar}</code>
              {": "}
              {s.envValue ? (
                <span className="break-all" data-testid="setting-env">
                  {s.envValue}
                  {s.source === "app" && <span className="muted"> (wird vom Wert aus der App überdeckt)</span>}
                </span>
              ) : (
                <span className="muted" data-testid="setting-env">
                  nicht gesetzt
                </span>
              )}
            </dd>
          </>
        )}
      </dl>

      {s.appValue !== null &&
        (editing ? (
          <form onSubmit={save} className="space-y-2" aria-label={`${s.label} ändern`} noValidate>
            <label htmlFor={inputId} className="field-label">
              Neuer Wert
            </label>
            <input
              id={inputId}
              type={s.kind === "httpUrl" ? "url" : "text"}
              inputMode={s.kind === "httpUrl" ? "url" : undefined}
              className={`field w-full ${fieldError ? "field-invalid" : ""}`}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(null);
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${inputId}-error` : undefined}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            {fieldError && (
              <span id={`${inputId}-error`} className="field-error" role="alert">
                {fieldError}
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy || !value.trim()}>
                Speichern
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setValue(s.appValue ?? "");
                  setFieldError(null);
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setValue(s.appValue ?? "");
                setEditing(true);
              }}
              aria-label={`${s.label} ändern`}
            >
              Ändern
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()} aria-label={`${s.label} entfernen`}>
              Entfernen
            </button>
          </div>
        ))}
    </li>
  );
}
