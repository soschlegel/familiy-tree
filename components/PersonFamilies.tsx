"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(assigned.map((f) => f.id));
  const editable = new Set(editableFamilyIds);

  async function toggle(familyId: string) {
    if (busy) return;
    const next = assignedIds.has(familyId)
      ? [...assignedIds].filter((id) => id !== familyId)
      : [...assignedIds, familyId];

    setBusy(familyId);
    setError(null);
    const res = await apiFetch(
      `/api/persons/${personId}/families`,
      jsonBody("PUT", { familyIds: next }),
    );
    setBusy(null);

    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-2" aria-labelledby="person-families-h">
      <h3 id="person-families-h" className="font-serif text-base font-semibold">
        Familien
      </h3>
      <p className="text-sm muted">
        Bestimmen, wer diese Person sehen kann. Antippen zum Zuordnen oder Entfernen.
      </p>

      {assigned.length === 0 && (
        <p className="alert-warning">
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
              type="button"
              key={f.id}
              disabled={!mayToggle || busy !== null}
              aria-pressed={active}
              onClick={() => void toggle(f.id)}
              title={
                mayToggle
                  ? active
                    ? "Zuordnung entfernen"
                    : "Dieser Familie zuordnen"
                  : "Keine Bearbeitungsrechte in dieser Familie"
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                active
                  ? "border-accent-700 bg-accent-700 text-white dark:border-accent-300 dark:bg-accent-300 dark:text-stone-950"
                  : "border-stone-300 bg-surface text-stone-700 dark:border-stone-700 dark:text-stone-300"
              } ${mayToggle ? "hover:opacity-85" : "cursor-not-allowed opacity-60"} ${busy === f.id ? "animate-pulse" : ""}`}
            >
              <span aria-hidden>{active ? "✓" : "+"}</span>
              {f.name}
            </button>
          );
        })}

        {available.length === 0 && (
          <p className="text-sm muted">Noch keine Familien angelegt.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </section>
  );
}
