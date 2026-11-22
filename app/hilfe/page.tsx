import Link from "next/link";

import { requirePage } from "@/lib/session";
import { listHelpTopics } from "@/lib/help/content";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hilfe" };

/**
 * Anwender-Hilfe: Themenliste. Die Texte stehen als Markdown in
 * docs/anwender/ (je Thema eine Datei, Reihenfolge nach der Nummer im
 * Dateinamen) und werden serverseitig gelesen — siehe lib/help/.
 */
export default async function HelpIndexPage() {
  await requirePage();
  const topics = listHelpTopics();

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Hilfe</p>
        <h1 className="page-title">So funktioniert der Stammbaum</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Erklärungen für alle, die mit dem Stammbaum arbeiten — ohne Technik. Wähle ein Thema. An vielen Stellen der App
          führt dich außerdem ein kleines „?“ bzw. „Wie funktioniert das?“ direkt zur passenden Erklärung.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2" data-testid="help-topics">
        {topics.map((t) => (
          <li key={t.slug} className="card transition hover:border-accent-300 hover:shadow-lift dark:hover:border-accent-700">
            <Link href={`/hilfe/${t.slug}`} className="block h-full p-4" data-testid="help-topic-link">
              <span className="block font-serif text-lg font-semibold">{t.title}</span>
              <span className="mt-1 block text-sm muted">{t.summary}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
