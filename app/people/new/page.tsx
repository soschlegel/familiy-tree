import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { PersonForm } from "@/components/PersonForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person anlegen" };

export default async function NewPersonPage() {
  const { scope } = await requireScope();

  const editable = editableFamilyIds(scope);
  // Ohne Bearbeitungsrecht in wenigstens einer Familie gäbe es keine Familie,
  // der die neue Person zugeordnet werden könnte.
  if (!scope.isAdmin && editable.length === 0) redirect("/tree?denied=1");

  const families = await prisma.family.findMany({
    where: scope.isAdmin ? undefined : { id: { in: editable } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Neu im Archiv</p>
        <h1 className="page-title">Person anlegen</h1>
        <p className="mt-1 text-sm muted">
          Eltern, Kinder und Partner kommen danach auf der Personenseite dazu.
        </p>
      </div>
      <PersonForm families={families} />
    </div>
  );
}
