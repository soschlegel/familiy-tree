"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

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

const STATUS_CLASS: Record<Row["status"], string> = {
  INVITED: "badge",
  ACTIVE: "badge-accent",
  BLOCKED:
    "badge border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call("/api/users", jsonBody("POST", { email, role }), `${email} eingeladen.`);
    if (ok) setEmail("");
  }

  const patch = (id: string, data: Partial<Pick<Row, "role" | "status">>, success: string) =>
    call(`/api/users/${id}`, jsonBody("PATCH", data), success);

  return (
    <div className="space-y-4">
      <form
        onSubmit={invite}
        aria-label="Benutzer einladen"
        className="card flex flex-wrap items-end gap-3 p-3"
      >
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="invite-email" className="field-label">
            E-Mail-Adresse
          </label>
          <input
            id="invite-email"
            type="email"
            required
            placeholder="name@example.org"
            className="field w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="invite-role" className="field-label">
            Rolle
          </label>
          <select
            id="invite-role"
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as Row["role"])}
          >
            <option value="VIEWER">Betrachter</option>
            <option value="EDITOR">Bearbeiter</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </div>
        <button disabled={busy} className="btn-primary">
          {busy ? "Speichert…" : "Einladen"}
        </button>
      </form>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && <p className="alert-success">{notice}</p>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Benutzer</caption>
          <thead className="border-b border-stone-200 text-left text-stone-600 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">E-Mail</th>
              <th scope="col" className="px-2 font-medium">Rolle</th>
              <th scope="col" className="px-2 font-medium">Status</th>
              <th scope="col" className="px-2 font-medium">Letzte Anmeldung</th>
              <th scope="col">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {users.map((u) => {
              const self = u.id === currentUserId;
              const blocking = u.status !== "BLOCKED";
              return (
                <tr key={u.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {u.email}
                    {self && <span className="ml-2 text-xs muted">(du)</span>}
                  </td>
                  <td className="px-2">
                    <select
                      className="field"
                      aria-label={`Rolle von ${u.email}`}
                      value={u.role}
                      disabled={busy || self}
                      onChange={(e) =>
                        void patch(
                          u.id,
                          { role: e.target.value as Row["role"] },
                          `Rolle von ${u.email} geändert.`,
                        )
                      }
                    >
                      {Object.entries(ROLE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2">
                    <span className={STATUS_CLASS[u.status]}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 muted">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("de-DE") : "nie"}
                  </td>
                  <td className="px-3 text-right">
                    {!self && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            blocking &&
                            !confirm(`${u.email} sperren? Die Anmeldung ist danach nicht mehr möglich.`)
                          )
                            return;
                          void patch(
                            u.id,
                            { status: blocking ? "BLOCKED" : "ACTIVE" },
                            blocking ? `${u.email} gesperrt.` : `${u.email} entsperrt.`,
                          );
                        }}
                        className={blocking ? "btn-link-danger" : "btn-link"}
                      >
                        {blocking ? "sperren" : "entsperren"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
