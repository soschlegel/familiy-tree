import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireScope } from "@/lib/session";
import { getSource, listScanCandidates } from "@/lib/services";
import { toDateInput, toFuzzyDate } from "@/lib/dates";
import { SourceForm } from "@/components/SourceForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quelle bearbeiten" };

export default async function EditSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { scope } = await requireScope();
  const { id } = await params;
  const detail = await getSource(scope, id);
  if (!detail) notFound();
  if (!detail.canEdit) redirect(`/sources/${id}`);

  const s = detail.source;
  const scanCandidates = await listScanCandidates(scope, id);

  return (
    <div className="space-y-5">
      <Link href={`/sources/${id}`} className="btn-link text-sm">
        ← Zurück zur Quelle
      </Link>
      <div>
        <p className="eyebrow">Bearbeiten</p>
        <h1 className="page-title">{s.title}</h1>
      </div>
      <SourceForm
        initial={{
          id: s.id,
          title: s.title,
          kind: s.kind,
          author: s.author ?? "",
          repository: s.repository ?? "",
          callNumber: s.callNumber ?? "",
          url: s.url ?? "",
          date: toDateInput(toFuzzyDate(s.date, s.datePrecision, s.dateQualifier)),
          notes: s.notes ?? "",
          mediaId: s.mediaId ?? "",
        }}
        scanCandidates={scanCandidates}
      />
    </div>
  );
}
