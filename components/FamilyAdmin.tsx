"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Family = {
  id: string;
  name: string;
  description: string | null;
  personCount: number;
  memberCount: number;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  roles: Record<string, "EDITOR" | "VIEWER">;
};

const field =
  "rounded-lg border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

export function FamilyAdmin({
  families,
  users,
  unassignedPersons,
}: {
  families: Family[];
  users: UserRow[];
  unassignedPersons: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Fehler ${res.status}`);
      return false;
    }
    router.refresh();
    return true;
  }

  async function createFamily(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call("/api/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (ok) setName("");
  }

  async function removeFamily(f: Family) {
    const attached = f.personCount + f.memberCount;
    const warning =
      attached > 0
        ? `An „${f.name}" hängen ${f.personCount} Person(en) und ${f.memberCount} Benutzerzuordnung(en).\n\n` +
          `Personen, die danach zu keiner Familie mehr gehören, sind nur noch für Administratoren sichtbar.\n\nTrotzdem löschen?`
        : `Familie „${f.name}" löschen?`;
    if (!confirm(warning)) return;
    await call(`/api/families/${f.id}?force=true`, { method: "DELETE" });
  }

  function setRole(
    userId: string,
    familyId: string,
    role: "EDITOR" | "VIEWER" | null,
  ) {
    return call(`/api/families/${familyId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
  }

  return (
    <div className="space-y-8">
      {unassignedPersons > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {unassignedPersons} Person(en) sind keiner Familie zugeordnet und
          damit nur für Administratoren sichtbar. Die Zuordnung erfolgt auf der
          jeweiligen Personenseite.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">Familien</h2>

        <form onSubmit={createFamily} className="flex gap-2">
          <input
            required
            placeholder="Name der Familie"
            className={`${field} w-64`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            disabled={busy}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white transition hover:bg-stone-700 disabled:opacity-50"
          >
            Anlegen
          </button>
        </form>

        {families.length === 0 ? (
          <p className="text-sm text-stone-500">
            Noch keine Familien angelegt.
          </p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {families.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-stone-500">
                  {f.personCount} Personen · {f.memberCount} Benutzer
                </span>
                <button
                  onClick={() => removeFamily(f)}
                  disabled={busy}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  löschen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {families.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">Zugriffe</h2>
            <p className="text-sm text-stone-500">
              Je Benutzer und Familie: kein Zugriff, nur lesen, oder bearbeiten.
              Administratoren sehen und ändern grundsätzlich alles.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800">
                <tr>
                  <th className="py-2 pr-4 font-normal">Benutzer</th>
                  {families.map((f) => (
                    <th key={f.id} className="px-2 py-2 font-normal">
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-4">
                      {u.name ?? u.email}
                      {u.isAdmin && (
                        <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] dark:bg-stone-700">
                          Admin
                        </span>
                      )}
                    </td>
                    {families.map((f) => (
                      <td key={f.id} className="px-2 py-2">
                        <select
                          className={field}
                          disabled={busy || u.isAdmin}
                          title={
                            u.isAdmin
                              ? "Administratoren haben ohnehin vollen Zugriff"
                              : undefined
                          }
                          value={u.roles[f.id] ?? ""}
                          onChange={(e) =>
                            setRole(
                              u.id,
                              f.id,
                              e.target.value === ""
                                ? null
                                : (e.target.value as "EDITOR" | "VIEWER"),
                            )
                          }
                        >
                          <option value="">kein Zugriff</option>
                          <option value="VIEWER">lesen</option>
                          <option value="EDITOR">bearbeiten</option>
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
