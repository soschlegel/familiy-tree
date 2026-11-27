"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ExportFamilyOverview, ExportPersonCard } from "@/lib/export-selection";

import { apiFetch } from "./api-client";
import { GedcomExportDialog } from "./GedcomExportDialog";

type Plan = {
  persons: { create: number; update: number };
  relationships: { create: number; update: number };
  media: { create: number; skip: number; withoutFile: number };
  sources?: { create: number; update: number };
  citations?: { create: number; update: number };
  // Austauschformat 3: Lebensereignisse und weitere Namen (ältere Server liefern sie nicht).
  events?: { create: number; update: number };
  personNames?: { create: number; update: number };
  warnings: string[];
};

const box = "card p-5";

export function DataTransfer({
  canImport,
  gedcomOverview,
  gedcomSelf = null,
  gedcomPerson = null,
}: {
  canImport: boolean;
  gedcomOverview: ExportFamilyOverview;
  /** Eigene Person für die Vorbelegung „Ab einer Person“. */
  gedcomSelf?: ExportPersonCard | null;
  /** Einstieg von der Personenseite: Dialog gleich mit dieser Person öffnen. */
  gedcomPerson?: ExportPersonCard | null;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(apply: boolean) {
    if (!file || busy) return;
    if (apply && !confirm("Import jetzt ausführen? Bestehende Einträge mit gleicher ID werden überschrieben.")) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);

    const res = await apiFetch<{ plan: Plan }>(`/api/import?apply=${apply}`, {
      method: "POST",
      body: form,
    });

    setBusy(false);

    if (!res.ok) {
      setError(res.message);
      setPlan(null);
      return;
    }

    setPlan(res.data.plan);
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
      plan.media.create +
      (plan.sources?.create ?? 0) +
      (plan.sources?.update ?? 0) +
      (plan.citations?.create ?? 0) +
      (plan.citations?.update ?? 0) +
      (plan.events?.create ?? 0) +
      (plan.events?.update ?? 0) +
      (plan.personNames?.create ?? 0) +
      (plan.personNames?.update ?? 0)
    : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
      <section className={box}>
        <h2 className="section-title">Export</h2>
        <p className="mt-1 text-sm muted">
          Personen, Beziehungen, Quellen mit Belegen und Bildzuordnungen als JSON. Das ZIP enthält
          zusätzlich die Bilddateien und eignet sich als vollständige Sicherung
          oder für den Umzug auf eine andere Instanz.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/export?format=zip" className="btn-primary">
            ZIP mit Bildern
          </a>
          <a href="/api/export?format=json" className="btn-secondary">
            Nur JSON
          </a>
        </div>
        <p className="mt-4 text-sm muted">
          GEDCOM 5.5.1 für andere Stammbaumprogramme — mit Ereignissen, Namen, Quellen und Belegen; beim Import
          aufbewahrte Zusatzangaben (z.B. von MyHeritage) werden zurückgeschrieben. Vor dem Herunterladen lassen sich die
          Familien wählen — oder eine Person mit ihren Vorfahren. Ob MyHeritage, Gramps oder Ancestry die Datei vollständig übernehmen, ist noch nicht ausprobiert.
        </p>
        <GedcomExportDialog overview={gedcomOverview} self={gedcomSelf} initialPerson={gedcomPerson} />
      </section>

      <section className={box}>
        <h2 className="section-title">Import</h2>
        {!canImport ? (
          <p className="mt-1 text-sm muted">
            Nur Administratoren können Daten einspielen.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm muted">
              JSON oder ZIP aus einem Export. Bestehende Einträge werden anhand
              ihrer ID erkannt und aktualisiert, unbekannte ergänzt.{" "}
              <strong className="font-medium">Nichts wird gelöscht.</strong>
            </p>

            <label htmlFor="import-file" className="field-label mt-3">
              Exportdatei (JSON oder ZIP)
            </label>
            <input
              id="import-file"
              type="file"
              accept=".json,.zip,application/json,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPlan(null);
                setApplied(false);
                setError(null);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-surface file:px-3 file:py-1.5 file:text-sm max-md:file:min-h-11 dark:file:border-stone-700 dark:file:text-stone-100"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void send(false)}
                disabled={!file || busy}
                className="btn-secondary"
              >
                {busy ? "Prüfe…" : "Vorschau der JSON/ZIP-Datei"}
              </button>
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={!file || busy || !plan || applied}
                title={!plan ? "Erst die Vorschau ansehen" : undefined}
                className="btn-primary"
              >
                Import ausführen
              </button>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="alert-error mt-3">
            {error}
          </p>
        )}

        {plan && (
          <div role="status" className={`mt-3 text-sm ${applied ? "alert-success" : "alert-info"}`}>
            <p className="mb-2 font-medium">
              {applied
                ? "Import abgeschlossen"
                : total === 0
                  ? "Es gibt nichts zu übernehmen"
                  : "Vorschau — noch nichts geändert"}
            </p>
            <ul className="space-y-0.5">
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
              {plan.events && (
                <li>
                  Lebensereignisse: {plan.events.create} neu, {plan.events.update} aktualisiert
                </li>
              )}
              {plan.personNames && (
                <li>
                  Weitere Namen: {plan.personNames.create} neu, {plan.personNames.update} aktualisiert
                </li>
              )}
              {plan.sources && (
                <li>
                  Quellen: {plan.sources.create} neu, {plan.sources.update} aktualisiert
                </li>
              )}
              {plan.citations && (
                <li>
                  Belege: {plan.citations.create} neu, {plan.citations.update} aktualisiert
                </li>
              )}
            </ul>

            {plan.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-brass-700 dark:text-brass-300">
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
