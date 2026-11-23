#!/usr/bin/env node
// Misst, wie oft die Hydration einer Seite scheitert (React #418 und
// Folgefehler) — gegen einen laufenden Server der Mock-Umgebung
// (`npm run mock:start`, Port MOCK_PORT, Standard 3100).
//
//   node scripts/hydration-rate.mjs [--n=600] [--tabs=6] [--cpu=1] [--net=none|fast3g|slow3g]
//                                   [--paths=/login,/people] [--anon] [--gap=50] [--verbose]
//
//   --n      Seitenaufrufe insgesamt (verteilt über die Pfade)
//   --tabs   gleichzeitig offene Tabs (je eigener Browser-Kontext)
//   --cpu    CPU-Drosselung des Browsers (1 = keine, 4 = viermal langsamer)
//   --net    Netz-Drosselung (Chrome DevTools Protocol)
//   --anon   ohne Anmeldung (nur sinnvoll mit --paths=/login)
//   --gap    Millisekunden Pause vor jedem RSC-Datenskript des
//            HTML-Dokuments: die Aufrufe laufen dann über einen eingebauten
//            Zwischenserver, der das Streaming künstlich streckt. Damit lässt
//            sich der Wettlauf „Hydration beginnt, bevor alle RSC-Daten da
//            sind“ gezielt (statt zufällig) auslösen.
//
// Ausgabe: je Pfad Aufrufe/Fehler und die Gesamtrate; Exit 1, wenn Fehler
// gezählt wurden. Siehe docs/komponenten/betrieb-und-tests.md.
import http from "node:http";

import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "1";
};

const PORT = process.env.MOCK_PORT ?? "3100";
const ORIGIN = `http://localhost:${PORT}`;
const N = Number(arg("n", "600"));
const TABS = Number(arg("tabs", "6"));
const CPU = Number(arg("cpu", "1"));
const NET = arg("net", "none");
const ANON = arg("anon", "") === "1";
const VERBOSE = arg("verbose", "") === "1";
const PATHS = arg(
  "paths",
  ANON ? "/login" : "/people,/tree,/sources,/research,/map,/neuigkeiten,/hilfe,/admin/data",
).split(",");

const NETS = {
  fast3g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  slow3g: { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 },
};

/**
 * Zwischenserver: reicht alles an den Mock-Server durch, schickt ein
 * HTML-Dokument aber stückweise mit Pausen weiter.
 */
async function startGapProxy(gapMs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = http.createServer((req, res) => {
    const upstream = http.request(
      ORIGIN + req.url,
      { method: req.method, headers: { ...req.headers, host: `localhost:${PORT}`, "accept-encoding": "identity" } },
      async (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        if (!String(up.headers["content-type"] ?? "").startsWith("text/html")) {
          up.pipe(res);
          return;
        }
        // Ganz einlesen und vor jedem RSC-Datenskript teilen: so kommt jede
        // RSC-Zeilengruppe sicher getrennt an, unabhängig davon, wie der
        // Server seine Chunks gerade zusammengefasst hat.
        const parts = [];
        for await (const chunk of up) parts.push(chunk);
        const html = Buffer.concat(parts).toString("utf8");
        for (const piece of html.split(/(?=<script>self\.__next_f\.push\()/)) {
          res.write(piece);
          await sleep(gapMs);
        }
        res.end();
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://localhost:${server.address().port}` };
}

const GAP = Number(arg("gap", "0"));
const proxy = GAP > 0 ? await startGapProxy(GAP) : null;
const BASE = proxy ? proxy.url : ORIGIN;

const HYDRATION = /Minified React error #(418|419|421|422|423|425)|Hydration failed/;
const FOLLOW_UP = /Cannot read properties of null \(reading 'parentNode'\)/;

const browser = await chromium.launch();

async function newTab(storageState) {
  const context = await browser.newContext({ storageState, locale: "de-DE" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NETS[NET]) await cdp.send("Network.emulateNetworkConditions", NETS[NET]);
  return { context, page };
}

let storageState;
if (!ANON) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/login`);
  await page.getByLabel("E-Mail-Adresse").fill("admin@example.test");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.waitForURL(/\/tree/);
  storageState = await context.storageState();
  await context.close();
}

const stats = new Map(PATHS.map((p) => [p, { loads: 0, hydration: 0, followUp: 0, other: 0 }]));
const samples = [];
let next = 0;

async function worker() {
  const { context, page } = await newTab(storageState);
  let current = null;
  page.on("pageerror", (err) => {
    if (!current) return;
    if (HYDRATION.test(err.message)) current.hydration++;
    else if (FOLLOW_UP.test(err.message)) current.followUp++;
    else current.other++;
    if (samples.length < 5 || VERBOSE) samples.push(`${current.path}: ${err.message.slice(0, 160)}`);
  });
  while (next < N) {
    const i = next++;
    const path = PATHS[i % PATHS.length];
    current = { path, hydration: 0, followUp: 0, other: 0 };
    try {
      await page.goto(BASE + path, { waitUntil: "load", timeout: 120_000 });
      // Hydration läuft nach „load“ ggf. noch: warten, bis React am <main> hängt.
      await page.waitForFunction(
        () => {
          const el = document.querySelector("main a, main button, main input, main");
          return Boolean(el) && document.readyState === "complete";
        },
        undefined,
        { timeout: 60_000 },
      );
      await page.waitForTimeout(150);
    } catch (err) {
      current.other++;
      samples.push(`${path}: [Aufruf] ${String(err.message).split("\n")[0]}`);
    }
    const s = stats.get(path);
    s.loads++;
    if (current.hydration) s.hydration++;
    if (current.followUp) s.followUp++;
    if (current.other) s.other++;
  }
  await context.close();
}

const started = Date.now();
await Promise.all(Array.from({ length: TABS }, worker));
await browser.close();
proxy?.server.close();
proxy?.server.closeAllConnections();

let loads = 0;
let bad = 0;
let other = 0;
console.log(
  `Hydration-Messung ${ORIGIN} — n=${N}, tabs=${TABS}, cpu=${CPU}x, net=${NET}${GAP ? `, Chunk-Pause ${GAP} ms` : ""}${ANON ? ", ohne Anmeldung" : ""}`,
);
for (const [path, s] of stats) {
  loads += s.loads;
  bad += s.hydration;
  other += s.other;
  console.log(
    `  ${path.padEnd(16)} ${String(s.loads).padStart(5)} Aufrufe  ${String(s.hydration).padStart(4)} Hydration-Fehler  ${String(s.followUp).padStart(4)} mit Folgefehler  ${String(s.other).padStart(3)} andere`,
  );
}
console.log(
  `  gesamt: ${bad}/${loads} = ${((100 * bad) / Math.max(1, loads)).toFixed(2)} %  (andere Fehler: ${other}; ${Math.round((Date.now() - started) / 1000)} s)`,
);
for (const s of samples.slice(0, VERBOSE ? 200 : 5)) console.log(`  · ${s}`);
process.exit(bad || other ? 1 : 0);
