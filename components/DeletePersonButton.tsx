"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Löschen mit zweistufiger Bestätigung: Hat die Person noch Beziehungen,
 * antwortet die API mit 409 und nennt deren Anzahl. Erst dann wird die
 * Folge (verschwindende Verbindungen im Baum) benannt und ?force=true
 * nachgereicht — versehentliches Herauslöschen aus dem Stammbaum wäre sonst
 * nicht wiederherstellbar.
 */
export function DeletePersonButton({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`„${personName}" wirklich löschen?`)) return;

    setBusy(true);
    setError(null);

    let res = await fetch(`/api/persons/${personId}`, { method: "DELETE" });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const count = body.relationCount ?? 0;
      const ok = confirm(
        `„${personName}" ist noch mit ${count} Beziehung(en) verknüpft.\n\n` +
          `Beim Löschen gehen diese Verbindungen verloren — Eltern und Kinder ` +
          `werden im Stammbaum dadurch getrennt.\n\nTrotzdem löschen?`,
      );
      if (!ok) {
        setBusy(false);
        return;
      }
      res = await fetch(`/api/persons/${personId}?force=true`, {
        method: "DELETE",
      });
    }

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Löschen fehlgeschlagen (${res.status})`);
      return;
    }

    router.push("/people");
    router.refresh();
  }

  return (
    <div className="text-right">
      <button
        onClick={remove}
        disabled={busy}
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
      >
        {busy ? "Löschen…" : "Person löschen"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
