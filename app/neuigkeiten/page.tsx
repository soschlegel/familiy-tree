import { requirePage } from "@/lib/session";
import { releaseNotes } from "@/lib/release-notes-data";
import { ReleaseNoteList } from "@/components/ReleaseNoteList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neuigkeiten" };

/**
 * Neuigkeiten: alle Releases aus CHANGELOG.md, neueste zuerst
 * (docs/entwicklung/neuigkeiten.md). Nur für Angemeldete — wie die genaue
 * Build-Angabe geht der
 * Stand der App Fremde nichts an. Nicht zu verwechseln mit den Änderungen an
 * den Daten (`/admin/changes`).
 */
export default async function NewsPage() {
  await requirePage();
  const releases = releaseNotes();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">Neuigkeiten</h1>
        <p className="mt-1 text-sm muted">
          Was sich mit den neuen Versionen des Stammbaums geändert hat — die neueste zuerst.
        </p>
      </div>
      {releases.length === 0 ? (
        <p className="text-sm muted">Noch keine Neuigkeiten.</p>
      ) : (
        <div className="card p-5">
          <ReleaseNoteList releases={releases} />
        </div>
      )}
    </div>
  );
}
