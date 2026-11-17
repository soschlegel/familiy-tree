"use client";

import {
  AI_ACCESS_LABEL,
  effectiveLevel,
  formatDateTime,
  formatDay,
  TOKEN_LEVEL_LABEL,
  TOKEN_STATUS_CLASS,
  TOKEN_STATUS_LABEL,
  type AiAccessLevel,
  type TokenRow,
} from "./ai-access-labels";

/**
 * Liste von KI-Schlüsseln: Name, erkennbarer Anfang, Stufe (und, wenn das
 * Benutzerrecht darunter liegt, die wirksame Stufe), Status und Daten.
 * Aktive Schlüssel lassen sich widerrufen — die Bestätigung fragt der
 * Aufrufer ab.
 */
export function ApiTokenList({
  tokens,
  userAccess,
  busy,
  onRevoke,
  label,
  own = false,
}: {
  /** Eigene Schlüssel (Seite „KI-Zugang“) — Hinweise in der Du-Form. */
  own?: boolean;
  tokens: TokenRow[];
  /** Aktuelles KI-Recht des Besitzers — bestimmt die wirksame Stufe. */
  userAccess: AiAccessLevel;
  busy: boolean;
  onRevoke: (token: TokenRow) => void;
  /** Zugänglicher Name der Liste. */
  label: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-stone-200 dark:divide-stone-800" data-testid="ai-token-list">
      {tokens.map((t) => {
        const active = t.status === "ACTIVE";
        const effective = effectiveLevel(t.level, userAccess);
        const narrowed = active && effective !== t.level;
        return (
          <li
            key={t.id}
            data-testid="ai-token"
            data-token-id={t.id}
            data-status={t.status}
            className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3 text-sm"
          >
            <div className="min-w-0 flex-1 basis-60 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium break-words">{t.name}</span>
                <span className={TOKEN_STATUS_CLASS[t.status]} data-testid="ai-token-status">
                  {TOKEN_STATUS_LABEL[t.status]}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code
                  className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200"
                  data-testid="ai-token-prefix"
                  title="Anfang des Schlüssels — zum Wiedererkennen"
                >
                  {t.prefix}…
                </code>
                <span className="text-xs muted" data-testid="ai-token-level">
                  Stufe: {TOKEN_LEVEL_LABEL[t.level]}
                </span>
              </p>
              {narrowed && (
                <p className="text-xs text-brass-700 dark:text-brass-300" data-testid="ai-token-effective">
                  {effective === "NONE"
                    ? `Wirkt derzeit nicht — ${own ? "du hast" : "der Benutzer hat"} keinen KI-Zugang.`
                    : `Wirkt derzeit nur: ${AI_ACCESS_LABEL[effective]} (${own ? "dein" : "sein"} KI-Zugang ist niedriger).`}
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs muted sm:flex sm:flex-wrap sm:gap-x-4">
                <div className="contents sm:flex sm:gap-1">
                  <dt>angelegt</dt>
                  <dd>{formatDay(t.createdAt)}</dd>
                </div>
                <div className="contents sm:flex sm:gap-1">
                  <dt>zuletzt benutzt</dt>
                  <dd>{formatDateTime(t.lastUsedAt)}</dd>
                </div>
                {t.revokedAt ? (
                  <div className="contents sm:flex sm:gap-1">
                    <dt>widerrufen</dt>
                    <dd>{formatDay(t.revokedAt)}</dd>
                  </div>
                ) : (
                  <div className="contents sm:flex sm:gap-1">
                    <dt>{t.status === "EXPIRED" ? "abgelaufen" : "läuft ab"}</dt>
                    <dd>{t.expiresAt ? formatDay(t.expiresAt) : "nie"}</dd>
                  </div>
                )}
              </dl>
            </div>
            {active && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRevoke(t)}
                aria-label={`Schlüssel ${t.name} widerrufen`}
                className="btn-danger btn-sm self-center"
              >
                widerrufen
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
