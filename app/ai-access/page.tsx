import { requireScope } from "@/lib/session";
import { getAiAccessInfo, listApiTokens } from "@/lib/services";
import { AiAccessManager } from "@/components/AiAccessManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "KI-Zugang" };

/**
 * Eigener KI-Zugang für jeden angemeldeten Benutzer: Recht in Worten,
 * eigene Schlüssel, neuen Schlüssel anlegen, widerrufen. Ohne Recht erklärt
 * die Seite die Lage, statt zu verschwinden — vorhandene Schlüssel lassen
 * sich auch dann noch widerrufen.
 *
 * Das Geheimnis eines neuen Schlüssels kommt nur aus der POST-Antwort im
 * Browser und steht nie im hier gerenderten HTML.
 */
export default async function AiAccessPage() {
  const { scope } = await requireScope();
  const [info, tokens] = await Promise.all([getAiAccessInfo(scope), listApiTokens(scope)]);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Dein Konto</p>
        <h1 className="page-title">KI-Zugang</h1>
        <p className="mt-1 max-w-3xl text-sm muted">
          Mit einem persönlichen Schlüssel kann ein KI-Assistent wie Claude Code über die
          MCP-Schnittstelle in deinem Namen im Stammbaum recherchieren — mit genau deinen
          Familienrechten, nie mit mehr.
        </p>
      </div>
      <AiAccessManager info={info} tokens={tokens} />
    </div>
  );
}
