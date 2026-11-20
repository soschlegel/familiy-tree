"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch } from "./api-client";

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

const field = "field";

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

  const [notice, setNotice] = useState<string | null>(null);

  async function call(url: string, init: RequestInit, success: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return false;
    }
    setNotice(success);
    router.refresh();
    return true;
  }

  async function createFamily(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call("/api/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }, `Familie „${name}“ angelegt.`);
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
    await call(`/api/families/${f.id}?force=true`, { method: "DELETE" }, `Familie „${f.name}“ gelöscht.`);
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
    }, "Zugriff gespeichert.");
  }

  return (
    <div className="space-y-8">
      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && <p className="alert-success">{notice}</p>}
      </div>

      {unassignedPersons > 0 && (
        <p className="alert-warning">
          {unassignedPersons} Person(en) sind keiner Familie zugeordnet und
          damit nur für Administratoren sichtbar. Die Zuordnung erfolgt auf der
          jeweiligen Personenseite —{" "}
          <a href="/research" className="underline">
            Liste unter Recherche → Ohne Familie
          </a>
          .
        </p>
      )}

      <section className="space-y-3">
        <h2 className="section-title">Familien</h2>

        <form onSubmit={createFamily} className="flex flex-wrap items-end gap-2" aria-label="Familie anlegen">
          <label htmlFor="new-family" className="sr-only">
            Name der neuen Familie
          </label>
          <input
            id="new-family"
            required
            placeholder="Name der Familie"
            className={`${field} w-full sm:w-64`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy} className="btn-primary">
            Anlegen
          </button>
        </form>

        {families.length === 0 ? (
          <p className="text-sm text-stone-500">
            Noch keine Familien angelegt.
          </p>
        ) : (
          <ul className="card divide-y divide-stone-200 overflow-hidden dark:divide-stone-800">
            {families.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-xs muted">
                  {f.personCount} Personen · {f.memberCount} Benutzer
                </span>
                <button
                  type="button"
                  onClick={() => void removeFamily(f)}
                  disabled={busy}
                  aria-label={`Familie ${f.name} löschen`}
                  className="btn-link-danger ml-auto"
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
            <h2 className="section-title">Zugriffe</h2>
            <p className="text-sm muted">
              Je Benutzer und Familie: kein Zugriff, nur lesen, oder bearbeiten.
              Administratoren sehen und ändern grundsätzlich alles.
            </p>
          </div>

          {/* Unter md je Benutzer ein Block mit den Familien als beschriftete
              Felder (zwei Spalten) statt einer seitlich verschiebbaren Tabelle. */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm max-md:block">
              <caption className="sr-only">Zugriffsrechte je Benutzer und Familie</caption>
              <thead className="border-b border-stone-200 text-left text-stone-600 max-md:hidden dark:border-stone-800 dark:text-stone-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Benutzer</th>
                  {families.map((f) => (
                    <th scope="col" key={f.id} className="whitespace-nowrap px-2 py-2 font-medium">
                      {f.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 max-md:block dark:divide-stone-800">
                {users.map((u) => (
                  <tr key={u.id} className="max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:p-3">
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal max-md:col-span-2 max-md:whitespace-normal max-md:break-words max-md:p-0 max-md:font-medium">
                      {u.name ?? u.email}
                      {u.isAdmin && (
                        <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] dark:bg-stone-700">
                          Admin
                        </span>
                      )}
                    </th>
                    {families.map((f) => (
                      <td
                        key={f.id}
                        data-label={f.name}
                        className="px-2 py-2 max-md:min-w-0 max-md:p-0 max-md:before:mb-1 max-md:before:block max-md:before:truncate max-md:before:text-xs max-md:before:font-medium max-md:before:text-stone-600 max-md:before:content-[attr(data-label)] dark:max-md:before:text-stone-400"
                      >
                        <select
                          className={`${field} max-md:w-full`}
                          aria-label={`Zugriff von ${u.name ?? u.email} auf ${f.name}`}
                          disabled={busy || u.isAdmin}
                          title={
                            u.isAdmin
                              ? "Administratoren haben ohnehin vollen Zugriff"
                              : undefined
                          }
                          value={u.isAdmin ? "ADMIN" : (u.roles[f.id] ?? "")}
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
                          {u.isAdmin && <option value="ADMIN">alles (Admin)</option>}
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

    </div>
  );
}
