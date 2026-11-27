"use client";

import { useId, useState } from "react";

import { apiFetch } from "./api-client";
import { HelpLink } from "./HelpLink";
import { compactAreas, expandAreaInput, GROUP_PREFIX, HISTORY_AREA_GROUPS, historyAreaGroup } from "@/lib/history/areas";

export type AreaCatalog = { countries: { key: string; name: string }[]; labels: Record<string, string> };

/** Häufig gebrauchte Länder stehen in der Auswahl oben. */
const COMMON = ["DE", "AT", "CH", "PL", "CZ", "FR", "NL", "IT", "US"];

type Legend = { country?: { key: string; name: string; regions: { key: string; name: string }[] } };

/**
 * Auswahl des Geltungsbereichs eines eigenen Ereignisses der Zeitgeschichte
 * (Verwaltung /admin/history) — bedienbar ohne Kenntnis von Schlüsseln:
 * „Überall“ oder „Bestimmte Gebiete“; dann ein Land wählen und optional eine
 * Region daraus (die Regionen lädt GET /api/history-events/areas?country=…),
 * dazu benannte Gruppen (Ostdeutschland, Habsburgermonarchie …) als
 * Schnellwahl. Gespeichert werden die einzelnen Schlüssel; angezeigt werden
 * vollständige Gruppen zusammengefasst (lib/history/areas.ts, compactAreas).
 */
export function HistoryAreaPicker({
  value,
  onChange,
  catalog,
  disabled,
  error,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  catalog: AreaCatalog;
  disabled?: boolean;
  error?: string;
}) {
  const ids = useId();
  const [some, setSome] = useState(value.length > 0);
  const [labels, setLabels] = useState<Record<string, string>>(catalog.labels);
  const [country, setCountry] = useState("");
  const [regions, setRegions] = useState<{ key: string; name: string }[] | null>(null);
  const [region, setRegion] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const countryName = (cc: string) => catalog.countries.find((c) => c.key === cc)?.name ?? cc;
  const labelOf = (key: string) => {
    if (key.startsWith(GROUP_PREFIX)) return historyAreaGroup(key)?.label ?? key;
    return labels[key] ?? (key.includes(".") ? key : countryName(key));
  };
  const add = (keys: string[]) => onChange(expandAreaInput([...value, ...keys]).keys);
  const remove = (chip: string) => {
    const drop = new Set(expandAreaInput([chip]).keys);
    onChange(value.filter((k) => !drop.has(k)));
  };

  async function chooseCountry(cc: string) {
    setCountry(cc);
    setRegion("");
    setRegions(null);
    setLoadError(null);
    if (!cc) return;
    const res = await apiFetch<Legend>(`/api/history-events/areas?country=${encodeURIComponent(cc)}`);
    if (!res.ok) {
      setLoadError(res.message);
      return;
    }
    const list = res.data.country?.regions ?? [];
    setRegions(list);
    setLabels((prev) => {
      const next = { ...prev };
      for (const r of list) next[r.key] = `${r.name} (${countryName(cc)})`;
      return next;
    });
  }

  const chips = compactAreas(value);
  const common = catalog.countries.filter((c) => COMMON.includes(c.key)).sort((a, b) => COMMON.indexOf(a.key) - COMMON.indexOf(b.key));

  return (
    <fieldset className="space-y-2" data-testid="history-areas" aria-describedby={error ? `${ids}-error` : undefined}>
      <legend className="field-label">Geltungsbereich</legend>
      <p className="max-w-3xl text-xs muted">
        Wo gilt das Ereignis? Bei Personen, die zur Zeit des Ereignisses dort lebten, steht es vorn; bei anderen weiter
        hinten. Gebiete nach heutigen Grenzen — eine bewusste Vereinfachung.{" "}
        <HelpLink to="zeitgeschichteGebiete" compact label="Wie funktioniert der Geltungsbereich?" className="align-middle" />
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <label className="flex cursor-pointer items-center gap-2 text-sm max-md:min-h-11">
          <input
            type="radio"
            name={`${ids}-mode`}
            checked={!some}
            disabled={disabled}
            onChange={() => {
              setSome(false);
              onChange([]);
            }}
            data-testid="history-areas-everywhere"
          />
          Überall (kein regionaler Bezug)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm max-md:min-h-11">
          <input type="radio" name={`${ids}-mode`} checked={some} disabled={disabled} onChange={() => setSome(true)} data-testid="history-areas-some" />
          Bestimmte Gebiete
        </label>
      </div>
      {some && (
        <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
          {chips.length === 0 ? (
            <p className="text-sm muted" data-testid="history-areas-empty">
              Noch kein Gebiet gewählt — ohne Gebiet gilt das Ereignis überall.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Gewählte Gebiete">
              {chips.map((chip) => (
                <li key={chip} className="badge-accent gap-0 whitespace-normal py-0 pl-2.5 pr-0" data-testid="history-areas-chip">
                  <span>{labelOf(chip)}</span>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-base leading-none hover:bg-accent-100 disabled:opacity-50 dark:hover:bg-accent-800 max-md:h-11 max-md:w-11"
                    disabled={disabled}
                    onClick={() => remove(chip)}
                    aria-label={`${labelOf(chip)} entfernen`}
                  >
                    <span aria-hidden>×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${ids}-country`} className="field-label">
                Land
              </label>
              <select
                id={`${ids}-country`}
                className="field w-56 max-w-full"
                value={country}
                disabled={disabled}
                onChange={(e) => void chooseCountry(e.target.value)}
                data-testid="history-areas-country"
              >
                <option value="">Land wählen …</option>
                <optgroup label="Häufig">
                  {common.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Alle Länder">
                  {catalog.countries.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-region`} className="field-label">
                Region <span className="font-normal muted">(optional)</span>
              </label>
              <select
                id={`${ids}-region`}
                className="field w-64 max-w-full"
                value={region}
                disabled={disabled || !country || regions === null}
                onChange={(e) => setRegion(e.target.value)}
                data-testid="history-areas-region"
              >
                <option value="">{country ? "Ganzes Land" : "erst ein Land wählen"}</option>
                {(regions ?? []).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled || !country}
              onClick={() => {
                add([region || country]);
                setRegion("");
              }}
              data-testid="history-areas-add"
            >
              Hinzufügen
            </button>
          </div>
          {loadError && (
            <p role="alert" className="field-error">
              {loadError}
            </p>
          )}
          <div className="space-y-1">
            <p className="field-label">Schnellwahl (historische Gebiete)</p>
            <div className="flex flex-wrap gap-2">
              {HISTORY_AREA_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="btn-secondary btn-sm whitespace-normal text-left"
                  disabled={disabled}
                  title={g.note}
                  onClick={() => add([`${GROUP_PREFIX}${g.id}`])}
                  data-testid={`history-areas-group-${g.id}`}
                >
                  + {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {error && (
        <span id={`${ids}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}
