import { requireScope } from "@/lib/session";
import { getAiAccessInfo, listApiTokens } from "@/lib/services";
import { AiAccessManager } from "@/components/AiAccessManager";
import { HISTORY_PARAM } from "@/components/ai-access-labels";
import { AiConnectGuide, connectorUrlFromEnv } from "@/components/AiConnectGuide";
import { HelpLink } from "@/components/HelpLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "KI-Zugang" };

/**
 * Eigener KI-Zugang für jeden angemeldeten Benutzer: Recht in Worten,
 * eigene Schlüssel, neuen Schlüssel anlegen, widerrufen, löschen; widerrufene
 * und abgelaufene nur mit `?verlauf=1` (Schalter in der Liste). Ohne Recht erklärt
 * die Seite die Lage, statt zu verschwinden — vorhandene Schlüssel lassen
 * sich auch dann noch widerrufen.
 *
 * Das Geheimnis eines neuen Schlüssels kommt nur aus der POST-Antwort im
 * Browser und steht nie im hier gerenderten HTML.
 */
export default async function AiAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scope } = await requireScope();
  // Verlauf (widerrufene und abgelaufene Schlüssel) eingeblendet?
  const showHistory = (await searchParams)[HISTORY_PARAM] === "1";
  const [info, tokens] = await Promise.all([getAiAccessInfo(scope), listApiTokens(scope)]);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Dein Konto</p>
        <h1 className="page-title">KI-Zugang</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Mit einem persönlichen Schlüssel kann ein KI-Assistent wie Claude Code über die
          MCP-Schnittstelle in deinem Namen im Stammbaum recherchieren — mit genau deinen
          Familienrechten, nie mit mehr. Auch Claude auf dem Handy, siehe Anleitungen unten.
        </p>
        <p className="mt-1">
          <HelpLink to="kiZugang" label="Wie funktioniert der KI-Zugang?" />
        </p>
      </div>
      <AiAccessManager info={info} tokens={tokens} initialShowHistory={showHistory} />
      <AiConnectGuide
        connectorUrl={connectorUrlFromEnv(process.env.MCP_CONNECTOR_URL)}
        canUse={info.aiAccess !== "NONE"}
      />
    </div>
  );
}
