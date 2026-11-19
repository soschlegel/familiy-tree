"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

/**
 * GEDCOM-Import mit Vorschau: Datei hochladen → Vorschau (Quell-Baum,
 * Familienzuordnung, Abgleich je Gruppe, Hinweise) → bestätigen → Ergebnis.
 * Die Vorschau ändert nichts; Einträge werden seitenweise nachgeladen, damit
 * auch Dateien mit Tausenden Personen bedienbar bleiben.
 */

type Kind = "persons" | "names" | "relationships" | "events" | "sources" | "citations";
type Group = "new" | "changed" | "unchanged" | "edited" | "missing" | "existing" | "invalid";

type Summary = {
  batchId: string;
  fileName: string;
  durationMs: number;
  sourceTreeId: string;
  treeMode: "detected" | "existing" | "overlap" | "new";
  isUpdate: boolean;
  treeCandidates: { sourceTreeId: string; label: string; lastImportAt: string; batches: number; uidOverlap: number }[];
  header: { producer: string | null; producerName: string | null; gedcomVersion: string | null; charset: string | null; exportDate: string | null };
  counts: Record<Kind, Record<Group, number>>;
  diagnostics: { code: string; severity: string; count: number; examples: string[] }[];
  warnings: { code: string; count: number; examples: string[] }[];
  mappingNotes: { code: string; count: number; examples: string[] }[];
  unknownTags: { tag: string; count: number; examplePath: string }[];
  lossless: { nodes: number; consumed: number; preserved: number; lost: number; linesBalanced: boolean };
  records: { persons: number; families: number; sources: number };
  privacy: { marked: number; markedNew: number; recentWithoutDeath: number; recentWithoutDeathNew: number };
  photos: { total: number; newPersons: number; alreadyStored: number; localPaths: number };
  suggestions: number;
  otherTreeHits: number;
};

type Item = {
  ref: string;
  kind: Kind;
  group: Group;
  label: string;
  appId?: string;
  fields?: string[];
  conflict?: boolean;
  reason?: string;
  suggestions?: { personId: string; score: number; reasons: string[]; label: string }[];
};

type Result = {
  durationMs: number;
  counts: Record<Kind, Record<string, number>>;
  invalid: number;
  markedMissing: number;
  deleted: { kind: Kind; count: number }[];
  deleteErrors: string[];
  familyId: string | null;
  alreadyApplied: boolean;
  photos: { requested: number; stored: number; skipped: number; failed: { url: string; message?: string }[] } | null;
};

const KIND_LABEL: Record<Kind, string> = {
  persons: "Personen",
  relationships: "Beziehungen",
  events: "Ereignisse",
  names: "Weitere Namen",
  sources: "Quellen",
  citations: "Belege",
};
const KINDS: Kind[] = ["persons", "relationships", "events", "names", "sources", "citations"];

const GROUP_INFO: Record<Group, { label: string; help: string }> = {
  new: { label: "Neu", help: "Wird angelegt." },
  changed: { label: "In der Datei geändert", help: "Wird mit den Werten der Datei aktualisiert." },
  edited: {
    label: "In der App geändert",
    help: "Seit dem letzten Import hier bearbeitet. Standard: die App-Version bleibt.",
  },
  missing: {
    label: "Fehlt in der Datei",
    help: "Früher importiert, im neuen Stand nicht mehr enthalten. Standard: bleibt erhalten und wird markiert.",
  },
  invalid: { label: "Nicht übernehmbar", help: "Verstößt gegen eine Regel der App und wird ausgelassen — das Original geht nicht verloren." },
  existing: { label: "Schon vorhanden", help: "Gibt es in der App bereits (von Hand angelegt) — bleibt unverändert." },
  unchanged: { label: "Unverändert", help: "Datei und App stimmen überein." },
};
const GROUP_ORDER: Group[] = ["new", "changed", "edited", "missing", "invalid", "existing", "unchanged"];

const FIELD_LABEL: Record<string, string> = {
  givenName: "Vorname",
  familyName: "Nachname",
  birthName: "Geburtsname",
  nickname: "Rufname",
  namePrefix: "Titel",
  nameSuffix: "Namenszusatz",
  gender: "Geschlecht",
  birthDate: "Geburtsdatum",
  birthPlace: "Geburtsort",
  deathDate: "Sterbedatum",
  deathPlace: "Sterbeort",
  deathCause: "Todesursache",
  notes: "Notizen",
  subtype: "Art",
  startDate: "Beginn",
  startPlace: "Ort des Beginns",
  endDate: "Ende",
  endPlace: "Ort des Endes",
  type: "Art",
  label: "Bezeichnung",
  isAlternative: "Zweitangabe",
  date: "Datum",
  place: "Ort",
  address: "Anschrift",
  value: "Wert",
  cause: "Ursache",
  age: "Alter",
  agency: "Stelle",
  sortOrder: "Reihenfolge",
  title: "Titel",
  kind: "Art",
  kindLabel: "Art",
  author: "Verfasser",
  repository: "Archiv",
  callNumber: "Signatur",
  url: "Adresse",
  sourceId: "Quelle",
  personId: "Person",
  relationshipId: "Beziehung",
  eventId: "Ereignis",
  detail: "Fundstelle",
  confidence: "Sicherheit",
  text: "Text",
  prefix: "Titel",
  suffix: "Zusatz",
};
const fieldLabels = (fields: string[] = []) =>
  [...new Set(fields.map((f) => FIELD_LABEL[f.replace(/(Precision|Qualifier|ToPrecision|To|Phrase)$/, "")] ?? f))].join(", ");

const DIAG_LABEL: Record<string, string> = {
  MISSING_RECORD: "Verweis auf fehlenden Datensatz",
  OWN_ANCESTOR: "Person wäre ihr eigener Vorfahr",
  CHILD_BORN_BEFORE_PARENT: "Kind vor einem Elternteil geboren",
  CHILD_BORN_AFTER_PARENT_DEATH: "Kind lange nach dem Tod eines Elternteils geboren",
  DEATH_BEFORE_BIRTH: "Tod vor der Geburt",
  EMPTY_FAMILY: "Leere Familie",
  TOO_MANY_BIOLOGICAL_PARENTS: "Mehr als zwei leibliche Eltern",
  SELF_RELATION: "Beziehung einer Person zu sich selbst",
  DUPLICATE_UID: "Doppelte Kennung",
  PERSON_WITHOUT_NAME: "Personen ohne Namen",
  PRIVACY_MARKED: "Als privat bzw. lebend markiert",
  DATE_LOSSY: "Datum mit Originalwortlaut übernommen",
  DATE_REJECTED: "Unplausibles Datum nur als Wortlaut übernommen",
  NAME_MISSING: "Ohne Vornamen (als „N.N.“ übernommen)",
  DUPLICATE_KEY: "Doppelte Kennung — über die Xref zugeordnet",
  FAMILY_WITHOUT_PARTNERS: "Familie ohne Partner",
  SINGLE_PARENT_FAMILY_EVENTS: "Ereignisse einer Ein-Eltern-Familie (nur Rohdaten)",
  DUPLICATE_COUPLE: "Dasselbe Paar in mehreren Familien",
  EVENT_TYPE_ADJUSTED: "Ereignisart angepasst",
  LOCAL_MEDIA_PATH: "Verweise auf lokale Bilddateien (werden nie gelesen)",
  OTHER_CHILD_KIND: "Unbekannte Eltern-Kind-Art (als leiblich übernommen)",
};

/** Zahl mit passender Einzahl/Mehrzahl: plural(1, "Eintrag", "Einträge") → "1 Eintrag". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

type FamilyChoice = { mode: "none" } | { mode: "existing"; familyIds: string[] } | { mode: "new"; name: string };

export function GedcomImport({ families }: { families: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Entscheidungen
  const [editedDefault, setEditedDefault] = useState<"keep" | "file">("keep");
  const [overrides, setOverrides] = useState<Record<string, "keep" | "file">>({});
  const [toDelete, setToDelete] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [family, setFamily] = useState<FamilyChoice>({ mode: "none" });
  const [privacyUnassigned, setPrivacyUnassigned] = useState(true);
  const [downloadPhotos, setDownloadPhotos] = useState(false);

  function reset() {
    setSummary(null);
    setResult(null);
    setOverrides({});
    setToDelete({});
    setSuggestions({});
    setEditedDefault("keep");
    setFamily({ mode: "none" });
    setDownloadPhotos(false);
    setError(null);
  }

  async function upload() {
    if (!file || busy) return;
    reset();
    setBusy("Datei wird gelesen und abgeglichen …");
    const form = new FormData();
    form.append("file", file);
    const res = await apiFetch<Summary>("/api/import/gedcom", { method: "POST", body: form });
    setBusy(null);
    if (!res.ok) return setError(res.message);
    setSummary(res.data);
  }

  async function chooseTree(value: string) {
    if (!summary) return;
    const body = value === "auto" ? { mode: "auto" } : value === "new" ? { mode: "new" } : { mode: "existing", sourceTreeId: value };
    setBusy("Vorschau wird neu berechnet …");
    setError(null);
    const res = await apiFetch<Summary>(`/api/import/gedcom/${summary.batchId}`, jsonBody("POST", body));
    setBusy(null);
    if (!res.ok) return setError(res.message);
    setOverrides({});
    setToDelete({});
    setSuggestions({});
    setSummary(res.data);
  }

  async function apply() {
    if (!summary || busy) return;
    const del = Object.keys(toDelete).length;
    const msg =
      `Import jetzt ausführen?` +
      (del ? `\n\nAchtung: ${plural(del, "Eintrag wird", "Einträge werden")} endgültig gelöscht.` : "") +
      (downloadPhotos ? `\n\nFotos werden von fremden Servern heruntergeladen.` : "");
    if (!confirm(msg)) return;
    if (family.mode === "new" && !family.name.trim()) return setError("Bitte einen Namen für die neue Familie angeben.");
    if (family.mode === "existing" && family.familyIds.length === 0) return setError("Bitte mindestens eine Familie wählen.");
    setError(null);
    setBusy("Import läuft …");
    const decisions = {
      edited: { default: editedDefault, overrides },
      missing: { delete: Object.keys(toDelete) },
      suggestions: Object.fromEntries(Object.entries(suggestions).filter(([, v]) => v).map(([ref, personId]) => [ref, { personId, mode: "link" }])),
      family,
      privacyUnassigned,
      downloadPhotos,
    };
    const start = await apiFetch(`/api/import/gedcom/${summary.batchId}/apply`, jsonBody("POST", decisions));
    if (!start.ok) {
      setBusy(null);
      return setError(start.message);
    }
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await apiFetch<{ state: string; result?: Result; message?: string }>(`/api/import/gedcom/${summary.batchId}/apply`);
      if (!s.ok) {
        setBusy(null);
        return setError(s.message);
      }
      if (s.data.state === "running") continue;
      setBusy(null);
      if (s.data.state === "done" && s.data.result) {
        setResult(s.data.result);
        window.dispatchEvent(new Event("import-finished"));
        router.refresh();
      } else setError(s.data.message ?? "Der Import ist fehlgeschlagen.");
      return;
    }
  }

  const total = (g: Group) => (summary ? KINDS.reduce((n, k) => n + (summary.counts[k][g] ?? 0), 0) : 0);

  return (
    <section className="card p-5" aria-labelledby="gedcom-import-title">
      <h2 id="gedcom-import-title" className="section-title">
        GEDCOM importieren
      </h2>
      <p className="mt-1 text-sm muted">
        Stammbaum aus MyHeritage, Ancestry, Gramps, Ahnenblatt u. a. (.ged oder .zip mit einer .ged). Erst kommt eine
        Vorschau — geändert wird nichts, bevor du bestätigst. Ein erneuter Import desselben Baums erkennt bekannte Einträge
        wieder; was du hier geändert hast, bleibt standardmäßig erhalten.
      </p>

      {!summary && !result && (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="gedcom-file" className="field-label">
              GEDCOM-Datei
            </label>
            <input
              id="gedcom-file"
              type="file"
              accept=".ged,.zip,.gedcom"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-surface file:px-3 file:py-1.5 file:text-sm dark:file:border-stone-700 dark:file:text-stone-100"
            />
          </div>
          <button type="button" className="btn-primary" disabled={!file || Boolean(busy)} onClick={() => void upload()}>
            {busy ? "Prüfe …" : "Vorschau der GEDCOM-Datei"}
          </button>
        </div>
      )}

      {busy && (
        <p role="status" className="alert-info mt-3 text-sm">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="alert-error mt-3 text-sm">
          {error}
        </p>
      )}

      {summary && !result && (
        <Preview
          summary={summary}
          families={families}
          total={total}
          disabled={Boolean(busy)}
          chooseTree={chooseTree}
          editedDefault={editedDefault}
          setEditedDefault={setEditedDefault}
          overrides={overrides}
          setOverrides={setOverrides}
          toDelete={toDelete}
          setToDelete={setToDelete}
          suggestions={suggestions}
          setSuggestions={setSuggestions}
          family={family}
          setFamily={setFamily}
          privacyUnassigned={privacyUnassigned}
          setPrivacyUnassigned={setPrivacyUnassigned}
          downloadPhotos={downloadPhotos}
          setDownloadPhotos={setDownloadPhotos}
          onApply={() => void apply()}
          onCancel={() => {
            void apiFetch(`/api/import/gedcom/${summary.batchId}`, { method: "DELETE" }).then(() => window.dispatchEvent(new Event("import-finished")));
            reset();
            setFile(null);
          }}
        />
      )}

      {result && <ResultView result={result} onAgain={() => { reset(); setFile(null); }} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vorschau
// ---------------------------------------------------------------------------

function Preview(props: {
  summary: Summary;
  families: { id: string; name: string }[];
  total: (g: Group) => number;
  disabled: boolean;
  chooseTree: (v: string) => void;
  editedDefault: "keep" | "file";
  setEditedDefault: (v: "keep" | "file") => void;
  overrides: Record<string, "keep" | "file">;
  setOverrides: (f: (o: Record<string, "keep" | "file">) => Record<string, "keep" | "file">) => void;
  toDelete: Record<string, string>;
  setToDelete: (f: (o: Record<string, string>) => Record<string, string>) => void;
  suggestions: Record<string, string>;
  setSuggestions: (f: (o: Record<string, string>) => Record<string, string>) => void;
  family: FamilyChoice;
  setFamily: (f: FamilyChoice) => void;
  privacyUnassigned: boolean;
  setPrivacyUnassigned: (v: boolean) => void;
  downloadPhotos: boolean;
  setDownloadPhotos: (v: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const s = props.summary;
  const h = s.header;
  const treeValue = s.treeMode === "new" ? "new" : s.isUpdate ? s.sourceTreeId : "auto";
  const newPersons = s.counts.persons.new;
  const deleteCount = Object.keys(props.toDelete).length;
  const editedTotal = props.total("edited");
  const exceptions = Object.values(props.overrides).filter((v) => v !== props.editedDefault).length;

  return (
    <div className="mt-4 space-y-5" data-testid="gedcom-preview">
      <div className="text-sm">
        <p className="font-medium">{s.fileName}</p>
        <p className="muted">
          {[h.producerName ?? h.producer, h.gedcomVersion && `GEDCOM ${h.gedcomVersion}`, h.charset, h.exportDate && `exportiert ${h.exportDate}`]
            .filter(Boolean)
            .join(" · ")}{" "}
          · {s.records.persons} Personen, {s.records.families} Familien, {s.records.sources} Quellen
        </p>
      </div>

      {/* Quell-Baum */}
      <fieldset className="space-y-2">
        <legend className="field-label">Welcher Baum ist das?</legend>
        <p className="text-sm">
          {s.isUpdate ? (
            <>
              <strong className="font-medium">Aktualisierung eines früheren Imports</strong>
              {s.treeMode === "detected" ? " — am Dateikopf erkannt." : s.treeMode === "overlap" ? " — an übereinstimmenden Kennungen erkannt." : "."}
            </>
          ) : (
            <>
              <strong className="font-medium">Neuer, unabhängiger Baum.</strong>
              {s.otherTreeHits > 0 && ` Achtung: ${s.otherTreeHits} Personen tragen Kennungen, die schon in einem anderen importierten Baum vorkommen — vielleicht ist es eine Aktualisierung?`}
            </>
          )}
        </p>
        <select
          className="field w-full sm:w-auto"
          aria-label="Baum wählen"
          value={treeValue}
          disabled={props.disabled}
          onChange={(e) => props.chooseTree(e.target.value)}
        >
          <option value="auto">Automatisch erkennen</option>
          <option value="new">Neuer, unabhängiger Baum</option>
          {s.treeCandidates.map((c) => (
            <option key={c.sourceTreeId} value={c.sourceTreeId}>
              Aktualisierung von: {c.label} ({fmtDate(c.lastImportAt)}
              {c.uidOverlap ? `, ${c.uidOverlap} gleiche Kennungen` : ""})
            </option>
          ))}
        </select>
      </fieldset>

      {/* Übersicht */}
      <div>
        <h3 className="field-label">Übersicht</h3>
        <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["new", "changed", "edited", "missing", "invalid", "unchanged"] as Group[]).map((g) => (
            <li key={g} data-testid={`gedcom-tile-${g}`} className={`rounded-lg border p-2 text-sm dark:border-stone-700 ${g === "invalid" && props.total(g) ? "border-red-300" : "border-stone-200"}`}>
              <span className="block text-xl font-semibold tabular-nums" data-testid="gedcom-tile-count">{props.total(g)}</span>
              <span className="muted">{GROUP_INFO[g].label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Einträge je Art und Gruppe (waagerecht verschiebbar)">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Einträge je Art und Gruppe</caption>
            <thead>
              <tr className="text-left muted">
                <th scope="col" className="py-1 pr-2 font-normal">Art</th>
                {GROUP_ORDER.map((g) => (
                  <th key={g} scope="col" className="px-1 py-1 text-right font-normal">
                    {GROUP_INFO[g].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((k) => (
                <tr key={k} className="border-t border-stone-100 dark:border-stone-800">
                  <th scope="row" className="py-1 pr-2 text-left font-medium">
                    {KIND_LABEL[k]}
                  </th>
                  {GROUP_ORDER.map((g) => (
                    <td key={g} className="px-1 py-1 text-right tabular-nums">
                      {s.counts[k][g] || <span className="muted">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gruppen */}
      <div className="space-y-2">
        <h3 className="field-label">Einträge</h3>
        {GROUP_ORDER.filter((g) => props.total(g) > 0).map((g) => (
          <GroupList key={`${s.batchId}-${s.sourceTreeId}-${g}`} batchId={s.batchId} group={g} counts={s.counts} {...props} />
        ))}
      </div>

      {/* Familien */}
      <fieldset className="space-y-2">
        <legend className="field-label">Familienzuordnung {newPersons === 1 ? "der neuen Person" : `der ${newPersons} neuen Personen`}</legend>
        <p className="text-sm muted">
          Wer etwas sieht, hängt an Familien. Personen ohne Familie sieht nur der Administrator. Vorhandene Personen behalten
          ihre Zuordnung.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="family-mode" checked={props.family.mode === "none"} onChange={() => props.setFamily({ mode: "none" })} />
          <span>Keiner Familie zuordnen (nur für Administratoren sichtbar)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="family-mode"
            checked={props.family.mode === "existing"}
            disabled={props.families.length === 0}
            onChange={() => props.setFamily({ mode: "existing", familyIds: props.families[0] ? [props.families[0].id] : [] })}
          />
          <span>Vorhandenen Familien zuordnen</span>
        </label>
        {props.family.mode === "existing" && (
          <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
            {props.families.map((f) => {
              const ids = props.family.mode === "existing" ? props.family.familyIds : [];
              return (
                <label key={f.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={ids.includes(f.id)}
                    onChange={(e) =>
                      props.setFamily({ mode: "existing", familyIds: e.target.checked ? [...ids, f.id] : ids.filter((x) => x !== f.id) })
                    }
                  />
                  {f.name}
                </label>
              );
            })}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="family-mode" checked={props.family.mode === "new"} onChange={() => props.setFamily({ mode: "new", name: "" })} />
          <span>Neue Familie anlegen</span>
        </label>
        {props.family.mode === "new" && (
          <div className="ml-6">
            <label htmlFor="new-family-name" className="sr-only">
              Name der neuen Familie
            </label>
            <input
              id="new-family-name"
              className="field w-full sm:w-72"
              placeholder="Name der Familie"
              value={props.family.name}
              onChange={(e) => props.setFamily({ mode: "new", name: e.target.value })}
            />
          </div>
        )}
        {s.privacy.markedNew > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={props.privacyUnassigned} onChange={(e) => props.setPrivacyUnassigned(e.target.checked)} />
            <span>
              {s.privacy.markedNew === 1
                ? "1 neue Person ist in der Datei als privat bzw. lebend markiert — sie ohne Familie lassen"
                : `${s.privacy.markedNew} neue Personen sind in der Datei als privat bzw. lebend markiert — sie ohne Familie lassen`}{" "}
              (nur für Administratoren sichtbar).
            </span>
          </label>
        )}
        {s.privacy.marked > s.privacy.markedNew && (
          <p className="text-sm muted">
            {s.privacy.marked - s.privacy.markedNew === 1
              ? "1 bereits vorhandene Person ist in der Datei als privat bzw. lebend markiert"
              : `${s.privacy.marked - s.privacy.markedNew} bereits vorhandene Personen sind in der Datei als privat bzw. lebend markiert`}{" "}
            — ihre Familienzuordnung bleibt, wie sie ist.
          </p>
        )}
        {s.privacy.recentWithoutDeath > 0 && (
          <p className="text-sm muted">
            Zur Information: {plural(s.privacy.recentWithoutDeath, "Person", "Personen")} ohne Sterbeangabe{" "}
            {s.privacy.recentWithoutDeath === 1 ? "ist" : "sind"} vor weniger als 100 Jahren geboren ({s.privacy.recentWithoutDeathNew} davon neu)
            — {s.privacy.recentWithoutDeath === 1 ? "sie lebt" : "sie leben"} vielleicht noch.
          </p>
        )}
      </fieldset>

      {/* Fotos */}
      {s.photos.total + s.photos.localPaths > 0 && (
        <fieldset className="space-y-1">
          <legend className="field-label">Fotos</legend>
          {s.photos.total > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={props.downloadPhotos} onChange={(e) => props.setDownloadPhotos(e.target.checked)} />
              <span>
                Fotos jetzt herunterladen ({plural(s.photos.total, "Verweis", "Verweise")}{s.photos.alreadyStored ? `, ${s.photos.alreadyStored} schon gespeichert` : ""}).
                Die Datei verweist auf Bilder beim Anbieter; heruntergeladen bleiben sie auch nach Ende eines Abos erhalten.
                Ohne Haken bleiben die Verweise gespeichert und ein späterer Import kann sie holen.
              </span>
            </label>
          )}
          {s.photos.localPaths > 0 && <p className="text-sm muted">{plural(s.photos.localPaths, "Verweis", "Verweise")} auf lokale Bilddateien {s.photos.localPaths === 1 ? "wird" : "werden"} nicht gelesen (nur als Verweis erhalten).</p>}
        </fieldset>
      )}

      <Notices summary={s} />

      {/* Was passiert */}
      <div className="alert-info text-sm" data-testid="gedcom-what">
        <p className="font-medium">Was der Import tut</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>
            {plural(props.total("new"), "Eintrag wird", "Einträge werden")} neu angelegt, {props.total("changed")} mit den Werten der Datei aktualisiert.
          </li>
          {editedTotal > 0 && (
            <li>
              {plural(editedTotal, "in der App geänderter Eintrag", "in der App geänderte Einträge")}{" "}
              {props.editedDefault === "keep"
                ? editedTotal === 1 ? "behält die App-Version" : "behalten die App-Version"
                : editedTotal === 1 ? "übernimmt die Dateiversion" : "übernehmen die Dateiversion"}
              {exceptions ? ` — ${exceptions} davon nach deiner Einzelwahl andersherum` : ""}.
            </li>
          )}
          {props.total("missing") > 0 && (
            <li>
              {plural(props.total("missing"), "in der Datei fehlender Eintrag bleibt", "in der Datei fehlende Einträge bleiben")} erhalten und{" "}
              {props.total("missing") === 1 ? "wird" : "werden"} markiert
              {deleteCount ? `; ${deleteCount} davon ${deleteCount === 1 ? "wird" : "werden"} auf deinen Wunsch gelöscht` : " — gelöscht wird nichts"}.
            </li>
          )}
          {props.total("invalid") > 0 && (
            <li>
              {plural(props.total("invalid"), "Eintrag verstößt", "Einträge verstoßen")} gegen Regeln der App und{" "}
              {props.total("invalid") === 1 ? "wird" : "werden"} ausgelassen; abgelehnte Beziehungen bleiben samt Ereignissen im Original bei einer beteiligten Person erhalten (Rohdaten, auch im GEDCOM-Export).
            </li>
          )}
          <li>Familienzuordnungen vorhandener Personen und von Hand angelegte Einträge bleiben unverändert.</li>
          <li>Die Originaldatei wird aufbewahrt; nicht deutbare Angaben landen unverändert in den Rohdaten.</li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={props.disabled} onClick={props.onApply}>
          GEDCOM-Import ausführen
        </button>
        <button type="button" className="btn-secondary" disabled={props.disabled} onClick={props.onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function GroupList(props: {
  batchId: string;
  group: Group;
  counts: Record<Kind, Record<Group, number>>;
  editedDefault: "keep" | "file";
  setEditedDefault: (v: "keep" | "file") => void;
  overrides: Record<string, "keep" | "file">;
  setOverrides: (f: (o: Record<string, "keep" | "file">) => Record<string, "keep" | "file">) => void;
  toDelete: Record<string, string>;
  setToDelete: (f: (o: Record<string, string>) => Record<string, string>) => void;
  suggestions: Record<string, string>;
  setSuggestions: (f: (o: Record<string, string>) => Record<string, string>) => void;
}) {
  const { group, counts } = props;
  const kinds = KINDS.filter((k) => counts[k][group] > 0);
  const [open, setOpen] = useState(group === "edited" || group === "missing" || group === "invalid");
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const count = KINDS.reduce((n, k) => n + counts[k][group], 0);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      const params = new URLSearchParams({ kind, group, offset: String(offset), limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      const res = await apiFetch<{ total: number; items: Item[] }>(`/api/import/gedcom/${props.batchId}/items?${params}`);
      setLoading(false);
      if (!res.ok) return;
      setTotal(res.data.total);
      setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
    },
    [kind, group, q, props.batchId],
  );

  useEffect(() => {
    if (open) void load(0);
  }, [open, load]);

  const withSuggestion = useMemo(() => items.filter((i) => i.suggestions?.length).length, [items]);

  return (
    <details data-testid={`gedcom-group-${group}`} className="rounded-lg border border-stone-200 dark:border-stone-700" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-sm">
        <span className="font-medium">{GROUP_INFO[group].label}</span> <span className="badge ml-1">{count}</span>
        <span className="block text-xs muted sm:ml-2 sm:inline">{GROUP_INFO[group].help}</span>
      </summary>
      {open && (
        <div className="space-y-2 border-t border-stone-200 px-3 py-2 dark:border-stone-700">
          {group === "edited" && (
            <div role="radiogroup" aria-label="Alle in der App geänderten Einträge" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="muted">Für alle:</span>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="edited-default" checked={props.editedDefault === "keep"} onChange={() => { props.setEditedDefault("keep"); props.setOverrides(() => ({})); }} />
                App-Version behalten
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="edited-default" checked={props.editedDefault === "file"} onChange={() => { props.setEditedDefault("file"); props.setOverrides(() => ({})); }} />
                Dateiversion übernehmen
              </label>
            </div>
          )}
          {group === "missing" && (
            <div className="flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  if (confirm(`${items.length === 1 ? "Den angezeigten Eintrag" : `Alle ${items.length} angezeigten Einträge`} zum Löschen vormerken?`)) {
                    props.setToDelete((o) => ({ ...o, ...Object.fromEntries(items.map((i) => [i.ref, i.label])) }));
                  }
                }}
              >
                Angezeigte zum Löschen vormerken
              </button>
              {Object.keys(props.toDelete).length > 0 && (
                <button type="button" className="btn-link btn-sm" onClick={() => props.setToDelete(() => ({}))}>
                  Keine löschen
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {kinds.length > 1 && (
              <div role="tablist" aria-label="Art" className="flex flex-wrap gap-1">
                {kinds.map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={k === kind}
                    className={`btn-sm ${k === kind ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setKind(k)}
                  >
                    {KIND_LABEL[k]} ({counts[k][group]})
                  </button>
                ))}
              </div>
            )}
            {counts[kind][group] > 20 && (
              <input
                className="field w-full sm:w-56"
                type="search"
                placeholder="Suchen …"
                aria-label="Einträge durchsuchen"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            )}
          </div>
          {group === "new" && kind === "persons" && withSuggestion > 0 && (
            <p className="text-sm alert-warning">
              Für einige neue Personen gibt es ähnliche, von Hand angelegte Personen. Nur wenn du eine auswählst, wird die
              Datei-Person ihr zugeordnet (ihre Angaben bleiben, Ereignisse und Namen aus der Datei kommen hinzu).
            </p>
          )}
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {items.map((i) => (
              <li key={i.ref} className="py-1.5" data-testid="gedcom-item">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words">
                    {i.appId && i.kind === "persons" ? (
                      <a className="btn-link" href={`/people/${i.appId}`} target="_blank" rel="noreferrer">
                        {i.label}
                      </a>
                    ) : (
                      i.label
                    )}
                    {i.conflict && <span className="badge-alt ml-2">auch in der Datei geändert</span>}
                  </span>
                  {group === "edited" && (
                    <select
                      className="field py-0.5 text-xs"
                      aria-label={`Version für ${i.label}`}
                      value={props.overrides[i.ref] ?? props.editedDefault}
                      onChange={(e) => props.setOverrides((o) => ({ ...o, [i.ref]: e.target.value as "keep" | "file" }))}
                    >
                      <option value="keep">App-Version behalten</option>
                      <option value="file">Dateiversion übernehmen</option>
                    </select>
                  )}
                  {group === "missing" && (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(props.toDelete[i.ref])}
                        onChange={(e) =>
                          props.setToDelete((o) => {
                            const n = { ...o };
                            if (e.target.checked) n[i.ref] = i.label;
                            else delete n[i.ref];
                            return n;
                          })
                        }
                      />
                      löschen
                    </label>
                  )}
                </div>
                {i.fields && i.fields.length > 0 && <p className="text-xs muted">Abweichend: {fieldLabels(i.fields)}</p>}
                {i.reason && group !== "existing" && <p className="text-xs text-red-700 dark:text-red-300">{i.reason}</p>}
                {i.suggestions && i.suggestions.length > 0 && (
                  <div className="mt-1">
                    <label className="text-xs muted" htmlFor={`sugg-${i.ref}`}>
                      Ist das eine dieser Personen?
                    </label>
                    <select
                      id={`sugg-${i.ref}`}
                      className="field mt-0.5 w-full py-0.5 text-xs sm:w-auto"
                      value={props.suggestions[i.ref] ?? ""}
                      onChange={(e) => props.setSuggestions((o) => ({ ...o, [i.ref]: e.target.value }))}
                    >
                      <option value="">Nein — neu anlegen</option>
                      {i.suggestions.map((sg) => (
                        <option key={sg.personId} value={sg.personId}>
                          Ja: {sg.label} ({Math.round(sg.score * 100)} %: {sg.reasons.join(", ")})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {loading && <p className="text-xs muted">Lädt …</p>}
          {!loading && items.length < total && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => void load(items.length)}>
              Weitere laden ({total - items.length} übrig)
            </button>
          )}
        </div>
      )}
    </details>
  );
}

function Notices({ summary: s }: { summary: Summary }) {
  const lists = [
    { title: "Prüfung der Datei", items: s.diagnostics.map((d) => ({ code: d.code, count: d.count, examples: d.examples, severity: d.severity })) },
    { title: "Übernahme", items: s.mappingNotes.map((d) => ({ ...d, severity: "info" })) },
    { title: "Lesen der Datei", items: s.warnings.map((d) => ({ ...d, severity: "warning" })) },
  ].filter((l) => l.items.length);
  return (
    <div className="space-y-2">
      <h3 className="field-label">Hinweise</h3>
      <p className="text-sm">
        Vollständigkeit: {s.lossless.lost === 0 ? "nichts geht verloren" : `${s.lossless.lost} Zeilen nicht erfasst`} —{" "}
        {s.lossless.consumed} von {s.lossless.nodes} Zeilen gedeutet, {s.lossless.preserved} unverändert als Rohdaten erhalten.
      </p>
      {lists.length === 0 && <p className="text-sm muted">Keine Auffälligkeiten.</p>}
      {lists.map((l) => (
        <details key={l.title} className="text-sm">
          <summary className="cursor-pointer">
            {l.title}: {l.items.reduce((n, x) => n + x.count, 0)}
          </summary>
          <ul className="mt-1 space-y-1 pl-4">
            {l.items.map((x) => (
              <li key={x.code}>
                <span className={x.severity === "error" ? "text-red-700 dark:text-red-300" : ""}>
                  {DIAG_LABEL[x.code] ?? x.code}: {x.count}
                </span>
                <ul className="list-disc pl-5 text-xs muted">
                  {x.examples.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {s.unknownTags.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">Nicht gedeutete Angaben (in den Rohdaten erhalten): {s.unknownTags.length} Arten</summary>
          <ul className="mt-1 flex flex-wrap gap-1 pl-4">
            {s.unknownTags.map((t) => (
              <li key={t.tag} className="badge" title={t.examplePath}>
                {t.tag} × {t.count}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ResultView({ result: r, onAgain }: { result: Result; onAgain: () => void }) {
  const sum = (o: string) => KINDS.reduce((n, k) => n + (r.counts[k]?.[o] ?? 0), 0);
  return (
    <div role="status" className="alert-success mt-4 space-y-2 text-sm" data-testid="gedcom-result">
      <p className="font-medium">{r.alreadyApplied ? "Dieser Import war bereits ausgeführt." : `Import abgeschlossen (${(r.durationMs / 1000).toFixed(1)} s)`}</p>
      <ul className="space-y-0.5">
        {KINDS.map((k) => {
          const c = r.counts[k] ?? {};
          return (
            <li key={k}>
              {KIND_LABEL[k]}: {c.created ?? 0} neu, {c.updated ?? 0} aktualisiert, {c.unchanged ?? 0} unverändert
              {c.skippedEdited ? `, ${c.skippedEdited} App-Version behalten` : ""}
              {c.invalid ? `, ${c.invalid} ausgelassen` : ""}
            </li>
          );
        })}
      </ul>
      <p>
        Insgesamt {sum("created")} neu, {sum("updated")} aktualisiert. {r.markedMissing ? `${plural(r.markedMissing, "fehlender Eintrag", "fehlende Einträge")} markiert. ` : ""}
        {r.deleted.length ? `Gelöscht: ${r.deleted.map((d) => `${d.count} ${KIND_LABEL[d.kind]}`).join(", ")}. ` : ""}
      </p>
      {r.deleteErrors.length > 0 && <p className="text-red-700">Nicht gelöscht: {r.deleteErrors.join("; ")}</p>}
      {r.photos && (
        <p>
          Fotos: {r.photos.stored} gespeichert, {r.photos.skipped} schon vorhanden, {r.photos.failed.length} fehlgeschlagen.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a href="#importe" className="btn-secondary btn-sm">
          Zum Importverlauf
        </a>
        <button type="button" className="btn-secondary btn-sm" onClick={onAgain}>
          Weitere Datei importieren
        </button>
      </div>
    </div>
  );
}
