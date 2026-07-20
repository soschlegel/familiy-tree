"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  status: "INVITED" | "ACTIVE" | "BLOCKED";
  lastLoginAt: string | null;
};

const ROLE_LABEL: Record<Row["role"], string> = {
  ADMIN: "Administrator",
  EDITOR: "Bearbeiter",
  VIEWER: "Betrachter",
};

const STATUS_LABEL: Record<Row["status"], string> = {
  INVITED: "eingeladen",
  ACTIVE: "aktiv",
  BLOCKED: "gesperrt",
};

const field =
  "rounded border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

export function UserAdmin({
  users,
  currentUserId,
}: {
  users: Row[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Row["role"]>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (ok) setEmail("");
  }

  const patch = (id: string, data: Partial<Pick<Row, "role" | "status">>) =>
    call(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
        <input
          type="email"
          required
          placeholder="E-Mail einladen"
          className={`${field} w-64`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className={field}
          value={role}
          onChange={(e) => setRole(e.target.value as Row["role"])}
        >
          <option value="VIEWER">Betrachter</option>
          <option value="EDITOR">Bearbeiter</option>
          <option value="ADMIN">Administrator</option>
        </select>
        <button
          disabled={busy}
          className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
        >
          Einladen
        </button>
      </form>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800">
          <tr>
            <th className="py-2 font-normal">E-Mail</th>
            <th className="font-normal">Rolle</th>
            <th className="font-normal">Status</th>
            <th className="font-normal">Letzte Anmeldung</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <tr key={u.id}>
                <td className="py-2">
                  {u.email}
                  {self && (
                    <span className="ml-2 text-xs text-stone-400">(du)</span>
                  )}
                </td>
                <td>
                  <select
                    className={field}
                    value={u.role}
                    disabled={busy || self}
                    onChange={(e) =>
                      patch(u.id, { role: e.target.value as Row["role"] })
                    }
                  >
                    {Object.entries(ROLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span
                    className={
                      u.status === "BLOCKED"
                        ? "text-red-600"
                        : u.status === "ACTIVE"
                          ? "text-emerald-600"
                          : "text-stone-500"
                    }
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>
                <td className="text-stone-500">
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString("de-DE")
                    : "nie"}
                </td>
                <td className="text-right">
                  {!self && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        patch(u.id, {
                          status: u.status === "BLOCKED" ? "ACTIVE" : "BLOCKED",
                        })
                      }
                      className="text-xs hover:underline"
                    >
                      {u.status === "BLOCKED" ? "entsperren" : "sperren"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
