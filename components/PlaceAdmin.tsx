"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import type { GazetteerHitDto, PlaceRowDto } from "@/lib/services/places";
import { apiFetch, jsonBody } from "./api-client";

const STATUS_LABEL: Record<PlaceRowDto["status"], string> = {
  open: "offen",
  auto: "automatisch",
  ai: "von KI",
  manual: "bestätigt",
  unresolvable: "nicht zuordenbar",
};
const PRECISION_LABEL = { PLACE: "Ort", REGION: "Region", COUNTRY: "Land" } as const;

const coords = (lat: number | null, lon: number | null) =>
  lat === null || lon === null ? "" : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

/** Knopf „Automatisch zuordnen“ — für alle Ortstexte, die weder von Hand bestätigt noch von der KI gesetzt sind. */
export function PlaceAutoAssign({ open }: { open: number }) {
  const router = useRouter();
  const [working, setBusy] = useState(false);
  // Bis die Seite neu geladen ist, bleibt der Knopf gesperrt — sonst
  // überholt eine spätere Aktion die noch laufende Aktualisierung.
  const [refreshing, startRefresh] = useTransition();
  const busy = working || refreshing;
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        data-testid="places-auto"
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const res = await apiFetch<{ created: number; updated: number; removed: number; unmatched: number; manual: number; ai: number }>(
            "/api/places/auto",
            { method: "POST" },
          );
          setBusy(false);
          if (!res.ok) return setMessage(res.message);
          const r = res.data;
          setMessage(
            `${r.created} neu, ${r.updated} geändert, ${r.removed} entfernt; ${r.unmatched} ohne Treffer, ${r.manual} von Hand bestätigt und ${r.ai} von KI (unverändert).`,
          );
          startRefresh(() => router.refresh());
        }}
      >
        {busy ? "Ordne zu …" : "Automatisch zuordnen"}
      </button>
      <span className="text-xs muted">{open} offen</span>
      {message && (
        <p role="status" className="w-full text-xs" data-testid="places-auto-result">
          {message}
        </p>
      )}
    </div>
  );
}

export function PlaceTable({ rows }: { rows: PlaceRowDto[] }) {
  if (rows.length === 0) return <p className="card p-4 text-sm muted">Keine Ortstexte für diese Auswahl.</p>;
  return (
    <ul className="space-y-2" data-testid="places-list">
      {rows.map((r) => (
        <PlaceRow key={r.key} row={r} />
      ))}
    </ul>
  );
}

function PlaceRow({ row }: { row: PlaceRowDto }) {
  const router = useRouter();
  const [working, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = working || refreshing;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const a = row.assignment;
  const s = row.suggestion;

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/places", jsonBody("PUT", { text: row.text, ...body }));
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setEditing(false);
    startRefresh(() => router.refresh());
  };

  const sameAsSuggestion = a && s && a.gazetteerId === s.gazetteerId && !a.unresolvable;

  return (
    <li className="card space-y-2 p-3 text-sm" data-testid="place-row" data-key={row.key} data-status={row.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words font-medium">
          {row.text}
          {row.variants > 1 && <span className="muted"> (+{row.variants - 1} Schreibweisen)</span>}
        </p>
        <p className="flex items-center gap-2">
          <span className="muted">{row.count}×</span>
          <span
            className={row.status === "manual" ? "badge-accent" : row.status === "ai" ? "badge-alt" : "badge"}
            data-testid="place-status"
            title={row.status === "ai" ? "Vom KI-Assistenten gesetzt — gilt sofort für die Karte; bitte bestätigen oder ändern." : undefined}
          >
            {STATUS_LABEL[row.status]}
          </span>
          {a?.uncertain && (
            <span className="badge-alt" data-testid="place-uncertain" title="Als unsicher gesetzt — bitte prüfen.">
              unsicher
            </span>
          )}
        </p>
      </div>

      {a && !a.unresolvable && (
        <p data-testid="place-assignment">
          <span className="muted">Zugeordnet: </span>
          {a.label}
          <span className="muted">
            {" "}
            · {a.precision ? PRECISION_LABEL[a.precision] : "?"} · {coords(a.latitude, a.longitude)}
          </span>
        </p>
      )}
      {a?.unresolvable && row.status === "ai" && <p data-testid="place-assignment">Von der KI als nicht zuordenbar markiert.</p>}
      {a?.note && (
        <p className="text-xs" data-testid="place-note">
          <span className="muted">{a.source === "AI" ? "Begründung der KI: " : "Notiz: "}</span>
          {a.note}
        </p>
      )}
      {s && !sameAsSuggestion && (
        <p data-testid="place-suggestion">
          <span className="muted">Vorschlag: </span>
          {s.label}
          <span className="muted">
            {" "}
            · {PRECISION_LABEL[s.precision]} · {coords(s.latitude, s.longitude)}
            {s.matchedPart !== row.text && <> · über „{s.matchedPart}“</>}
          </span>
          {s.ambiguous > 0 && (
            <span className="badge-alt ml-1" title="Es gibt weitere, weit entfernte Orte gleichen Namens.">
              mehrdeutig: {s.ambiguous} weitere
            </span>
          )}
        </p>
      )}
      {sameAsSuggestion && s.ambiguous > 0 && (
        <p className="text-xs">
          <span className="badge-alt">mehrdeutig: {s.ambiguous} weitere gleichen Namens</span> — bitte prüfen.
        </p>
      )}
      {!a && !s && <p className="muted">Kein Treffer im Ortsverzeichnis.</p>}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {((row.status === "auto" && sameAsSuggestion) || row.status === "ai") && (
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            data-testid="place-confirm"
            onClick={() => send({ action: "confirm" })}
          >
            Bestätigen
          </button>
        )}
        {s && !sameAsSuggestion && row.status !== "manual" && (
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            onClick={() => send({ action: "directory", gazetteerId: s.gazetteerId })}
          >
            Vorschlag übernehmen
          </button>
        )}
        <button type="button" className="btn-link" disabled={busy} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Schließen" : "Anderen Ort wählen …"}
        </button>
        {row.status !== "unresolvable" && (
          <button type="button" className="btn-link" disabled={busy} onClick={() => send({ action: "unresolvable" })}>
            Nicht zuordenbar
          </button>
        )}
        {(row.status === "manual" || row.status === "unresolvable" || row.status === "ai") && (
          <button type="button" className="btn-link-danger" disabled={busy} onClick={() => send({ action: "reset" })}>
            Zurücksetzen
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {editing && <PlaceEditor text={row.text} busy={busy} onPick={send} />}
    </li>
  );
}

function PlaceEditor({
  text,
  busy,
  onPick,
}: {
  text: string;
  busy: boolean;
  onPick: (body: Record<string, unknown>) => void;
}) {
  const ids = useId();
  const [q, setQ] = useState(() => text.split(",")[0].replace(/\([^)]*\)/g, "").trim());
  const [hits, setHits] = useState<GazetteerHitDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [precision, setPrecision] = useState<"PLACE" | "REGION" | "COUNTRY">("PLACE");
  const [label, setLabel] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal });
        if (res.ok) setHits(await res.json());
      } catch {
        /* abgebrochen */
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const parse = (v: string) => Number(v.replace(",", "."));

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700" data-testid="place-editor">
      <div>
        <label htmlFor={`${ids}-q`} className="field-label">
          Im Ortsverzeichnis suchen (auch alte Namen, z.B. „Breslau“)
        </label>
        <input id={`${ids}-q`} className="field w-full" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <ul className="mt-1 max-h-64 space-y-0.5 overflow-auto" aria-busy={searching} data-testid="place-search-results">
          {hits.map((h) => (
            <li key={h.gazetteerId}>
              <button
                type="button"
                disabled={busy}
                className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-stone-900/5 dark:hover:bg-white/10 max-md:py-2.5"
                onClick={() => onPick({ action: "directory", gazetteerId: h.gazetteerId })}
              >
                <span className="font-medium">{h.label}</span>
                <span className="muted">
                  {" "}
                  · {PRECISION_LABEL[h.precision]}
                  {h.population > 0 && <> · {h.population.toLocaleString("de-DE")} Einw.</>} · {coords(h.latitude, h.longitude)}
                </span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && !searching && hits.length === 0 && <li className="px-2 py-1 muted">Nichts gefunden.</li>}
        </ul>
      </div>
      <fieldset className="space-y-2">
        <legend className="field-label">Oder Koordinaten eingeben</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <label htmlFor={`${ids}-lat`} className="field-label">
              Breite (−90 bis 90)
            </label>
            <input id={`${ids}-lat`} className="field w-full" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${ids}-lon`} className="field-label">
              Länge (−180 bis 180)
            </label>
            <input id={`${ids}-lon`} className="field w-full" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${ids}-prec`} className="field-label">
              Genauigkeit
            </label>
            <select
              id={`${ids}-prec`}
              className="field w-full"
              value={precision}
              onChange={(e) => setPrecision(e.target.value as typeof precision)}
            >
              <option value="PLACE">Ort</option>
              <option value="REGION">Region</option>
              <option value="COUNTRY">Land</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${ids}-label`} className="field-label">
              Bezeichnung (optional)
            </label>
            <input id={`${ids}-label`} className="field w-full" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => {
            const la = parse(lat);
            const lo = parse(lon);
            if (!lat.trim() || !lon.trim() || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
              setCoordError("Bitte Breite (−90 bis 90) und Länge (−180 bis 180) als Zahl angeben, z.B. 51,11 und 17,03.");
              return;
            }
            setCoordError(null);
            onPick({ action: "coordinates", latitude: la, longitude: lo, precision, label: label.trim() || null });
          }}
        >
          Koordinaten speichern
        </button>
        {coordError && (
          <p role="alert" className="field-error">
            {coordError}
          </p>
        )}
      </fieldset>
    </div>
  );
}
