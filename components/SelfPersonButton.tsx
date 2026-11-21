"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

/**
 * „Das bin ich“ auf der Personenseite (README, „Bezugsperson“). Ersetzt eine
 * bereits gewählte eigene Person erst nach Rückfrage.
 */
export function SelfPersonButton({
  personId,
  personName,
  isSelf,
  currentSelfName,
}: {
  personId: string;
  personName: string;
  isSelf: boolean;
  /** Name der bisher gewählten eigenen Person (falls sichtbar). */
  currentSelfName: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    if (next && currentSelfName && !confirm(`Bisher bist du ${currentSelfName}. Stattdessen ${personName}?`)) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/me/person", jsonBody("PUT", { personId: next }));
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        data-testid={isSelf ? "self-person-clear" : "self-person-set"}
        onClick={() => void save(isSelf ? null : personId)}
        className="btn-secondary"
      >
        {busy ? "Speichert…" : isSelf ? "Das bin ich nicht" : "Das bin ich"}
      </button>
      {error && (
        <p role="alert" className="basis-full text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  );
}
