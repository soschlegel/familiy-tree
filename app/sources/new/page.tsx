import Link from "next/link";
import { redirect } from "next/navigation";

import { requireScope } from "@/lib/session";
import { canCreateSources } from "@/lib/services";
import { SourceForm } from "@/components/SourceForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quelle anlegen" };

export default async function NewSourcePage() {
  const { scope } = await requireScope();
  // Quellen anlegen darf, wer in mindestens einer Familie bearbeiten darf.
  if (!canCreateSources(scope)) redirect("/sources");

  return (
    <div className="space-y-5">
      <Link href="/sources" className="btn-link text-sm">
        ← Alle Quellen
      </Link>
      <div>
        <p className="eyebrow">Neu im Archiv</p>
        <h1 className="page-title">Quelle anlegen</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Belege für einzelne Angaben — Geburt, Tod, Heirat — kommen danach auf der Personenseite unter
          „Quellen“ dazu. Bis dahin sehen nur du und Administratoren diese Quelle.
        </p>
      </div>
      <SourceForm />
    </div>
  );
}
