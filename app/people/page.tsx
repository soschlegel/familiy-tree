import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/lib/session";
import { can } from "@/lib/authz";
import { lifeSpan } from "@/lib/tree-layout";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePage("person:read");
  const { q } = await searchParams;
  const needle = q?.trim();

  const persons = await prisma.person.findMany({
    where: needle
      ? {
          OR: [
            { givenName: { contains: needle, mode: "insensitive" } },
            { familyName: { contains: needle, mode: "insensitive" } },
            { birthName: { contains: needle, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    include: {
      media: { where: { isPrimary: true }, take: 1, select: { mediaId: true } },
      _count: { select: { relationsFrom: true, relationsTo: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Personen ({persons.length})</h1>
        {can(session.user.role, "person:create") && (
          <Link
            href="/people/new"
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
          >
            Person anlegen
          </Link>
        )}
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={needle}
          placeholder="Name suchen…"
          className="w-64 rounded border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
        <button className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">
          Suchen
        </button>
      </form>

      {persons.length === 0 ? (
        <p className="text-stone-500">Keine Person gefunden.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {persons.map((p) => (
            <li key={p.id}>
              <Link
                href={`/people/${p.id}`}
                className="flex items-center gap-3 px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                {p.media[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/media/${p.media[0].mediaId}?variant=thumb`}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-stone-200 dark:bg-stone-700" />
                )}
                <span className="font-medium">
                  {[p.givenName, p.familyName].filter(Boolean).join(" ")}
                </span>
                <span className="text-sm text-stone-500">
                  {lifeSpan({
                    birthDate: p.birthDate?.toISOString() ?? null,
                    deathDate: p.deathDate?.toISOString() ?? null,
                  })}
                </span>
                <span className="ml-auto text-xs text-stone-400">
                  {p._count.relationsFrom + p._count.relationsTo} Beziehungen
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
