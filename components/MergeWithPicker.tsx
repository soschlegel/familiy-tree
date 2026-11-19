"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { PersonPicker, type PickerPerson } from "./PersonPicker";

/**
 * Personenseite → „Mit anderer Person zusammenführen …“: die andere Person
 * suchen, dann der Vergleich (/people/merge). Diese Person bleibt; im
 * Vergleich lassen sich die Seiten tauschen.
 */
export function MergeWithPicker({ personId, people }: { personId: string; people: PickerPerson[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  const labelId = useId();

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Ist diese Person doppelt erfasst? Beide Einträge lassen sich zu einem zusammenführen.</p>
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)} data-testid="merge-open">
          Mit anderer Person zusammenführen …
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        Welche Person ist dieselbe?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <PersonPicker people={people} value={other} onChange={setOther} labelledBy={labelId} placeholder="Name der doppelten Person…" />
        <button
          type="button"
          className="btn-primary"
          disabled={!other}
          onClick={() => router.push(`/people/merge?keep=${personId}&other=${other}`)}
          data-testid="merge-compare"
        >
          Vergleichen
        </button>
        <button type="button" className="btn-link" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
