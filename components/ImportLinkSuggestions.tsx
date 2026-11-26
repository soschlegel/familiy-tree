"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "./api-client";
import { HelpLink } from "./HelpLink";
import { plural } from "@/lib/plural";

/**
 * Import-Vorschau, Abschnitt „Zusammenhang mit vorhandenen Daten“: Personen
 * der Datei, die schon vorhandenen Personen ähneln (von Hand erfasst oder aus
 * anderen Importen; Abgleich wie „Importe verbinden“). Je Person die Wahl
 * „Neu anlegen“ (Standard, auch bei „sicher“) oder „Mit vorhandener Person
 * verknüpfen“. Gruppen nach Klasse, „sicher“ zuerst und offen, der Rest
 * eingeklappt; Einträge seitenweise. Der Sammelknopf wählt nur „sichere“ —
 * jede Wahl bleibt danach einzeln sichtbar und abwählbar.
 */

export type SuggestionClass = "high" | "veryLikely" | "medium" | "low";

export type LinkSuggestion = {
  personId: string;
  label: string;
  origin: string;
  cls: SuggestionClass;
  score: number;
  sentence: string;
  conflicts: string[];
  differences: string[];
  viaRelative: boolean;
  onlyBridge: boolean;
};

export type LinkSummary = {
  persons: Record<SuggestionClass, number>;
  compared: { file: number; existing: number };
  durationMs: number;
  skipped?: string;
};

export type LinkIssue = { ref: string; personId: string; file: string; existing: string; reason: string };

type Item = { ref: string; label: string; suggestions?: LinkSuggestion[] };

export const CLASSES: SuggestionClass[] = ["high", "veryLikely", "medium", "low"];

export const CLASS_INFO: Record<SuggestionClass, { label: string; help: string; badge: string }> = {
  high: {
    label: "sicher",
    help: "Gleicher ganzer Name, gleiche tagesgenaue Lebensdaten bzw. dieselben Verwandten, kein Widerspruch.",
    badge: "badge-accent",
  },
  veryLikely: {
    label: "sehr wahrscheinlich",
    help: "Zwei passende Verwandte, oder gleiches tagesgenaues Geburtsdatum plus ein passender Verwandter.",
    badge: "badge",
  },
  medium: {
    label: "wahrscheinlich",
    help: "Name und vereinbare Daten plus ein weiterer Hinweis — bitte ansehen.",
    badge: "badge",
  },
  low: {
    label: "unklar",
    help: "Nur Name und ungefähres Jahr, ein Widerspruch oder mehrere ähnlich gute Kandidaten — meist verschiedene Menschen.",
    badge: "badge-alt",
  },
};

export function ImportLinkSuggestions(props: {
  batchId: string;
  links: LinkSummary;
  choices: Record<string, string>;
  setChoices: (f: (o: Record<string, string>) => Record<string, string>) => void;
  issues: LinkIssue[] | null;
  disabled: boolean;
}) {
  const { links, choices } = props;
  const total = CLASSES.reduce((n, c) => n + links.persons[c], 0);
  const chosen = Object.keys(choices).length;
  if (links.compared.file === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-accent-300 p-3 dark:border-accent-700" aria-labelledby="gedcom-links-title" data-testid="gedcom-links">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="gedcom-links-title" className="font-medium">
          {links.skipped
            ? "Zusammenhang mit vorhandenen Daten: nicht geprüft"
            : total === 0
              ? "Dieser Import hängt mit keiner vorhandenen Person zusammen"
              : `Dieser Import hängt über ${plural(total, "Person", "Personen")} mit vorhandenen Daten zusammen`}
        </h3>
        <HelpLink to="importVorschlaege" />
      </div>
      {links.skipped ? (
        <p role="status" className="alert-warning text-sm">
          {links.skipped}
        </p>
      ) : total === 0 ? (
        <p className="text-sm muted">
          Verglichen mit {plural(links.compared.existing, "vorhandenen Person", "vorhandenen Personen")}: keine ist einer neuen Person dieser
          Datei ähnlich genug. Alle neuen Personen werden neu angelegt.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="gedcom-links-counts">
            {CLASSES.filter((c) => links.persons[c] > 0).map((c) => (
              <li key={c}>
                <span className={CLASS_INFO[c].badge}>{CLASS_INFO[c].label}</span> {links.persons[c]}
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Standard ist immer <strong className="font-medium">„Neu anlegen“</strong> — auch bei „sicher“. Verknüpft wird nur, was du einzeln
            auswählst. Verknüpfen heißt: Die vorhandene Person bleibt, wie sie ist, und wird nur ergänzt — Leeres wird gefüllt, abweichende
            Angaben kommen als Zweitangabe dazu, Ereignisse und Namen aus der Datei hängen an ihr.
          </p>
          <p role="status" className="text-sm" data-testid="gedcom-links-chosen">
            {chosen === 0 ? "Noch keine Verknüpfung ausgewählt." : `${plural(chosen, "Verknüpfung", "Verknüpfungen")} ausgewählt.`}
            {chosen > 0 && (
              <button type="button" className="btn-link btn-sm ml-2 max-md:min-h-11" disabled={props.disabled} onClick={() => props.setChoices(() => ({}))}>
                Alle Auswahlen aufheben
              </button>
            )}
          </p>
          {props.issues && props.issues.length > 0 && (
            <div role="alert" className="alert-error text-sm" data-testid="gedcom-link-issues">
              <p className="font-medium">
                {props.issues.length === 1 ? "Eine Verknüpfung" : `${props.issues.length} Verknüpfungen`} ließen sich nicht ausführen — es wurde
                nichts importiert. Die Auswahl ist zurückgesetzt; bitte neu entscheiden (oder die Vorschau neu laden).
              </p>
              <ul className="mt-1 list-disc pl-5">
                {props.issues.map((i) => (
                  <li key={`${i.ref}-${i.personId}`}>
                    {i.file} ↔ {i.existing}: {i.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            {CLASSES.filter((c) => links.persons[c] > 0).map((c) => (
              <ClassGroup key={`${props.batchId}-${c}`} cls={c} count={links.persons[c]} {...props} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ClassGroup(props: {
  batchId: string;
  cls: SuggestionClass;
  count: number;
  choices: Record<string, string>;
  setChoices: (f: (o: Record<string, string>) => Record<string, string>) => void;
  disabled: boolean;
}) {
  const { cls, choices, setChoices } = props;
  const [open, setOpen] = useState(cls === "high");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [bulk, setBulk] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const params = new URLSearchParams({ kind: "persons", group: "new", suggest: cls, offset: String(offset), limit: String(limit) });
      return apiFetch<{ total: number; items: Item[] }>(`/api/import/gedcom/${props.batchId}/items?${params}`);
    },
    [cls, props.batchId],
  );

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      const res = await fetchPage(offset, 50);
      setLoading(false);
      if (!res.ok) return;
      setTotal(res.data.total);
      setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
    },
    [fetchPage],
  );

  useEffect(() => {
    if (open) void load(0);
  }, [open, load]);

  /** Nur „sichere“: je Person ihr sicherer Vorschlag, keine vorhandene Person doppelt. */
  async function chooseAllSure() {
    setBulk("Sichere Vorschläge werden geladen …");
    const all: Item[] = [];
    for (let offset = 0; ; offset += 500) {
      const res = await fetchPage(offset, 500);
      if (!res.ok) {
        setBulk(null);
        return;
      }
      all.push(...res.data.items);
      if (all.length >= res.data.total || res.data.items.length === 0) break;
    }
    setChoices((o) => {
      const next = { ...o };
      const used = new Set(Object.values(next));
      for (const i of all) {
        const s = i.suggestions?.[0];
        if (!s || s.cls !== "high" || next[i.ref] || used.has(s.personId)) continue;
        next[i.ref] = s.personId;
        used.add(s.personId);
      }
      return next;
    });
    setBulk(null);
    setOpen(true);
  }

  const chosenHere = items.filter((i) => choices[i.ref]).length;

  return (
    <details
      className="rounded-lg border border-stone-200 dark:border-stone-700"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      data-testid={`gedcom-links-${cls}`}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm max-md:min-h-11">
        <span className={CLASS_INFO[cls].badge}>{CLASS_INFO[cls].label}</span>{" "}
        <span className="font-medium">{plural(props.count, "Person", "Personen")}</span>
        <span className="block text-xs muted">{CLASS_INFO[cls].help}</span>
      </summary>
      {open && (
        <div className="space-y-2 border-t border-stone-200 px-3 py-2 dark:border-stone-700">
          {cls === "high" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className="btn-secondary btn-sm max-md:min-h-11" disabled={props.disabled || Boolean(bulk)} onClick={() => void chooseAllSure()} data-testid="gedcom-links-choose-sure">
                Alle sicheren auswählen ({props.count})
              </button>
              <span className="text-xs muted">Wählt nur die Klasse „sicher“; jede Wahl bleibt unten einzeln sichtbar und abwählbar.</span>
              {bulk && (
                <span role="status" className="text-xs muted">
                  {bulk}
                </span>
              )}
            </div>
          )}
          {items.length > 0 && chosenHere > 0 && <p className="text-xs muted">Davon angezeigt und ausgewählt: {chosenHere}</p>}
          <ul className="space-y-2">
            {items.map((i) => (
              <SuggestionRow key={i.ref} item={i} choices={choices} setChoices={setChoices} disabled={props.disabled} />
            ))}
          </ul>
          {loading && <p className="text-xs muted">Lädt …</p>}
          {!loading && items.length < total && (
            <button type="button" className="btn-secondary btn-sm max-md:min-h-11" onClick={() => void load(items.length)}>
              Weitere laden ({total - items.length} übrig)
            </button>
          )}
        </div>
      )}
    </details>
  );
}

function SuggestionRow({
  item: i,
  choices,
  setChoices,
  disabled,
}: {
  item: Item;
  choices: Record<string, string>;
  setChoices: (f: (o: Record<string, string>) => Record<string, string>) => void;
  disabled: boolean;
}) {
  const current = choices[i.ref] ?? "";
  const usedBy = (personId: string) => Object.entries(choices).find(([ref, id]) => id === personId && ref !== i.ref);
  const name = `link-${i.ref}`;
  const set = (personId: string) =>
    setChoices((o) => {
      const n = { ...o };
      if (personId) n[i.ref] = personId;
      else delete n[i.ref];
      return n;
    });
  return (
    <li className="rounded-lg border border-stone-100 p-2 text-sm dark:border-stone-800" data-testid="gedcom-link-row">
      <fieldset>
        <legend className="font-medium break-words">
          Aus der Datei: {i.label}
          {current && <span className="badge-accent ml-2">wird verknüpft</span>}
        </legend>
        <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-stone-50 dark:hover:bg-stone-800">
          <input type="radio" name={name} value="" checked={!current} disabled={disabled} onChange={() => set("")} />
          <span>Neu anlegen</span>
        </label>
        {(i.suggestions ?? []).map((s) => {
          const taken = usedBy(s.personId);
          return (
            <label
              key={s.personId}
              className={`flex min-h-11 items-start gap-2 rounded-md px-2 py-2 ${taken ? "opacity-70" : "cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800"}`}
            >
              <input
                type="radio"
                className="mt-1"
                name={name}
                value={s.personId}
                checked={current === s.personId}
                disabled={disabled || Boolean(taken)}
                onChange={() => set(s.personId)}
              />
              <span className="min-w-0 break-words">
                <span>
                  Mit vorhandener Person verknüpfen:{" "}
                  <a className="btn-link" href={`/people/${s.personId}`} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                </span>{" "}
                <span className={CLASS_INFO[s.cls].badge}>{CLASS_INFO[s.cls].label}</span>
                {s.onlyBridge && <span className="badge-alt ml-1">einzige Verbindung zweier Familien</span>}
                <span className="block text-xs muted">{s.origin}</span>
                {s.sentence && <span className="block text-xs">Übereinstimmung: {s.sentence}</span>}
                {s.conflicts.length > 0 && <span className="block text-xs text-red-700 dark:text-red-300">Widerspruch: {s.conflicts.join(" · ")}</span>}
                {s.differences.length > 0 && <span className="block text-xs muted">Abweichend: {s.differences.join(" · ")}</span>}
                {taken && <span className="block text-xs muted">Schon für eine andere Person der Datei gewählt.</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
    </li>
  );
}
