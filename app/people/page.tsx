import Link from "next/link";

import { requireScope } from "@/lib/session";
import { editableFamilyIds } from "@/lib/scope";
import { searchPersons } from "@/lib/services";
import { lifeSpan } from "@/lib/tree-layout";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { scope } = await requireScope();
  const { q } = await searchParams;
  const needle = q?.trim();
  const canCreate = scope.isAdmin || editableFamilyIds(scope).length > 0;

  const { items: persons } = await searchPersons(scope, { q: needle });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Personen ({persons.length})</h1>
        {canCreate && (
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
                {p.primaryMediaId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/media/${p.primaryMediaId}?variant=thumb`}
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
                  {lifeSpan(p)}
                </span>
                <span className="ml-auto text-xs text-stone-400">
                  {p.relationCount} Beziehungen
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
