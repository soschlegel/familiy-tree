"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Plan = {
  persons: { create: number; update: number };
  relationships: { create: number; update: number };
  media: { create: number; skip: number; withoutFile: number };
  warnings: string[];
};

const box =
  "rounded-lg border border-stone-200 p-4 dark:border-stone-800";

export function DataTransfer({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`/api/import?apply=${apply}`, {
      method: "POST",
      body: form,
    });

    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Fehler ${res.status}`);
      setPlan(null);
      return;
    }

    const body = await res.json();
    setPlan(body.plan);
    setApplied(apply);
    if (apply) {
      setFile(null);
      router.refresh();
    }
  }

  const total = plan
    ? plan.persons.create +
      plan.persons.update +
      plan.relationships.create +
      plan.relationships.update +
      plan.media.create
    : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className={box}>
        <h2 className="font-medium">Export</h2>
        <p className="mt-1 text-sm text-stone-500">
          Personen, Beziehungen und Bildzuordnungen als JSON. Das ZIP enthält
          zusätzlich die Bilddateien und eignet sich als vollständige Sicherung
          oder für den Umzug auf eine andere Instanz.
        </p>
        <div className="mt-3 flex gap-2">
          <a
            href="/api/export?format=zip"
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white transition hover:bg-stone-700"
          >
            ZIP mit Bildern
          </a>
          <a
            href="/api/export?format=json"
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Nur JSON
          </a>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-medium">Import</h2>
        {!canImport ? (
          <p className="mt-1 text-sm text-stone-500">
            Nur Administratoren können Daten einspielen.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-stone-500">
              JSON oder ZIP aus einem Export. Bestehende Einträge werden anhand
              ihrer ID erkannt und aktualisiert, unbekannte ergänzt.{" "}
              <strong className="font-medium">Nichts wird gelöscht.</strong>
            </p>

            <input
              type="file"
              accept=".json,.zip,application/json,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPlan(null);
                setApplied(false);
                setError(null);
              }}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
            />

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void send(false)}
                disabled={!file || busy}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                {busy ? "Prüfe…" : "Vorschau"}
              </button>
              <button
                onClick={() => void send(true)}
                disabled={!file || busy || !plan || applied}
                title={!plan ? "Erst die Vorschau ansehen" : undefined}
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white transition hover:bg-stone-700 disabled:opacity-50"
              >
                Import ausführen
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {plan && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-700 dark:bg-stone-900">
            <p className="mb-2 font-medium">
              {applied
                ? "Import abgeschlossen"
                : total === 0
                  ? "Es gibt nichts zu übernehmen"
                  : "Vorschau — noch nichts geändert"}
            </p>
            <ul className="space-y-0.5 text-stone-600 dark:text-stone-400">
              <li>
                Personen: {plan.persons.create} neu, {plan.persons.update}{" "}
                aktualisiert
              </li>
              <li>
                Beziehungen: {plan.relationships.create} neu,{" "}
                {plan.relationships.update} aktualisiert
              </li>
              <li>
                Bilder: {plan.media.create} neu, {plan.media.skip} bereits
                vorhanden
              </li>
            </ul>

            {plan.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-amber-700 dark:text-amber-500">
                {plan.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
                {plan.warnings.length > 8 && (
                  <li>… und {plan.warnings.length - 8} weitere</li>
                )}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
