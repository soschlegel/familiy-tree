import Link from "next/link";

export const metadata = { title: "Nicht gefunden" };

/**
 * Bewusst ohne Unterscheidung zwischen „gibt es nicht" und „darfst du nicht
 * sehen" — sonst ließe sich die Existenz fremder Personen erraten.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <h1 className="page-title">Seite nicht gefunden</h1>
      <p className="muted">
        Diese Seite gibt es nicht, oder sie ist für dich nicht freigegeben.
      </p>
      <div className="flex gap-2">
        <Link href="/people" className="btn-primary">
          Zur Personenliste
        </Link>
        <Link href="/tree" className="btn-secondary">
          Zum Stammbaum
        </Link>
      </div>
    </div>
  );
}
