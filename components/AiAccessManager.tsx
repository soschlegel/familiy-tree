"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { ApiTokenList } from "./ApiTokenList";
import {
  AI_ACCESS_LABEL,
  countKeys,
  TOKEN_LEVEL_LABEL,
  type AiAccessLevel,
  type ApiTokenLevelName,
  type TokenRow,
} from "./ai-access-labels";

type Info = {
  aiAccess: AiAccessLevel;
  activeTokens: number;
  maxActiveTokens: number;
  defaultExpiryDays: number;
  maxExpiryDays: number;
};

type Created = { token: TokenRow; secret: string };

const LEVEL_TEXT: Record<AiAccessLevel, string> = {
  NONE:
    "Für dich ist kein KI-Zugang freigeschaltet. Ein Administrator kann ihn in der Benutzerverwaltung vergeben — auch Administratoren brauchen diese Freigabe ausdrücklich. Bis dahin funktionieren deine Schlüssel nicht.",
  READ:
    "Ein KI-Assistent darf mit deinen Schlüsseln lesen, was du in der App sehen darfst — aber nichts ändern.",
  WRITE:
    "Ein KI-Assistent darf mit deinen Schlüsseln lesen, was du sehen darfst, und in den Familien, die du bearbeiten darfst, auch Änderungen eintragen. Jede Änderung wird protokolliert.",
};

/** Adresse der eigenen Instanz — nur im Browser bekannt (kein Hydrationsunterschied). */
function useOrigin(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

export function AiAccessManager({ info, tokens }: { info: Info; tokens: TokenRow[] }) {
  const router = useRouter();
  const origin = useOrigin();
  const endpoint = `${origin}/api/mcp`;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const canWrite = info.aiAccess === "WRITE";
  const [name, setName] = useState("");
  const [level, setLevel] = useState<ApiTokenLevelName>("READ");
  const [days, setDays] = useState(String(info.defaultExpiryDays));

  // Das Geheimnis lebt nur in diesem Zustand: nicht in der Adresse, nicht im
  // Speicher des Browsers, nicht im Server-HTML. Neu laden oder wegnavigieren
  // lässt es verschwinden.
  const [created, setCreated] = useState<Created | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (created) panelRef.current?.focus();
  }, [created]);

  const atLimit = info.activeTokens >= info.maxActiveTokens;
  const left = info.maxActiveTokens - info.activeTokens;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const n = Number(days);
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = "Bitte einen Namen angeben.";
    if (!Number.isInteger(n) || n < 1 || n > info.maxExpiryDays) {
      local.expiresInDays = `Bitte eine ganze Zahl von 1 bis ${info.maxExpiryDays} angeben.`;
    }
    setFields(local);
    setError(null);
    setNotice(null);
    if (Object.keys(local).length) return;

    setBusy(true);
    const res = await apiFetch<Created>(
      "/api/ai-tokens",
      jsonBody("POST", { name: name.trim(), level, expiresInDays: n }),
    );
    setBusy(false);
    if (!res.ok) {
      setFields(res.fields);
      setError(res.message);
      return;
    }
    setCreated(res.data);
    setName("");
    setNotice(`Schlüssel „${res.data.token.name}“ angelegt.`);
    router.refresh();
  }

  async function revoke(t: TokenRow) {
    if (busy) return;
    if (
      !confirm(
        `Schlüssel „${t.name}“ (${t.prefix}…) widerrufen?\n\nEin KI-Assistent, der ihn benutzt, verliert sofort den Zugang. Das lässt sich nicht rückgängig machen.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/ai-tokens/${t.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (created?.token.id === t.id) setCreated(null);
    setNotice(`Schlüssel „${t.name}“ widerrufen.`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-2 p-4" aria-labelledby="ai-level-title" data-testid="ai-access-info">
        <h2 id="ai-level-title" className="section-title">
          Dein KI-Zugang:{" "}
          <span data-testid="ai-access-level" data-level={info.aiAccess}>
            {AI_ACCESS_LABEL[info.aiAccess]}
          </span>
        </h2>
        <p className="max-w-3xl text-sm muted">{LEVEL_TEXT[info.aiAccess]}</p>
        {info.aiAccess !== "NONE" && (
          <p className="text-sm muted" data-testid="ai-token-count">
            {countKeys(info.activeTokens)} von höchstens {info.maxActiveTokens}.
          </p>
        )}
      </section>

      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="alert-success">
            {notice}
          </p>
        )}
      </div>

      {created && (
        <section
          ref={panelRef}
          tabIndex={-1}
          aria-labelledby="ai-secret-title"
          data-testid="ai-secret-panel"
          className="card space-y-4 border-brass-300 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brass-500 dark:border-brass-700"
        >
          <div>
            <h2 id="ai-secret-title" className="section-title">
              Neuer Schlüssel „{created.token.name}“
            </h2>
            <p className="alert-warning mt-2">
              <strong className="font-semibold">Nur jetzt sichtbar.</strong> Kopiere den Schlüssel
              jetzt und bewahre ihn sicher auf (z.B. in einem Passwortmanager). Er wird nirgends
              gespeichert und lässt sich später nicht mehr anzeigen — beim Neuladen oder Verlassen
              der Seite ist er weg. Geht er verloren, widerrufe ihn und lege einen neuen an.
            </p>
          </div>

          <CopyField
            id="ai-secret"
            label="Schlüssel"
            value={created.secret}
            testId="ai-secret"
          />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Verbinden</h3>
            <CopyField id="ai-endpoint" label="Adresse der MCP-Schnittstelle" value={endpoint} />
            <CopyField
              id="ai-header"
              label="Anmeldung per HTTP-Header"
              value={`Authorization: Bearer ${created.secret}`}
            />
            <CopyField
              id="ai-claude-command"
              label="Beispiel für Claude Code"
              multiline
              value={`claude mcp add --transport http --scope user stammbaum ${endpoint} --header "Authorization: Bearer ${created.secret}"`}
            />
            <p className="text-xs muted">
              Den genauen, aktuellen Befehl für Claude Code und andere Clients siehe README
              (Abschnitt „KI-Zugang“).
            </p>
          </div>

          <button type="button" className="btn-secondary" onClick={() => setCreated(null)}>
            Fertig — Schlüssel ausblenden
          </button>
        </section>
      )}

      {info.aiAccess !== "NONE" && (
        <section className="space-y-3" aria-labelledby="ai-create-title">
          <h2 id="ai-create-title" className="section-title">
            Neuen Schlüssel anlegen
          </h2>
          {atLimit ? (
            <p className="alert-warning" data-testid="ai-token-limit">
              Du hast bereits {info.maxActiveTokens} aktive Schlüssel — mehr sind nicht möglich.
              Widerrufe zuerst einen, den du nicht mehr brauchst.
            </p>
          ) : (
            <form
              onSubmit={create}
              noValidate
              aria-label="Neuen Schlüssel anlegen"
              className="card flex flex-wrap items-start gap-3 p-3"
            >
              <div className="min-w-0 flex-1 basis-56">
                <label htmlFor="ai-token-name" className="field-label">
                  Name des Schlüssels
                </label>
                <input
                  id="ai-token-name"
                  required
                  maxLength={80}
                  placeholder="z.B. Claude Code am Laptop"
                  className={`field w-full ${fields.name ? "field-invalid" : ""}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(fields.name) || undefined}
                  aria-describedby={fields.name ? "ai-token-name-error" : undefined}
                />
                {fields.name && (
                  <span id="ai-token-name-error" className="field-error">
                    {fields.name}
                  </span>
                )}
              </div>
              <div>
                <label htmlFor="ai-token-level" className="field-label">
                  Stufe
                </label>
                <select
                  id="ai-token-level"
                  className="field"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as ApiTokenLevelName)}
                  aria-describedby="ai-token-level-hint"
                >
                  <option value="READ">{TOKEN_LEVEL_LABEL.READ}</option>
                  <option value="WRITE" disabled={!canWrite}>
                    {TOKEN_LEVEL_LABEL.WRITE}
                    {canWrite ? "" : " (nicht freigeschaltet)"}
                  </option>
                </select>
                <span id="ai-token-level-hint" className="mt-1 block text-xs muted">
                  {canWrite ? "Nur so viel wie nötig." : "Dein KI-Zugang erlaubt nur Lesen."}
                </span>
              </div>
              <div className="w-32">
                <label htmlFor="ai-token-days" className="field-label">
                  Gültig (Tage)
                </label>
                <input
                  id="ai-token-days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={info.maxExpiryDays}
                  step={1}
                  className={`field w-full ${fields.expiresInDays ? "field-invalid" : ""}`}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  aria-invalid={Boolean(fields.expiresInDays) || undefined}
                  aria-describedby={
                    fields.expiresInDays ? "ai-token-days-error" : "ai-token-days-hint"
                  }
                />
                {fields.expiresInDays ? (
                  <span id="ai-token-days-error" className="field-error">
                    {fields.expiresInDays}
                  </span>
                ) : (
                  <span id="ai-token-days-hint" className="mt-1 block text-xs muted">
                    höchstens {info.maxExpiryDays}
                  </span>
                )}
              </div>
              <button disabled={busy} className="btn-primary sm:mt-5">
                {busy ? "Legt an…" : "Schlüssel anlegen"}
              </button>
              {left <= 3 && (
                <p className="basis-full text-xs text-brass-700 dark:text-brass-300" data-testid="ai-token-limit">
                  {left === 1
                    ? "Noch 1 aktiver Schlüssel möglich."
                    : `Noch ${left} aktive Schlüssel möglich.`}{" "}
                  Höchstens {info.maxActiveTokens}; widerrufene und abgelaufene zählen nicht.
                </p>
              )}
            </form>
          )}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="ai-list-title">
        <h2 id="ai-list-title" className="section-title">
          Deine Schlüssel
        </h2>
        {tokens.length === 0 ? (
          <div className="card px-6 py-8 text-center" data-testid="ai-token-empty">
            <p className="font-serif text-lg">Noch keine Schlüssel.</p>
            <p className="mt-1 text-sm muted">
              {info.aiAccess === "NONE"
                ? "Sobald dir ein Administrator KI-Zugang gibt, kannst du hier Schlüssel anlegen."
                : "Lege oben einen Schlüssel an, um einen KI-Assistenten zu verbinden."}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <ApiTokenList
              tokens={tokens}
              userAccess={info.aiAccess}
              busy={busy}
              onRevoke={(t) => void revoke(t)}
              label="Deine Schlüssel"
              own
            />
          </div>
        )}
        <p className="text-xs muted">
          Widerrufene und abgelaufene Schlüssel bleiben zur Nachvollziehbarkeit in der Liste. Die
          wirksame Stufe eines Schlüssels ist nie höher als dein aktueller KI-Zugang.
        </p>
      </section>
    </div>
  );
}

/** Nur lesbares Feld mit Kopierknopf. */
function CopyField({
  id,
  label,
  value,
  multiline = false,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  testId?: string;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("ok");
    } catch {
      // Ohne Zwischenablage-Recht: Text markieren, damit Strg+C reicht.
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      el?.focus();
      el?.select();
      setCopied("fail");
    }
  }

  const common = {
    id,
    readOnly: true,
    value,
    spellCheck: false,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
    className: "field w-full font-mono text-xs",
    "data-testid": testId,
  };

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex flex-col items-start gap-2 sm:flex-row">
        {multiline ? <textarea {...common} rows={4} className={`${common.className} resize-y`} /> : <input {...common} />}
        <button type="button" className="btn-secondary shrink-0" onClick={() => void copy()} aria-label={`${label} kopieren`}>
          Kopieren
        </button>
      </div>
      <span aria-live="polite" className="mt-1 block min-h-4 text-xs muted">
        {copied === "ok" ? "In die Zwischenablage kopiert." : copied === "fail" ? "Kopieren nicht möglich — Text ist markiert, bitte mit Strg+C kopieren." : ""}
      </span>
    </div>
  );
}
