"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";
import { ApiTokenList, useHistoryToggle } from "./ApiTokenList";
import { PersonPicker, type PickerPerson } from "./PersonPicker";
import {
  AI_ACCESS_LABEL,
  aiRank,
  countKeys,
  deleteTokenQuestion,
  type AiAccessLevel,
  type TokenRow,
} from "./ai-access-labels";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  status: "INVITED" | "ACTIVE" | "BLOCKED";
  lastLoginAt: string | null;
  aiAccess: AiAccessLevel;
  /** Nicht widerrufene, nicht abgelaufene KI-Schlüssel. */
  activeTokens: number;
  /** Zahl der Familienzuordnungen (für die Rückfrage beim Löschen). */
  familyCount: number;
  /** Eingeladen, nie angemeldet, kein verknüpftes Konto: E-Mail darf korrigiert werden. */
  neverSignedIn: boolean;
  /** Einziger aktiver Admin — darf weder gelöscht noch herabgestuft werden. */
  lastAdmin: boolean;
  /** Eigene Person („das bin ich“, README „Bezugsperson“). */
  person: { id: string; name: string } | null;
};

/** Was beim Löschen mitgeht — nach den onDelete-Regeln in prisma/schema.prisma. */
function deleteQuestion(u: Row): string {
  const gone = [
    u.familyCount > 0 ? `${u.familyCount === 1 ? "die Zuordnung zu einer Familie" : `die Zuordnungen zu ${u.familyCount} Familien`}` : null,
    "alle KI-Schlüssel",
    "die Anmeldungen (Sitzungen und verknüpfte Google-/GitHub-Konten)",
  ].filter(Boolean);
  return (
    `${u.email} endgültig löschen?\n\n` +
    `Gelöscht werden auch ${gone.join(", ")}.\n` +
    "Protokolleinträge, hochgeladene Bilder, angelegte Quellen und Importläufe bleiben erhalten — " +
    "nur ohne Verweis auf diesen Benutzer. Eine erneute Anmeldung ist erst nach einer neuen Einladung möglich."
  );
}

/** Was eine Änderung des KI-Rechts für vorhandene Schlüssel bedeutet. */
function aiAccessEffect(from: AiAccessLevel, to: AiAccessLevel, keys: number): string {
  if (keys === 0 || aiRank(to) >= aiRank(from)) return "";
  if (to === "NONE") return " Die vorhandenen Schlüssel funktionieren ab sofort nicht mehr.";
  return " Schlüssel mit Schreibrecht wirken ab sofort nur noch lesend.";
}

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
  people = [],
  initialShowHistory = false,
}: {
  users: Row[];
  currentUserId: string;
  /** Auswahl für „Person zuordnen“. */
  people?: PickerPerson[];
  /** Verlauf der KI-Schlüssel (widerrufen/abgelaufen) eingeblendet — aus `?verlauf=1`. */
  initialShowHistory?: boolean;
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

  // --- Löschen und E-Mail korrigieren --------------------------------------
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");

  async function removeUser(u: Row) {
    if (!confirm(deleteQuestion(u))) return;
    await call(`/api/users/${u.id}`, { method: "DELETE" }, `${u.email} gelöscht.`);
  }

  async function saveEmail(e: React.FormEvent, u: Row) {
    e.preventDefault();
    const ok = await call(
      `/api/users/${u.id}`,
      jsonBody("PATCH", { email: newEmail }),
      `E-Mail-Adresse von ${u.email} in ${newEmail.trim().toLowerCase()} geändert.`,
    );
    if (ok) setEditingEmail(null);
  }

  // --- Eigene Person („das bin ich“) ---------------------------------------
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [pickedPerson, setPickedPerson] = useState("");

  async function savePerson(u: Row, personId: string | null) {
    const name = personId ? (people.find((p) => p.id === personId) ?? null) : null;
    const ok = await call(
      `/api/users/${u.id}`,
      jsonBody("PATCH", { personId }),
      personId
        ? `${u.email} ist jetzt ${name ? [name.givenName, name.familyName].filter(Boolean).join(" ") : "zugeordnet"}.`
        : `Zuordnung von ${u.email} aufgehoben.`,
    );
    if (ok) setEditingPerson(null);
  }

  // --- KI-Zugang -----------------------------------------------------------
  const [openKeys, setOpenKeys] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, TokenRow[] | "loading" | "error">>({});
  // Ein Schalter für alle aufgeklappten Schlüssellisten, gemerkt in der Adresse.
  const [showHistory, setShowHistory] = useHistoryToggle(initialShowHistory);

  async function loadKeys(userId: string) {
    setKeys((k) => ({ ...k, [userId]: "loading" }));
    const res = await apiFetch<{ tokens: TokenRow[] }>(
      `/api/ai-tokens?all=1&userId=${encodeURIComponent(userId)}`,
    );
    setKeys((k) => ({ ...k, [userId]: res.ok ? res.data.tokens : "error" }));
    if (!res.ok) setError(res.message);
  }

  function toggleKeys(userId: string) {
    if (openKeys === userId) {
      setOpenKeys(null);
      return;
    }
    setOpenKeys(userId);
    void loadKeys(userId);
  }

  async function setAiAccess(u: Row, to: AiAccessLevel) {
    if (to === u.aiAccess) return;
    if (
      to === "NONE" &&
      !confirm(
        `KI-Zugang von ${u.email} entziehen?` +
          (u.activeTokens > 0
            ? `\n\n${countKeys(u.activeTokens)} funktionieren dann sofort nicht mehr. ` +
              "Sie bleiben gespeichert und wirken wieder, falls der Zugang erneut vergeben wird — " +
              "wer das nicht will, widerruft sie zusätzlich."
            : "")
      )
    )
      return;
    const ok = await call(
      `/api/users/${u.id}/ai-access`,
      jsonBody("PUT", { aiAccess: to }),
      `KI-Zugang von ${u.email}: ${AI_ACCESS_LABEL[to]}.${aiAccessEffect(u.aiAccess, to, u.activeTokens)}`,
    );
    // Wirksame Stufen in einer offenen Schlüsselliste neu darstellen.
    if (ok && openKeys === u.id) void loadKeys(u.id);
  }

  async function revokeKey(u: Row, t: TokenRow) {
    if (!confirm(`Schlüssel „${t.name}“ (${t.prefix}…) von ${u.email} widerrufen? Er funktioniert danach sofort nicht mehr.`))
      return;
    const ok = await call(
      `/api/ai-tokens/${t.id}`,
      { method: "DELETE" },
      `Schlüssel „${t.name}“ von ${u.email} widerrufen.`,
    );
    if (ok) void loadKeys(u.id);
  }

  async function deleteKey(u: Row, t: TokenRow) {
    if (!confirm(deleteTokenQuestion(t, u.email))) return;
    await call(`/api/ai-tokens/${t.id}?endgueltig=1`, { method: "DELETE" }, `Schlüssel „${t.name}“ von ${u.email} gelöscht.`);
    // Auch nach einer Ablehnung (z.B. inzwischen benutzt) den aktuellen Stand zeigen.
    void loadKeys(u.id);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={invite}
        aria-label="Benutzer einladen"
        className="card flex flex-wrap items-end gap-3 p-3 max-sm:[&>div]:grow max-sm:[&_.field]:w-full"
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

      {/* relative: hält die absolut positionierte sr-only-Beschriftung im
          Scrollbereich — sonst verbreitert sie auf dem Telefon die Seite.
          Unter md wird aus jeder Zeile ein Block (E-Mail, darunter Rolle und
          Status, Anmeldung, KI-Zugang, Aktionen) statt einer Tabelle, die
          seitlich geschoben werden muss. */}
      <div className="card relative overflow-x-auto">
        <table className="w-full text-sm max-md:block">
          <caption className="sr-only">Benutzer</caption>
          <thead className="max-md:hidden border-b border-stone-200 text-left text-stone-600 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">E-Mail</th>
              <th scope="col" className="px-2 font-medium">Rolle</th>
              <th scope="col" className="px-2 font-medium">Status</th>
              <th scope="col" className="px-2 font-medium">Letzte Anmeldung</th>
              <th scope="col" className="px-2 font-medium">KI-Zugang</th>
              <th scope="col">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 max-md:block dark:divide-stone-800">
            {users.map((u) => {
              const self = u.id === currentUserId;
              const blocking = u.status !== "BLOCKED";
              const open = openKeys === u.id;
              const list = keys[u.id];
              return (
                <Fragment key={u.id}>
                <tr data-testid="user-row" data-email={u.email} className="max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:p-3">
                  <td className="whitespace-nowrap px-3 py-2 max-md:basis-full max-md:whitespace-normal max-md:break-all max-md:p-0 max-md:font-medium">
                    {u.email}
                    {self && <span className="ml-2 text-xs muted">(du)</span>}
                    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs font-normal" data-testid="user-person">
                      <span className="muted">Person:</span>
                      {u.person ? (
                        <Link href={`/people/${u.person.id}`} className="underline underline-offset-2">
                          {u.person.name}
                        </Link>
                      ) : (
                        <span className="muted">keine</span>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="btn-link"
                        aria-expanded={editingPerson === u.id}
                        aria-controls={`person-edit-${u.id}`}
                        data-testid="user-person-edit"
                        onClick={() => {
                          setEditingPerson(editingPerson === u.id ? null : u.id);
                          setPickedPerson(u.person?.id ?? "");
                        }}
                      >
                        {u.person ? "ändern" : "zuordnen"}
                        <span className="sr-only"> (Person von {u.email})</span>
                      </button>
                    </span>
                  </td>
                  <td className="px-2 max-md:px-0">
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
                  <td className="px-2 max-md:px-0">
                    <span className={STATUS_CLASS[u.status]}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 muted max-md:basis-full max-md:px-0 max-md:before:content-['Letzte_Anmeldung:_']">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("de-DE") : "nie"}
                  </td>
                  <td className="px-2 max-md:basis-full max-md:px-0 max-md:before:mb-1 max-md:before:block max-md:before:text-xs max-md:before:font-medium max-md:before:text-stone-600 max-md:before:content-['KI-Zugang'] dark:max-md:before:text-stone-400">
                    <div className="flex items-center gap-2 max-md:gap-4">
                      <select
                        className="field"
                        aria-label={`KI-Zugang von ${u.email}`}
                        value={u.aiAccess}
                        disabled={busy}
                        onChange={(e) => void setAiAccess(u, e.target.value as AiAccessLevel)}
                      >
                        {(Object.keys(AI_ACCESS_LABEL) as AiAccessLevel[]).map((value) => (
                          <option key={value} value={value}>
                            {AI_ACCESS_LABEL[value]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-link whitespace-nowrap"
                        aria-expanded={open}
                        aria-controls={`ai-keys-${u.id}`}
                        data-testid="user-ai-keys-toggle"
                        onClick={() => toggleKeys(u.id)}
                      >
                        <span className="sr-only">{`Schlüssel von ${u.email}: ${u.activeTokens} aktiv`}</span>
                        <span aria-hidden>
                          Schlüssel: {u.activeTokens} aktiv {open ? "▴" : "▾"}
                        </span>
                      </button>
                    </div>
                  </td>
                  <td className="px-3 text-right max-md:basis-full max-md:px-0 max-md:py-1 max-md:text-left">
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 whitespace-nowrap max-md:justify-start max-md:gap-x-5">
                    {!self && u.neverSignedIn && (
                      <button
                        type="button"
                        disabled={busy}
                        className="btn-link"
                        aria-expanded={editingEmail === u.id}
                        aria-controls={`email-edit-${u.id}`}
                        onClick={() => {
                          setEditingEmail(editingEmail === u.id ? null : u.id);
                          setNewEmail(u.email);
                        }}
                      >
                        E-Mail ändern<span className="sr-only"> von {u.email}</span>
                      </button>
                    )}
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
                    <button
                      type="button"
                      disabled={busy || self || u.lastAdmin}
                      className="btn-link-danger"
                      aria-label={`${u.email} löschen`}
                      aria-describedby={self || u.lastAdmin ? `delete-why-${u.id}` : undefined}
                      onClick={() => void removeUser(u)}
                    >
                      löschen
                    </button>
                    {(self || u.lastAdmin) && (
                      <span id={`delete-why-${u.id}`} className="text-xs muted" data-testid="user-delete-why">
                        {self ? "eigener Zugang" : "letzter aktiver Admin"}
                      </span>
                    )}
                    </div>
                  </td>
                </tr>
                {editingEmail === u.id && (
                  <tr id={`email-edit-${u.id}`} data-testid="user-email-edit" className="max-md:block">
                    <td colSpan={6} className="bg-stone-50/70 px-3 py-3 max-md:block dark:bg-stone-900/40">
                      <form
                        onSubmit={(e) => void saveEmail(e, u)}
                        aria-label={`Adresse von ${u.email} korrigieren`}
                        className="sticky left-3 flex w-[min(40rem,calc(100vw-4.5rem))] flex-wrap items-end gap-2"
                      >
                        <div className="min-w-0 flex-1 basis-56">
                          <label htmlFor={`email-new-${u.id}`} className="field-label">
                            Neue E-Mail-Adresse
                          </label>
                          <input
                            id={`email-new-${u.id}`}
                            type="email"
                            required
                            className="field w-full"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                          />
                        </div>
                        <button disabled={busy} className="btn-primary">
                          {busy ? "Speichert…" : "Speichern"}
                        </button>
                        <button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditingEmail(null)}>
                          Abbrechen
                        </button>
                        <p className="basis-full text-xs muted">
                          Möglich, solange sich der Benutzer noch nie angemeldet hat. Familien, Rolle und KI-Zugang bleiben.
                        </p>
                      </form>
                    </td>
                  </tr>
                )}
                {editingPerson === u.id && (
                  <tr id={`person-edit-${u.id}`} data-testid="user-person-form" className="max-md:block">
                    <td colSpan={6} className="bg-stone-50/70 px-3 py-3 max-md:block dark:bg-stone-900/40">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (pickedPerson) void savePerson(u, pickedPerson);
                        }}
                        aria-label={`Person von ${u.email} zuordnen`}
                        className="sticky left-3 flex w-[min(40rem,calc(100vw-4.5rem))] flex-wrap items-end gap-2"
                      >
                        <div className="min-w-0 flex-1 basis-56">
                          <span id={`person-label-${u.id}`} className="field-label">
                            Das ist {u.email}
                          </span>
                          <PersonPicker
                            people={people}
                            value={pickedPerson}
                            onChange={setPickedPerson}
                            labelledBy={`person-label-${u.id}`}
                          />
                        </div>
                        <button disabled={busy || !pickedPerson} className="btn-primary">
                          {busy ? "Speichert…" : "Speichern"}
                        </button>
                        {u.person && (
                          <button type="button" disabled={busy} className="btn-secondary" onClick={() => void savePerson(u, null)}>
                            Zuordnung aufheben
                          </button>
                        )}
                        <button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditingPerson(null)}>
                          Abbrechen
                        </button>
                        <p className="basis-full text-xs muted">
                          Bezugsperson des Benutzers: Baum und Personenseiten zeigen den Verwandtschaftsgrad zu ihr.
                          Jeder kann das auf einer Personenseite auch selbst mit „Das bin ich“ festlegen.
                        </p>
                      </form>
                    </td>
                  </tr>
                )}
                {open && (
                  <tr id={`ai-keys-${u.id}`} data-testid="user-ai-keys" className="max-md:block">
                    <td colSpan={6} className="bg-stone-50/70 px-3 py-3 max-md:block dark:bg-stone-900/40">
                      {/* sticky + feste Breite: bleibt auf dem Telefon im
                          sichtbaren Teil, auch wenn die Tabelle seitlich
                          gescrollt ist. */}
                      <div className="sticky left-3 w-[min(48rem,calc(100vw-4.5rem))]">
                      <p className="mb-2 text-xs font-medium text-stone-600 dark:text-stone-400">
                        KI-Schlüssel von {u.email}
                      </p>
                      {list === "loading" || list === undefined ? (
                        <p className="text-sm muted">Lädt…</p>
                      ) : list === "error" ? (
                        <p className="text-sm muted">Schlüssel konnten nicht geladen werden.</p>
                      ) : list.length === 0 ? (
                        <p className="text-sm muted">Noch keine Schlüssel angelegt.</p>
                      ) : (
                        <div className="card overflow-hidden">
                          <ApiTokenList
                            tokens={list}
                            userAccess={u.aiAccess}
                            busy={busy}
                            onRevoke={(t) => void revokeKey(u, t)}
                            onDelete={(t) => void deleteKey(u, t)}
                            label={`KI-Schlüssel von ${u.email}`}
                            showHistory={showHistory}
                            onShowHistoryChange={setShowHistory}
                          />
                        </div>
                      )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm muted" data-testid="ai-access-hint">
        <strong className="font-medium text-stone-700 dark:text-stone-300">KI-Zugang</strong> erlaubt
        einem KI-Assistenten (z.B. Claude Code) über persönliche Schlüssel den Zugriff im Namen des
        Benutzers. Er gilt nur, wenn er hier ausdrücklich vergeben ist — auch Administratoren haben
        ihn sonst nicht. Die Familienrechte gelten zusätzlich: „lesen und schreiben“ erlaubt nie
        mehr, als der Benutzer in der App selbst darf. Herabsetzen wirkt sofort auf alle vorhandenen
        Schlüssel. Eigene Schlüssel verwaltet jeder unter{" "}
        <Link href="/ai-access" className="underline">
          KI-Zugang
        </Link>
        .
      </p>
    </div>
  );
}
