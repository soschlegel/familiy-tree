"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Unerwarteter Fehler beim Aufbau einer Seite. Details stehen im Server-Log
 * bzw. in der Browser-Konsole; hier nur ein freundlicher Hinweis und der Weg
 * zurück.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <h1 className="page-title">Da ist etwas schiefgegangen</h1>
      <p className="muted">
        Die Seite konnte nicht geladen werden. Meist hilft es, es noch einmal zu
        versuchen. Bleibt der Fehler bestehen, bitte dem Administrator Bescheid
        geben
        {error.digest ? (
          <>
            {" "}
            (Fehlerkennung <code className="text-xs">{error.digest}</code>)
          </>
        ) : null}
        .
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          Erneut versuchen
        </button>
        <Link href="/tree" className="btn-secondary">
          Zum Stammbaum
        </Link>
      </div>
    </div>
  );
}
