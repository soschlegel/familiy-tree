"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Family = { id: string; name: string };

/**
 * Familienzugehörigkeit einer Person. Entscheidet, wer sie sieht — deshalb
 * steht der Hinweis dabei, wenn gar keine Familie zugeordnet ist: eine solche
 * Person ist ausschließlich für Administratoren sichtbar.
 */
export function PersonFamilies({
  personId,
  assigned,
  available,
  editableFamilyIds,
  canEdit,
}: {
  personId: string;
  assigned: Family[];
  available: Family[];
  editableFamilyIds: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(assigned.map((f) => f.id));
  const editable = new Set(editableFamilyIds);

  async function toggle(familyId: string) {
    const next = assignedIds.has(familyId)
      ? [...assignedIds].filter((id) => id !== familyId)
      : [...assignedIds, familyId];

    setBusy(true);
    setError(null);

    const res = await fetch(`/api/persons/${personId}/families`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyIds: next }),
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Fehler ${res.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-stone-500">Familien</h2>

      {assigned.length === 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Diese Person ist keiner Familie zugeordnet und damit nur für
          Administratoren sichtbar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {available.map((f) => {
          const active = assignedIds.has(f.id);
          const mayToggle = canEdit && editable.has(f.id);

          return (
            <button
              key={f.id}
              disabled={!mayToggle || busy}
              onClick={() => toggle(f.id)}
              title={
                mayToggle
                  ? active
                    ? "Zuordnung entfernen"
                    : "Dieser Familie zuordnen"
                  : "Keine Bearbeitungsrechte in dieser Familie"
              }
              className={`rounded-full border px-3 py-1 text-sm transition ${
                active
                  ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                  : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-400"
              } ${mayToggle ? "hover:opacity-80" : "cursor-not-allowed opacity-60"}`}
            >
              {f.name}
            </button>
          );
        })}

        {available.length === 0 && (
          <p className="text-sm text-stone-500">
            Noch keine Familien angelegt.
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
