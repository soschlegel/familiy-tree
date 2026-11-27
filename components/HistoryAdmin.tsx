"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import {
  formatHistoryYears,
  HISTORY_KIND_LABEL,
  HISTORY_KINDS,
  HISTORY_LIMITS,
  isHistoryKind,
} from "@/lib/history/events";
import type { HistoryAdminBuiltinDto, HistoryAdminCustomDto, HistoryAdminState } from "@/lib/services/history";

type Send = (url: string, init: RequestInit, success: string) => Promise<{ ok: boolean; fields?: Record<string, string> }>;

type Draft = { title: string; yearFrom: string; yearTo: string; kind: string; description: string; region: string };

const EMPTY: Draft = { title: "", yearFrom: "", yearTo: "", kind: "sonstiges", description: "", region: "" };

const draftOf = (c: HistoryAdminCustomDto): Draft => ({
  title: c.title,
  yearFrom: String(c.yearFrom),
  yearTo: c.yearTo === null ? "" : String(c.yearTo),
  kind: isHistoryKind(c.kind) ? c.kind : "sonstiges",
  description: c.description ?? "",
  region: c.region ?? "",
});

const bodyOf = (d: Draft) => ({
  title: d.title,
  yearFrom: d.yearFrom,
  yearTo: d.yearTo.trim() ? d.yearTo : null,
  kind: d.kind,
  description: d.description,
  region: d.region,
});

const kindLabel = (k: string) => (isHistoryKind(k) ? HISTORY_KIND_LABEL[k] : k);

/**
 * Verwaltung der Zeitgeschichte (/admin/history): eigene Ereignisse anlegen,
 * ändern, löschen; mitgelieferte Einträge einzeln aus- und wieder
 * einblenden. Geprüft wird auf dem Server (checkHistoryInput); Meldungen
 * erscheinen am Feld.
 */
export function HistoryAdmin({ state }: { state: HistoryAdminState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const send: Send = async (url, init, success) => {
    if (busy) return { ok: false };
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(url, init);
    setBusy(false);
    if (!res.ok) {
      if (Object.keys(res.fields).length > 0) return { ok: false, fields: res.fields };
      setError(res.message);
      return { ok: false };
    }
    setNotice(success);
    router.refresh();
    return { ok: true };
  };

  const hiddenCount = state.builtin.filter((b) => b.hidden).length;

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

      <section className="space-y-3" aria-labelledby="history-custom-title">
        <h2 id="history-custom-title" className="section-title">
          Eigene Ereignisse
        </h2>
        {state.custom.length === 0 ? (
          <p className="text-sm muted" data-testid="history-custom-empty">
            Noch keine eigenen Ereignisse. Ergänze hier zum Beispiel ein Hochwasser, einen Stadtbrand oder eine Auswanderung
            aus deiner Gegend.
          </p>
        ) : (
          <ul className="space-y-3">
            {state.custom.map((c) => (
              <CustomCard key={c.id} event={c} busy={busy} send={send} />
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="history-add-title">
        <h2 id="history-add-title" className="section-title">
          Ereignis hinzufügen
        </h2>
        <HistoryForm
          initial={EMPTY}
          busy={busy}
          submitLabel="Anlegen"
          ariaLabel="Ereignis hinzufügen"
          onSubmit={async (d) => {
            const r = await send("/api/history-events", jsonBody("POST", bodyOf(d)), `„${d.title.trim()}“ angelegt.`);
            return r;
          }}
          resetOnSuccess
        />
      </section>

      <section className="space-y-3" aria-labelledby="history-builtin-title">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="history-builtin-title" className="section-title">
            Mitgelieferte Ereignisse
          </h2>
          <span className="text-sm muted" data-testid="history-builtin-count">
            {state.builtin.length} Einträge{hiddenCount > 0 ? `, davon ${hiddenCount} ausgeblendet` : ""}
          </span>
        </div>
        <p className="max-w-3xl text-sm muted">
          Allgemein bekannte Ereignisse für den deutschsprachigen Raum und Europa, mit der App geliefert. Passt ein Eintrag
          nicht zu deiner Familie, blende ihn aus — er verschwindet dann für alle Benutzer und lässt sich jederzeit wieder
          einblenden.
        </p>
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-surface dark:divide-stone-800 dark:border-stone-800">
          {state.builtin.map((b) => (
            <BuiltinRow key={b.id} event={b} busy={busy} send={send} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function BuiltinRow({ event: b, busy, send }: { event: HistoryAdminBuiltinDto; busy: boolean; send: Send }) {
  const url = `/api/history-events/builtin/${encodeURIComponent(b.id)}`;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3 sm:flex-nowrap" data-testid={`history-builtin-${b.id}`} data-hidden={b.hidden || undefined}>
      <span className="w-24 shrink-0 pt-0.5 text-sm font-medium tabular-nums">{formatHistoryYears(b)}</span>
      <div className={`min-w-0 flex-1 ${b.hidden ? "opacity-60" : ""}`}>
        <p className="font-medium">
          {b.title}
          {b.hidden && (
            <span className="badge ml-2 align-middle" data-testid="history-builtin-hidden">
              ausgeblendet
            </span>
          )}
        </p>
        <p className="text-sm muted">
          {HISTORY_KIND_LABEL[b.kind]} · {b.description}
        </p>
      </div>
      <button
        type="button"
        className="btn-secondary shrink-0 max-sm:ml-auto"
        disabled={busy}
        aria-label={`${b.title} ${b.hidden ? "einblenden" : "ausblenden"}`}
        onClick={() =>
          void send(url, jsonBody("PATCH", { hidden: !b.hidden }), `„${b.title}“ ${b.hidden ? "wieder eingeblendet" : "ausgeblendet"}.`)
        }
      >
        {b.hidden ? "Einblenden" : "Ausblenden"}
      </button>
    </li>
  );
}

function CustomCard({ event: c, busy, send }: { event: HistoryAdminCustomDto; busy: boolean; send: Send }) {
  const [editing, setEditing] = useState(false);
  const url = `/api/history-events/${encodeURIComponent(c.id)}`;

  async function remove() {
    if (!confirm(`„${c.title}“ (${formatHistoryYears({ from: c.yearFrom, to: c.yearTo })}) löschen?`)) return;
    await send(url, { method: "DELETE" }, `„${c.title}“ gelöscht.`);
  }

  return (
    <li className="card space-y-2 p-4" data-testid="history-custom">
      {editing ? (
        <HistoryForm
          initial={draftOf(c)}
          busy={busy}
          submitLabel="Speichern"
          ariaLabel={`${c.title} ändern`}
          onSubmit={async (d) => {
            const r = await send(url, jsonBody("PATCH", bodyOf(d)), `„${d.title.trim()}“ geändert.`);
            if (r.ok) setEditing(false);
            return r;
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium tabular-nums" data-testid="history-custom-years">
              {formatHistoryYears({ from: c.yearFrom, to: c.yearTo })}
            </span>
            <h3 className="font-semibold" data-testid="history-custom-title">
              {c.title}
            </h3>
            <span className="badge">{kindLabel(c.kind)}</span>
          </div>
          {c.description && <p className="max-w-3xl text-sm">{c.description}</p>}
          {c.region && (
            <p className="text-sm muted" data-testid="history-custom-region">
              Gilt für: {c.region}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(true)} aria-label={`${c.title} ändern`}>
              Ändern
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()} aria-label={`${c.title} löschen`}>
              Löschen
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function HistoryForm({
  initial,
  busy,
  submitLabel,
  ariaLabel,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
}: {
  initial: Draft;
  busy: boolean;
  submitLabel: string;
  ariaLabel: string;
  onSubmit: (d: Draft) => Promise<{ ok: boolean; fields?: Record<string, string> }>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}) {
  const ids = useId();
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setD((prev) => ({ ...prev, [k]: e.target.value }));
    setErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const r = await onSubmit(d);
    if (r.fields) setErrors(r.fields);
    if (r.ok && resetOnSuccess) setD(EMPTY);
  }

  const field = (k: keyof Draft) => ({
    id: `${ids}-${k}`,
    value: d[k],
    onChange: set(k),
    disabled: busy,
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${ids}-${k}-error` : undefined,
  });
  const errorOf = (k: keyof Draft) =>
    errors[k] ? (
      <span id={`${ids}-${k}-error`} className="field-error" role="alert">
        {errors[k]}
      </span>
    ) : null;
  const invalid = (k: keyof Draft) => (errors[k] ? "field-invalid" : "");

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={ariaLabel} noValidate>
      <p className="max-w-3xl text-sm muted" data-testid="history-form-hint">
        Nur allgemeine Geschichte, die alle Benutzer sehen — <strong>keine Namen aus dem Stammbaum</strong>. Die App
        behauptet damit nichts über einzelne Personen.
      </p>
      <div>
        <label htmlFor={`${ids}-title`} className="field-label">
          Titel
        </label>
        <input {...field("title")} type="text" className={`field w-full ${invalid("title")}`} maxLength={HISTORY_LIMITS.title + 20} autoComplete="off" />
        {errorOf("title")}
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor={`${ids}-yearFrom`} className="field-label">
            Jahr von
          </label>
          <input {...field("yearFrom")} type="text" inputMode="numeric" className={`field w-28 tabular-nums ${invalid("yearFrom")}`} autoComplete="off" placeholder="1882" />
          {errorOf("yearFrom")}
        </div>
        <div>
          <label htmlFor={`${ids}-yearTo`} className="field-label">
            Jahr bis <span className="font-normal muted">(optional)</span>
          </label>
          <input {...field("yearTo")} type="text" inputMode="numeric" className={`field w-28 tabular-nums ${invalid("yearTo")}`} autoComplete="off" />
          {errorOf("yearTo")}
        </div>
        <div>
          <label htmlFor={`${ids}-kind`} className="field-label">
            Art
          </label>
          <select {...field("kind")} className={`field ${invalid("kind")}`}>
            {HISTORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {HISTORY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {errorOf("kind")}
        </div>
      </div>
      <div>
        <label htmlFor={`${ids}-description`} className="field-label">
          Beschreibung <span className="font-normal muted">(optional, ein Satz)</span>
        </label>
        <textarea {...field("description")} rows={2} className={`field w-full ${invalid("description")}`} />
        {errorOf("description")}
      </div>
      <div>
        <label htmlFor={`${ids}-region`} className="field-label">
          Gilt für Region/Ort <span className="font-normal muted">(optional)</span>
        </label>
        <input {...field("region")} type="text" className={`field w-full sm:w-96 ${invalid("region")}`} autoComplete="off" />
        {errorOf("region")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !d.title.trim() || !d.yearFrom.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}
