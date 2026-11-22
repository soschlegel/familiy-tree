"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

/** Bild an einem Ereignis, Beleg oder einer Quelle (lib/services/attached-media.ts). */
export type AttachedItem = {
  mediaId: string;
  caption: string | null;
  /** Hauptscan einer Quelle. */
  isMain?: boolean;
};

/** Geerbtes Bild (Belegbild) — nur angezeigt, mit Herkunft. */
export type InheritedItem = AttachedItem & { note: string };

/** Vorhandenes Bild, das sich hier verknüpfen lässt. */
export type MediaCandidate = { mediaId: string; label: string };

export type AttachTarget = { kind: "event" | "citation" | "source"; id: string };

const FIELD: Record<AttachTarget["kind"], string> = {
  event: "eventId",
  citation: "citationId",
  source: "sourceId",
};

/**
 * Kleine Bildleiste an einem Ereignis, Beleg oder einer Quelle: Vorschauen
 * (antippen öffnet das Bild groß in einem neuen Tab, wie in der Galerie),
 * für Bearbeiter Hochladen, Verknüpfen eines vorhandenen Bildes und
 * Entfernen. Alt-Text ist die Beschriftung des Bildes, sonst `fallbackAlt`.
 * Tippziele mindestens 44 px (Vorschau 64 px, Knöpfe min-h-11).
 */
export function AttachedMedia({
  target,
  items,
  inherited = [],
  canEdit,
  candidates = [],
  label,
  fallbackAlt,
  testId = "attached-media",
}: {
  target: AttachTarget;
  items: AttachedItem[];
  inherited?: InheritedItem[];
  canEdit: boolean;
  candidates?: MediaCandidate[];
  /** Wofür, z.B. „Taufe 1850“ — für Beschriftungen der Bedienelemente. */
  label: string;
  fallbackAlt: string;
  testId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const inputId = useId();
  const selectId = useId();

  const own = new Set(items.map((i) => i.mediaId));
  const linkable = candidates.filter((c) => !own.has(c.mediaId));
  if (items.length === 0 && inherited.length === 0 && !canEdit) return null;

  async function upload(input: HTMLInputElement) {
    const files = input.files;
    if (!files?.length || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let done = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append(FIELD[target.kind], target.id);
      const res = await apiFetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        setError(`${file.name}: ${res.message}`);
        break;
      }
      done++;
    }
    input.value = "";
    setBusy(false);
    if (done > 0) setNotice(done === 1 ? "Bild hinzugefügt." : `${done} Bilder hinzugefügt.`);
    router.refresh();
  }

  async function link() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/media/${pick}/links`, jsonBody("POST", { [FIELD[target.kind]]: target.id }));
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPick("");
    setNotice("Bild verknüpft.");
    router.refresh();
  }

  async function remove(item: AttachedItem) {
    if (busy) return;
    if (!confirm("Bild hier entfernen? Hängt es sonst nirgends, wird es gelöscht.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch<{ deleted: boolean }>(
      `/api/media/${item.mediaId}/links?${FIELD[target.kind]}=${encodeURIComponent(target.id)}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice(res.data?.deleted ? "Bild entfernt und gelöscht (es hing sonst nirgends)." : "Bild entfernt.");
    router.refresh();
  }

  const thumb = (item: AttachedItem, extra?: string) => (
    <a
      href={`/api/media/${item.mediaId}`}
      target="_blank"
      rel="noreferrer"
      className="block h-16 w-16 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700"
      aria-label={`${item.caption ?? fallbackAlt} in voller Größe öffnen`}
      title={extra ? `${item.caption ?? fallbackAlt} — ${extra}` : (item.caption ?? fallbackAlt)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/media/${item.mediaId}?variant=thumb`}
        alt={item.caption ?? fallbackAlt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    </a>
  );

  return (
    <div className="mt-2 space-y-1.5" data-testid={testId} data-target={`${target.kind}:${target.id}`}>
      {(items.length > 0 || inherited.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label={`Bilder zu ${label}`}>
          {items.map((item) => (
            <li key={item.mediaId} className="flex flex-col items-start gap-1" data-testid="attached-image">
              {thumb(item)}
              {item.isMain && <span className="text-[10px] font-semibold text-brass-700 dark:text-brass-300">Hauptscan</span>}
              {canEdit && (
                <button
                  type="button"
                  className="btn-link-danger min-h-11 md:min-h-0"
                  disabled={busy}
                  onClick={() => void remove(item)}
                  aria-label={`Bild ${item.caption ?? ""} von ${label} entfernen`.replace(/\s+/g, " ")}
                >
                  entfernen
                </button>
              )}
            </li>
          ))}
          {inherited.map((item) => (
            <li key={`i-${item.mediaId}`} className="flex flex-col items-start gap-1" data-testid="inherited-image">
              {thumb(item, item.note)}
              <span className="max-w-[4rem] truncate text-[10px] muted" title={item.note}>
                {item.note}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-accent-700 max-md:py-3 max-md:text-sm dark:text-accent-300">
            Bild hinzufügen<span className="sr-only"> zu {label}</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              id={inputId}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => void upload(e.currentTarget)}
            />
            <label htmlFor={inputId} className={`btn-secondary btn-sm cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
              {busy ? "Lädt…" : "Datei hochladen"}
            </label>
            {linkable.length > 0 && (
              <>
                <span className="flex flex-col">
                  <label htmlFor={selectId} className="field-label">
                    Vorhandenes Bild
                  </label>
                  <select id={selectId} className="field max-w-[16rem]" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
                    <option value="">— wählen —</option>
                    {linkable.map((c) => (
                      <option key={c.mediaId} value={c.mediaId}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </span>
                <button type="button" className="btn-secondary btn-sm" disabled={!pick || busy} onClick={() => void link()}>
                  Verknüpfen
                </button>
              </>
            )}
          </div>
        </details>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="alert-error text-xs">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
      </div>
    </div>
  );
}
