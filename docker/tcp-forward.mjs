// Einfache TCP-Weiterleitung für den optionalen Dienst "db-access"
// (Compose-Profil db-access): macht die Datenbank für den MCP-Server auf dem
// eigenen PC erreichbar, ohne dass der db-Dienst selbst einen Port
// veröffentlicht. Nur auf Abruf starten und danach wieder stoppen.
//
//   FORWARD_TARGET_HOST (Standard db), FORWARD_TARGET_PORT (Standard 5432),
//   FORWARD_LISTEN_PORT (Standard 5432, im Container)
import net from "node:net";

const targetHost = process.env.FORWARD_TARGET_HOST || "db";
const targetPort = Number(process.env.FORWARD_TARGET_PORT || 5432);
const listenPort = Number(process.env.FORWARD_LISTEN_PORT || 5432);

const server = net.createServer((client) => {
  const upstream = net.connect(targetPort, targetHost);
  const peer = `${client.remoteAddress}:${client.remotePort}`;
  console.log(`[db-access] Verbindung von ${peer}`);
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", (err) => {
    console.error(`[db-access] Ziel nicht erreichbar: ${err.message}`);
    close();
  });
  client.on("close", close);
  upstream.on("close", close);
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`[db-access] leite :${listenPort} an ${targetHost}:${targetPort} weiter`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    // Offene Verbindungen nicht abwarten.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
