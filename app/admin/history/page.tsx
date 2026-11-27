import { requireScope } from "@/lib/session";
import { can } from "@/lib/authz";
import { redirect } from "next/navigation";
import { historyAdminState } from "@/lib/services";
import { HistoryAdmin } from "@/components/HistoryAdmin";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zeitgeschichte" };

/**
 * Zeitgeschichte (nur Administratoren, Recht `history:manage`): eigene
 * Ereignisse pflegen und mitgelieferte aus- bzw. einblenden. Angezeigt
 * werden die Ereignisse im Zeitstrahl des Baums, in der Zeitreise der Karte
 * und im Lebenslauf der Personenseite.
 */
export default async function HistoryAdminPage() {
  const { session, scope } = await requireScope();
  if (!can(session.user.role, "history:manage")) redirect("/tree?denied=1");
  const state = await historyAdminState(scope);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Verwaltung</p>
        <h1 className="page-title">Zeitgeschichte</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Was geschah in der Zeit, in der die Familie lebte? Diese Ereignisse erscheinen als dezenter Hintergrund im
          Zeitstrahl des Stammbaums, in der Zeitreise der Karte und im Lebenslauf — für alle Benutzer gleich und nie als
          Aussage über eine Person.
        </p>
        <p className="mt-1">
          <HelpLink to="zeitgeschichteVerwalten" label="Wie funktioniert die Zeitgeschichte?" />
        </p>
      </div>
      <HistoryAdmin state={state} />
    </div>
  );
}
