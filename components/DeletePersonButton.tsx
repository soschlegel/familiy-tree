"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "./api-client";

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
    if (busy) return;
    if (!confirm(`„${personName}" wirklich löschen? Das lässt sich nicht rückgängig machen.`)) return;

    setBusy(true);
    setError(null);

    let res = await apiFetch(`/api/persons/${personId}`, { method: "DELETE" });

    if (!res.ok && res.status === 409) {
      const count = Number(res.body.relationCount ?? 0);
      const ok = confirm(
        `„${personName}" ist noch mit ${count} Beziehung(en) verknüpft.\n\n` +
          `Beim Löschen gehen diese Verbindungen verloren — Eltern und Kinder ` +
          `werden im Stammbaum dadurch getrennt.\n\nTrotzdem löschen?`,
      );
      if (!ok) {
        setBusy(false);
        return;
      }
      res = await apiFetch(`/api/persons/${personId}?force=true`, { method: "DELETE" });
    }

    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }

    router.push(`/people?deleted=${encodeURIComponent(personName)}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm muted">
        Löscht die Person samt ihrer Beziehungen und Bildzuordnungen.
      </p>
      <button type="button" onClick={() => void remove()} disabled={busy} className="btn-danger">
        {busy ? "Löscht…" : "Person löschen"}
      </button>
      {error && (
        <p role="alert" className="alert-error w-full">
          {error}
        </p>
      )}
    </div>
  );
}
