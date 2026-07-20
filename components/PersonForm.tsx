"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type PersonFormValues = {
  id?: string;
  givenName: string;
  familyName: string | null;
  birthName: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  birthDate: string | null;
  birthPlace: string | null;
  deathDate: string | null;
  deathPlace: string | null;
  notes: string | null;
};

const EMPTY: PersonFormValues = {
  givenName: "",
  familyName: "",
  birthName: "",
  gender: "UNKNOWN",
  birthDate: "",
  birthPlace: "",
  deathDate: "",
  deathPlace: "",
  notes: "",
};

const field =
  "w-full rounded border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

export function PersonForm({ initial }: { initial?: PersonFormValues }) {
  const router = useRouter();
  const [values, setValues] = useState<PersonFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PersonFormValues>(
    key: K,
    value: PersonFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const isEdit = Boolean(initial?.id);
    const res = await fetch(
      isEdit ? `/api/persons/${initial!.id}` : "/api/persons",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Fehler ${res.status}`);
      return;
    }

    const person = await res.json();
    router.push(`/people/${person.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Vorname *</span>
          <input
            required
            className={field}
            value={values.givenName}
            onChange={(e) => set("givenName", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Nachname</span>
          <input
            className={field}
            value={values.familyName ?? ""}
            onChange={(e) => set("familyName", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Geburtsname</span>
          <input
            className={field}
            value={values.birthName ?? ""}
            onChange={(e) => set("birthName", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Geschlecht</span>
          <select
            className={field}
            value={values.gender}
            onChange={(e) =>
              set("gender", e.target.value as PersonFormValues["gender"])
            }
          >
            <option value="UNKNOWN">unbekannt</option>
            <option value="FEMALE">weiblich</option>
            <option value="MALE">männlich</option>
            <option value="OTHER">divers</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Geburtsdatum</span>
          <input
            type="date"
            className={field}
            value={values.birthDate?.slice(0, 10) ?? ""}
            onChange={(e) => set("birthDate", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Geburtsort</span>
          <input
            className={field}
            value={values.birthPlace ?? ""}
            onChange={(e) => set("birthPlace", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Sterbedatum</span>
          <input
            type="date"
            className={field}
            value={values.deathDate?.slice(0, 10) ?? ""}
            onChange={(e) => set("deathDate", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">Sterbeort</span>
          <input
            className={field}
            value={values.deathPlace ?? ""}
            onChange={(e) => set("deathPlace", e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-stone-500">Notizen</span>
        <textarea
          rows={4}
          className={field}
          value={values.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      <button
        disabled={saving}
        className="rounded bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {saving ? "Speichern…" : "Speichern"}
      </button>
    </form>
  );
}
