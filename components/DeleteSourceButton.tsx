"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "./api-client";

/** Quelle samt aller Belege löschen — mit Bestätigung, die die Folgen nennt. */
export function DeleteSourceButton({
  sourceId,
  title,
  citationCount,
}: {
  sourceId: string;
  title: string;
  citationCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    const consequence =
      citationCount > 0
        ? `\n\nDamit verschwinden auch ${citationCount === 1 ? "der Beleg" : `alle ${citationCount} Belege`} bei den Personen.`
        : "";
    if (!confirm(`Quelle „${title}“ wirklich löschen?${consequence}`)) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/sources/${sourceId}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }
    router.push(`/sources?deleted=${encodeURIComponent(title)}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm muted">Löscht die Quelle samt aller Belege, die auf sie verweisen.</p>
      <button type="button" onClick={() => void remove()} disabled={busy} className="btn-danger">
        {busy ? "Löscht…" : "Quelle löschen"}
      </button>
      {error && (
        <p role="alert" className="alert-error w-full">
          {error}
        </p>
      )}
    </div>
  );
}
