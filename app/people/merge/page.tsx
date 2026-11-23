import Link from "next/link";

import { requireScope } from "@/lib/session";
import { MergeView } from "@/components/MergeView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personen zusammenführen" };

/**
 * Zwei Einträge derselben Person zusammenführen: /people/merge?keep=…&other=….
 * Rechte und Sichtbarkeit prüft der Dienst (unsichtbar = nicht gefunden).
 */
export default async function MergePage({ searchParams }: { searchParams: Promise<{ keep?: string; other?: string }> }) {
  await requireScope();
  const { keep, other } = await searchParams;
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Dubletten</p>
        <h1 className="page-title">Personen zusammenführen</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Zwei Einträge derselben Person werden einer. Wähle je Angabe, welcher Wert gilt — der andere bleibt als
          Zweitangabe bzw. Namensvariante erhalten. Belege, Ereignisse, Bilder, Beziehungen und die Herkunft aus
          Importen ziehen mit um.
        </p>
      </div>
      {keep && other ? (
        <MergeView key={`${keep}:${other}`} keepId={keep} otherId={other} />
      ) : (
        <p className="alert-info">
          Bitte zwei Personen wählen — über <Link href="/research/duplicates" className="underline">Mögliche Dubletten</Link> oder
          auf einer Personenseite mit dem Knopf „Zusammenführen …“.
        </p>
      )}
    </div>
  );
}
