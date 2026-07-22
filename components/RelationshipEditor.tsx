"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PersonPicker, type PickerPerson } from "./PersonPicker";
import { MediaGallery } from "./MediaGallery";
import { formatDate } from "@/lib/tree-layout";

export type RelationRow = {
  id: string;
  label: string; // "Elternteil" | "Kind" | "Partner"
  subtype: string;
  startDate: string | null;
  endDate: string | null;
  otherId: string;
  otherName: string;
  media: { mediaId: string; caption: string | null; isPrimary: boolean }[];
};

const SUBTYPE_LABEL: Record<string, string> = {
  BIOLOGICAL: "leiblich",
  ADOPTIVE: "adoptiert",
  STEP: "Stief",
  FOSTER: "Pflege",
  MARRIED: "verheiratet",
  UNMARRIED: "unverheiratet",
  DIVORCED: "geschieden",
};

// Beschriftung der Datumsfelder je Beziehungsart. null = Feld ausblenden.
const DATE_FIELDS: Record<string, { start: string | null; end: string | null }> =
  {
    MARRIED: { start: "Hochzeitsdatum", end: null },
    UNMARRIED: { start: "Zusammen seit", end: null },
    DIVORCED: { start: "Hochzeitsdatum", end: "Scheidungsdatum" },
    ADOPTIVE: { start: "Adoption am", end: null },
    FOSTER: { start: "In Pflege seit", end: null },
    BIOLOGICAL: { start: null, end: null },
    STEP: { start: null, end: null },
  };

const field =
  "rounded border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

const fmt = (d: string | null) => (d ? formatDate(d) : null);

/** "verheiratet seit 01.08.1984" bzw. "geschieden, 1984–2001" */
function describe(r: RelationRow): string {
  const base = SUBTYPE_LABEL[r.subtype] ?? r.subtype;
  const start = fmt(r.startDate);
  const end = fmt(r.endDate);

  if (start && end) return `${base}, ${start} – ${end}`;
  if (start) return `${base} seit ${start}`;
  if (end) return `${base} seit ${end}`;
  return base;
}

type PatchData = {
  subtype: string;
  startDate: string | null;
  endDate: string | null;
};

/** Nachträgliche Korrektur von Art und Zeitraum einer bestehenden Beziehung. */
function RelationDateEditor({
  relation,
  busy,
  onSave,
}: {
  relation: RelationRow;
  busy: boolean;
  onSave: (data: PatchData) => void;
}) {
  const [subtype, setSubtype] = useState(relation.subtype);
  const [start, setStart] = useState(relation.startDate?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(relation.endDate?.slice(0, 10) ?? "");

  const labels = DATE_FIELDS[subtype] ?? { start: null, end: null };
  const isPartner = relation.label === "Partner";
  const choices = isPartner
    ? ["MARRIED", "UNMARRIED", "DIVORCED"]
    : ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"];

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-2 dark:border-stone-800">
      <label className="block">
        <span className="mb-1 block text-xs text-stone-500">Näheres</span>
        <select
          className={field}
          value={subtype}
          onChange={(e) => setSubtype(e.target.value)}
        >
          {choices.map((s) => (
            <option key={s} value={s}>
              {SUBTYPE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      {labels.start && (
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">
            {labels.start}
          </span>
          <input
            type="date"
            className={field}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
      )}

      {labels.end && (
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">
            {labels.end}
          </span>
          <input
            type="date"
            className={field}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave({
            subtype,
            startDate: labels.start && start ? start : null,
            endDate: labels.end && end ? end : null,
          })
        }
        className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
      >
        Speichern
      </button>
    </div>
  );
}

export function RelationshipEditor({
  personId,
  relations,
  people,
  canEdit,
  canUploadMedia,
  canDeleteMedia,
}: {
  personId: string;
  relations: RelationRow[];
  people: PickerPerson[];
  canEdit: boolean;
  canUploadMedia: boolean;
  canDeleteMedia: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"PARENT" | "CHILD" | "PARTNER">("CHILD");
  const [otherId, setOtherId] = useState("");
  const [subtype, setSubtype] = useState("BIOLOGICAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Aus dem Stammbaum verlinkt: ?rel=<id> öffnet direkt die Galerie dieser
  // Ehe, damit der Klick auf den Ehe-Marker dort landet, wo er hinzeigt.
  const searchParams = useSearchParams();
  const linkedRelation = searchParams.get("rel");
  const [gallery, setGallery] = useState<string | null>(linkedRelation);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!linkedRelation) return;
    setGallery(linkedRelation);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linkedRelation]);

  // Neu angelegte Personen sofort auswählbar machen, ohne die Seite neu zu
  // laden — sonst ginge die halbfertige Zuordnung verloren.
  const [extraPeople, setExtraPeople] = useState<PickerPerson[]>([]);
  const options = [...people, ...extraPeople];

  const dateLabels = DATE_FIELDS[subtype] ?? { start: null, end: null };

  function resetForm() {
    setOtherId("");
    setStartDate("");
    setEndDate("");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!otherId) {
      setError("Bitte zuerst eine Person auswählen.");
      return;
    }
    setBusy(true);
    setError(null);

    // Richtung auflösen: PARENT_OF zeigt immer vom Elternteil zum Kind.
    const body =
      kind === "PARENT"
        ? { type: "PARENT_OF", fromPersonId: otherId, toPersonId: personId }
        : kind === "CHILD"
          ? { type: "PARENT_OF", fromPersonId: personId, toPersonId: otherId }
          : { type: "PARTNER_OF", fromPersonId: personId, toPersonId: otherId };

    const res = await fetch("/api/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        subtype,
        startDate: dateLabels.start && startDate ? startDate : null,
        endDate: dateLabels.end && endDate ? endDate : null,
      }),
    });

    setBusy(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Fehler ${res.status}`);
      return;
    }

    resetForm();
    router.refresh();
  }

  async function save(id: string, data: PatchData) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/relationships/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    setBusy(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Fehler ${res.status}`);
      return;
    }

    setEditing(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/relationships/${id}`, { method: "DELETE" });
    if (!res.ok) setError(`Löschen fehlgeschlagen (${res.status})`);
    setBusy(false);
    router.refresh();
  }

  const subtypeOptions =
    kind === "PARTNER"
      ? ["MARRIED", "UNMARRIED", "DIVORCED"]
      : ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"];

  return (
    <section ref={sectionRef} className="space-y-3">
      <h2 className="font-medium">Beziehungen</h2>

      {relations.length === 0 ? (
        <p className="text-sm text-stone-500">Keine Beziehungen erfasst.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {relations.map((r) => (
            <li
              key={r.id}
              className={`px-3 py-2 text-sm transition-colors ${
                r.id === linkedRelation
                  ? "bg-amber-50 dark:bg-amber-950/30"
                  : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-stone-500">{r.label}</span>
                <Link
                  href={`/people/${r.otherId}`}
                  className="font-medium hover:underline"
                >
                  {r.otherName}
                </Link>
                <span className="text-xs text-stone-500">{describe(r)}</span>
                {/* Nur Partnerschaften sind ein Ereignis mit eigenem Bild —
                    ein Eltern-Kind-Verhältnis hat kein Datum im selben Sinn. */}
                {r.label === "Partner" && (
                  <button
                    onClick={() => setGallery(gallery === r.id ? null : r.id)}
                    className="text-xs text-stone-500 hover:underline"
                  >
                    {r.media.length > 0
                      ? `${r.media.length} Bild(er)`
                      : "Bilder"}
                  </button>
                )}

                {canEdit && (
                  <span className="ml-auto flex shrink-0 gap-3">
                    <button
                      onClick={() => setEditing(editing === r.id ? null : r.id)}
                      disabled={busy}
                      className="text-xs hover:underline"
                    >
                      {editing === r.id ? "abbrechen" : "ändern"}
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:underline"
                    >
                      entfernen
                    </button>
                  </span>
                )}
              </div>

              {canEdit && editing === r.id && (
                <RelationDateEditor
                  relation={r}
                  busy={busy}
                  onSave={(data) => void save(r.id, data)}
                />
              )}

              {gallery === r.id && (
                <div className="mt-2 border-t border-stone-200 pt-2 dark:border-stone-800">
                  <MediaGallery
                    owner={{ kind: "relationship", id: r.id }}
                    items={r.media}
                    canUpload={canUploadMedia}
                    canDelete={canDeleteMedia}
                    title={
                      r.subtype === "MARRIED" || r.subtype === "DIVORCED"
                        ? "Hochzeitsbilder"
                        : "Bilder zur Beziehung"
                    }
                    compact
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          onSubmit={add}
          className="flex flex-wrap items-end gap-2 rounded border border-stone-200 p-3 dark:border-stone-800"
        >
          <label className="block">
            <span className="mb-1 block text-xs text-stone-500">Art</span>
            <select
              className={field}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                setSubtype(next === "PARTNER" ? "MARRIED" : "BIOLOGICAL");
                resetForm();
              }}
            >
              <option value="CHILD">Kind</option>
              <option value="PARENT">Elternteil</option>
              <option value="PARTNER">Partner</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-stone-500">Person</span>
            <PersonPicker
              people={options.filter((p) => p.id !== personId)}
              value={otherId}
              onChange={setOtherId}
              onCreated={(p) => setExtraPeople((prev) => [...prev, p])}
              placeholder="Suchen oder neu anlegen…"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-stone-500">Näheres</span>
            <select
              className={field}
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
            >
              {subtypeOptions.map((s) => (
                <option key={s} value={s}>
                  {SUBTYPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          {dateLabels.start && (
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">
                {dateLabels.start}
              </span>
              <input
                type="date"
                className={field}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
          )}

          {dateLabels.end && (
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">
                {dateLabels.end}
              </span>
              <input
                type="date"
                className={field}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}

          <button
            disabled={busy}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
          >
            Hinzufügen
          </button>
        </form>
      )}

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
