"use client";

import { useCallback, useId, useState } from "react";

import {
  AI_ACCESS_LABEL,
  canDeleteToken,
  effectiveLevel,
  formatDateTime,
  formatDay,
  HISTORY_PARAM,
  isHistoryToken,
  TOKEN_LEVEL_LABEL,
  TOKEN_STATUS_CLASS,
  TOKEN_STATUS_LABEL,
  type AiAccessLevel,
  type TokenRow,
} from "./ai-access-labels";

/**
 * Schalter „Verlauf anzeigen“ mit Zustand in der Adresse (`?verlauf=1`),
 * ohne Neuladen der Seite — so überlebt er Neuladen und Lesezeichen. Den
 * Anfangswert liest die Seite auf dem Server aus den searchParams.
 */
export function useHistoryToggle(initial: boolean): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(initial);
  const update = useCallback((next: boolean) => {
    setShow(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(HISTORY_PARAM, "1");
    else url.searchParams.delete(HISTORY_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return [show, update];
}

/**
 * Liste von KI-Schlüsseln: Name, erkennbarer Anfang, Stufe (und, wenn das
 * Benutzerrecht darunter liegt, die wirksame Stufe), Status und Daten.
 *
 * Aktive Schlüssel stehen immer da; widerrufene und abgelaufene (Verlauf)
 * sind ausgeblendet, bis der Schalter „Widerrufene und abgelaufene anzeigen“
 * sie einblendet — mit Zähler „N ausgeblendet“, damit nichts verschwunden
 * wirkt. Aktive lassen sich widerrufen; löschen lassen sich Verlaufseinträge
 * und noch nie benutzte Schlüssel. Die Rückfragen stellt der Aufrufer.
 */
export function ApiTokenList({
  tokens,
  userAccess,
  busy,
  onRevoke,
  onDelete,
  label,
  showHistory,
  onShowHistoryChange,
  own = false,
}: {
  /** Eigene Schlüssel (Seite „KI-Zugang“) — Hinweise in der Du-Form. */
  own?: boolean;
  /** Alle Schlüssel, aktive und Verlauf. */
  tokens: TokenRow[];
  /** Aktuelles KI-Recht des Besitzers — bestimmt die wirksame Stufe. */
  userAccess: AiAccessLevel;
  busy: boolean;
  onRevoke: (token: TokenRow) => void;
  onDelete: (token: TokenRow) => void;
  /** Zugänglicher Name der Liste. */
  label: string;
  showHistory: boolean;
  onShowHistoryChange: (show: boolean) => void;
}) {
  const toggleId = useId();
  const active = tokens.filter((t) => !isHistoryToken(t));
  const history = tokens.filter(isHistoryToken);
  const item = (t: TokenRow) => (
    <TokenItem key={t.id} t={t} userAccess={userAccess} own={own} busy={busy} onRevoke={onRevoke} onDelete={onDelete} />
  );

  return (
    <div>
      {active.length > 0 ? (
        <ul aria-label={label} className="divide-y divide-stone-200 dark:divide-stone-800" data-testid="ai-token-list">
          {active.map(item)}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm muted" data-testid="ai-token-none-active">
          Keine aktiven Schlüssel.
        </p>
      )}
      {history.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 border-t border-stone-200 px-3 py-1 dark:border-stone-800">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent-700 dark:accent-accent-300"
              checked={showHistory}
              onChange={(e) => onShowHistoryChange(e.target.checked)}
              aria-controls={showHistory ? `${toggleId}-history` : undefined}
              data-testid="ai-token-history-toggle"
            />
            Widerrufene und abgelaufene anzeigen (Verlauf)
          </label>
          <span className="text-xs muted" data-testid="ai-token-hidden-count">
            {showHistory ? `${history.length} im Verlauf` : `${history.length} ausgeblendet`}
          </span>
        </div>
      )}
      {showHistory && history.length > 0 && (
        <ul
          id={`${toggleId}-history`}
          aria-label={`Verlauf: ${label}`}
          className="divide-y divide-stone-200 border-t border-stone-200 bg-stone-50/60 dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900/30"
          data-testid="ai-token-history"
        >
          {history.map(item)}
        </ul>
      )}
    </div>
  );
}

function TokenItem({
  t,
  userAccess,
  own,
  busy,
  onRevoke,
  onDelete,
}: {
  t: TokenRow;
  userAccess: AiAccessLevel;
  own: boolean;
  busy: boolean;
  onRevoke: (token: TokenRow) => void;
  onDelete: (token: TokenRow) => void;
}) {
  const active = t.status === "ACTIVE";
  const effective = effectiveLevel(t.level, userAccess);
  const narrowed = active && effective !== t.level;
  const deletable = canDeleteToken(t);
  return (
    <li
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
      {(active || deletable) && (
        <div className="flex flex-wrap items-center gap-2 self-center">
          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRevoke(t)}
              aria-label={`Schlüssel ${t.name} widerrufen`}
              className="btn-danger btn-sm"
            >
              widerrufen
            </button>
          )}
          {deletable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(t)}
              aria-label={`Schlüssel ${t.name} löschen`}
              title={active ? "Noch nie benutzt — Löschen widerruft ihn zugleich" : "Endgültig löschen"}
              className="btn-secondary btn-sm"
              data-testid="ai-token-delete"
            >
              löschen
            </button>
          )}
        </div>
      )}
    </li>
  );
}
