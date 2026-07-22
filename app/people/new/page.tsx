import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { PersonForm } from "@/components/PersonForm";

export const dynamic = "force-dynamic";

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Person anlegen</h1>
      <PersonForm families={families} />
    </div>
  );
}
