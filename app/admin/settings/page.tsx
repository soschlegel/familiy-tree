import { requireScope } from "@/lib/session";
import { can } from "@/lib/authz";
import { redirect } from "next/navigation";
import { listSettings } from "@/lib/services";
import { SettingsAdmin } from "@/components/SettingsAdmin";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Einstellungen" };

/**
 * Einstellungen der Installation (nur Administratoren): Schlüssel → Wert aus
 * dem Verzeichnis lib/settings/registry.ts anlegen, ändern, entfernen. Je
 * Schlüssel zeigt die Seite den wirksamen Wert und seine Herkunft (in der App
 * gesetzt / aus der Server-Konfiguration / nicht gesetzt).
 */
export default async function SettingsPage() {
  const { session, scope } = await requireScope();
  if (!can(session.user.role, "setting:manage")) redirect("/tree?denied=1");
  const settings = await listSettings(scope);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Verwaltung</p>
        <h1 className="page-title">Einstellungen</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Einstellungen dieser Installation, die du hier statt in der Server-Konfiguration pflegen
          kannst. Ein hier gesetzter Wert hat Vorrang; entfernst du ihn, gilt wieder der Wert aus
          der Server-Konfiguration. Zugangsdaten und andere Geheimnisse gehören nicht hierher.
        </p>
        <p className="mt-1">
          <HelpLink to="einstellungen" label="Wie funktionieren die Einstellungen?" />
        </p>
      </div>
      <SettingsAdmin settings={settings} />
    </div>
  );
}
