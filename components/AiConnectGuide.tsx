/**
 * Schritt-für-Schritt-Anleitungen auf der Seite „KI-Zugang“: wie man Claude
 * auf dem Handy, im Browser bzw. in Claude Desktop und in Claude Code mit dem
 * Stammbaum verbindet.
 *
 * Handy/Browser/Desktop gehen über einen „Custom Connector“ auf claude.ai.
 * Den ruft Anthropic aus der Cloud auf und meldet sich per OAuth an — nicht
 * mit dem festen Schlüssel. Dafür steht ein Gateway vor der App, das beim
 * Verbinden eine Anmeldeseite zeigt, auf der man seinen persönlichen
 * Schlüssel einträgt. Seine öffentliche Adresse kommt aus MCP_CONNECTOR_URL
 * (nie fest im Repository); ohne sie nennt die Anleitung den Administrator.
 */
export function AiConnectGuide({
  connectorUrl,
  canUse,
}: {
  connectorUrl: string | null;
  /** Der Benutzer hat KI-Zugang (lesen oder schreiben). */
  canUse: boolean;
}) {
  return (
    <section className="space-y-3" aria-labelledby="ai-guide-title" data-testid="ai-connect-guide">
      <h2 id="ai-guide-title" className="section-title">
        Anleitungen: Claude verbinden
      </h2>
      {!canUse && (
        <p className="text-sm muted">
          Die Anleitungen helfen dir, sobald ein Administrator deinen KI-Zugang freigeschaltet hat.
        </p>
      )}

      <details className="card group p-4" data-testid="ai-guide-mobile" open>
        <summary className="cursor-pointer font-semibold max-md:py-2">
          Claude auf dem Handy (iPhone, Android)
        </summary>
        <div className="mt-3 space-y-3 text-sm">
          <p className="muted">
            Den Zugang richtest du <strong>einmal</strong> im Browser auf claude.ai (oder in Claude
            Desktop) ein. Die Claude-App auf dem Handy übernimmt ihn danach automatisch — direkt in
            der App lässt er sich nicht zuverlässig hinzufügen.
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Lege oben unter „Neuen Schlüssel anlegen“ einen Schlüssel an, z.B. „Claude Handy“, und
              kopiere ihn. Nur mit der Stufe „lesen und schreiben“ kann Claude auch Einträge
              anlegen.
            </li>
            <li>
              Öffne <strong>claude.ai</strong> im Browser (am besten am Computer) und melde dich mit
              demselben Konto an, das du auf dem Handy benutzt.
            </li>
            <li>
              Gehe zu <strong>Customize → Connectors</strong>, tippe auf <strong>„+ Add“</strong>{" "}
              und wähle <strong>„Add custom connector“</strong>. (Die Menünamen können je nach
              Sprache der App etwas anders heißen.)
            </li>
            <li>
              Name: <strong>Stammbaum</strong>. Adresse:
              {connectorUrl ? (
                <code
                  className="mt-1 block break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs dark:bg-stone-800"
                  data-testid="ai-connector-url"
                >
                  {connectorUrl}
                </code>
              ) : (
                <span className="block" data-testid="ai-connector-url-missing">
                  — die Adresse bekommst du von einem Administrator (für diese Installation ist
                  noch keine hinterlegt).
                </span>
              )}
            </li>
            <li>
              Auf <strong>„Add“</strong> und dann <strong>„Connect“</strong> tippen. Es öffnet sich
              die Anmeldeseite des Stammbaums: dort deinen Schlüssel einfügen und bestätigen.
            </li>
            <li>
              Auf dem Handy die Claude-App öffnen (gleiches Konto). Im Chat über{" "}
              <strong>„+“</strong> bzw. das Werkzeug-Symbol den Connector{" "}
              <strong>„Stammbaum“</strong> einschalten.
            </li>
            <li>
              Fragen, z.B. „Wer waren die Eltern von Anna Becker?“ oder „Welche Daten fehlen in
              meiner Familie?“. Vor dem ersten Ändern fragt Claude um Erlaubnis.
            </li>
          </ol>
          <ul className="list-disc space-y-1 pl-5 muted">
            <li>
              Claude greift aus der Cloud zu, mit genau deinen Rechten. Widerrufst du den Schlüssel
              hier, ist auch der Zugang auf dem Handy sofort weg.
            </li>
            <li>
              Ein Bild, das du Claude im Chat zeigst, kann Claude nicht in den Stammbaum hochladen
              — lade es in der App hoch; Claude kann es danach zuordnen.
            </li>
            <li>Im kostenlosen Claude-Tarif ist nur ein eigener Connector möglich.</li>
          </ul>
        </div>
      </details>

      <details className="card p-4" data-testid="ai-guide-web">
        <summary className="cursor-pointer font-semibold max-md:py-2">
          claude.ai im Browser und Claude Desktop
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            Derselbe Connector wie für das Handy: einmal wie oben in Schritt 1–5 eingerichtet, steht
            er auf claude.ai, in Claude Desktop und in der Handy-App zur Verfügung. Im Chat über
            „+“ bzw. das Werkzeug-Symbol einschalten.
          </p>
        </div>
      </details>

      <details className="card p-4" data-testid="ai-guide-code">
        <summary className="cursor-pointer font-semibold max-md:py-2">
          Claude Code (Terminal, VS Code)
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            Claude Code verbindet sich direkt mit dieser App und schickt den Schlüssel im
            HTTP-Header mit. Nach dem Anlegen eines Schlüssels zeigt diese Seite den fertigen
            Befehl zum Kopieren; allgemein:
          </p>
          <code className="block break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs dark:bg-stone-800">
            claude mcp add --transport http --scope user stammbaum &lt;Adresse dieser App&gt;/api/mcp
            --header &quot;Authorization: Bearer &lt;dein Schlüssel&gt;&quot;
          </code>
          <p className="muted">Weitere Clients und Einzelheiten: README, Abschnitt „KI-Zugang“.</p>
        </div>
      </details>
    </section>
  );
}

/** Öffentliche Adresse des Connectors (Gateway) — nur http(s), sonst keine. */
export function connectorUrlFromEnv(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
