#!/usr/bin/env node
// Startet die Playwright-Tests in Teilen (plattformunabhängig, auch unter
// Windows, wo `VAR=wert befehl` in npm-Skripten nicht geht) — mit einem
// Befehl: Server bauen und starten, Tests, Server beenden.
//
//   node scripts/e2e.mjs all    [Optionen] [Playwright-Argumente]   alles: setup → read → write
//   node scripts/e2e.mjs read   …                                    setup → read
//   node scripts/e2e.mjs write  …                                    setup → write (ohne read)
//   node scripts/e2e.mjs setup                                       nur Mock-Daten, Anmeldungen
//
// Server: Standard ist der Produktions-Build der Mock-Umgebung
// (scripts/mock.mjs build/start, Ordner .next-e2e, Port MOCK_PORT bzw. 3100).
// Der Build wird nur erneuert, wenn Quellen neuer sind als er. Läuft auf dem
// Port schon ein Server, wird er mitbenutzt und hinterher nicht beendet;
// sonst startet das Skript ihn selbst und beendet ihn am Ende. Zwischen read
// und write ist kein Neustart nötig (next start übersetzt nichts nach und
// wächst nicht).
//
// Optionen:
//   --dev          gegen den Mock-Dev-Server (npm run dev:mock) statt gegen
//                  den Produktions-Build (der frühere Weg).
//   --rebuild      Build in jedem Fall neu erzeugen.
//   --no-build     nicht bauen, vorhandenen Build nehmen (auch wenn veraltet).
//   --skip-setup   Setup überspringen (Zustand ist schon vorbereitet, z.B.
//                  direkt nach `npm run test:e2e:setup`). Gleichbedeutend:
//                  Umgebungsvariable E2E_SKIP_SETUP=1.
//
// Alles Weitere geht unverändert an `playwright test`, z.B. eine Datei
// (`e2e/write/sources.spec.ts`), `-g "Quelle löschen"`, `--headed`,
// `--shard=1/2`, `--repeat-each=2`, `--workers=2`.
//
// Filter (Dateien, -g/--grep) bei `all`: In playwright.config.ts hängt „write“
// an „read“, und Playwright führt Abhängigkeiten immer vollständig aus — ein
// Filter auf eine write-Datei würde also alle lesenden Tests mitlaufen lassen.
// Deshalb läuft `all` mit Filter in drei Schritten nacheinander: Setup (ohne
// Filter), dann die gefilterten lesenden, dann die gefilterten ändernden
// Tests. Die Reihenfolge read vor write bleibt so erhalten. Der HTML-Bericht
// zeigt danach nur den letzten Schritt.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [area = "all", ...rest] = process.argv.slice(2);
const AREAS = { all: [], read: ["--project=read"], write: ["--project=write"], setup: ["--project=setup"] };
const OWN_OPTIONS = ["--skip-setup", "--dev", "--rebuild", "--no-build"];
if (!(area in AREAS)) {
  console.error(
    `Aufruf: node scripts/e2e.mjs <${Object.keys(AREAS).join("|")}> [${OWN_OPTIONS.join("] [")}] [Playwright-Argumente]`,
  );
  process.exit(1);
}

const own = new Set(rest.filter((a) => OWN_OPTIONS.includes(a)));
const args = rest.filter((a) => !OWN_OPTIONS.includes(a));
const skipSetup = own.has("--skip-setup") || process.env.E2E_SKIP_SETUP === "1";
const dev = own.has("--dev");
const PORT = process.env.MOCK_PORT ?? "3100";
const LOGIN_URL = `http://localhost:${PORT}/login`;

// Optionen von `playwright test`, die den nächsten Wert verbrauchen (wenn
// nicht als --name=wert geschrieben).
const TAKES_VALUE = new Set([
  "-g", "--grep", "--grep-invert", "-j", "--workers", "--shard", "--repeat-each",
  "--retries", "--reporter", "--timeout", "--global-timeout", "--max-failures",
  "--project", "-c", "--config", "--output", "--trace", "--tsconfig",
]);
const GREP = new Set(["-g", "--grep", "--grep-invert"]);

/** Enthält die Befehlszeile einen Testfilter (Datei/Muster oder -g)? */
function hasFilter(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (GREP.has(a) || /^--grep(-invert)?=/.test(a)) return true;
    if (TAKES_VALUE.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("-")) return true;
  }
  return false;
}

const cli = require.resolve("@playwright/test/cli");
const mockScript = join(root, "scripts", "mock.mjs");
let child;
let server;

/** Prozess samt Kindprozessen beenden (next start/dev starten eigene). */
function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child?.kill(signal);
    killTree(server);
    process.exit(130);
  });
}

function runNode(nodeArgs, extraEnv = {}) {
  return new Promise((resolve) => {
    child = spawn(process.execPath, nodeArgs, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Antwortet auf dem Port ein Server? Liefert dann seine Art ("dev"/"prod"). */
async function probe() {
  try {
    const res = await fetch(LOGIN_URL, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
    const html = await res.text();
    // Der Dev-Server liefert ungehashte Chunks (webpack.js), der Build gehashte.
    return /\/_next\/static\/chunks\/webpack\.js/.test(html) ? "dev" : "prod";
  } catch {
    return null;
  }
}

async function waitForServer(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (server && server.exitCode !== null) return false;
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Server bereitstellen: laufenden mitbenutzen, sonst (bauen und) starten. */
async function ensureServer() {
  const kind = dev ? "dev" : "prod";
  const running = await probe();
  if (running) {
    console.log(
      `[e2e] Auf Port ${PORT} läuft schon ein Server (${running === "dev" ? "Dev-Server" : "Produktions-Build"}) — wird mitbenutzt und nicht beendet.`,
    );
    if (running !== kind) {
      console.warn(
        `[e2e] Achtung: verlangt war ${kind === "dev" ? "der Dev-Server (--dev)" : "der Produktions-Build"}. ` +
          "Anderen Server beenden oder anderen MOCK_PORT wählen, wenn das nicht gewollt ist.",
      );
    }
    return 0;
  }
  if (!dev && !own.has("--no-build")) {
    const buildArgs = [mockScript, "build", ...(own.has("--rebuild") ? [] : ["--if-stale"])];
    const code = await runNode(buildArgs);
    if (code !== 0) return code;
  }
  const started = Date.now();
  server = spawn(process.execPath, [mockScript, dev ? "dev" : "start"], {
    cwd: root,
    env: process.env,
    // Nur Fehlerausgaben zeigen (wie früher beim webServer von Playwright).
    stdio: ["ignore", "ignore", "pipe"],
    // Eigene Prozessgruppe, damit sich unter Linux/macOS der ganze Baum
    // beenden lässt; unter Windows erledigt das taskkill /T.
    detached: process.platform !== "win32",
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  const ok = await waitForServer(dev ? 180_000 : 60_000);
  if (!ok) {
    console.error(`[e2e] Server auf Port ${PORT} kam nicht hoch.`);
    killTree(server);
    return 1;
  }
  console.log(
    `[e2e] ${dev ? "Dev-Server" : "Produktionsserver"} auf Port ${PORT} bereit nach ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  return 0;
}

function run(playwrightArgs, extraEnv) {
  return runNode([cli, "test", ...playwrightArgs], {
    E2E_SERVER: dev ? "dev" : "prod",
    ...(skipSetup ? { E2E_SKIP_SETUP: "1" } : {}),
    ...extraEnv,
  });
}

const t0 = Date.now();
// --list braucht keinen Server.
let code = args.includes("--list") ? 0 : await ensureServer();
if (code === 0) {
  if (area === "all" && hasFilter(args)) {
    const listOnly = args.includes("--list") ? ["--list"] : [];
    code = skipSetup ? 0 : await run(["--project=setup", ...listOnly], { E2E_AREA: "setup" });
    // --pass-with-no-tests: der Filter darf nur read- oder nur write-Tests treffen.
    if (code === 0) {
      code = await run(["--project=read", "--pass-with-no-tests", ...args], { E2E_AREA: "read", E2E_SKIP_SETUP: "1" });
    }
    if (code === 0) {
      code = await run(["--project=write", "--pass-with-no-tests", ...args], { E2E_AREA: "write", E2E_SKIP_SETUP: "1" });
    }
  } else {
    code = await run([...AREAS[area], ...args], { E2E_AREA: area });
  }
}
if (server) {
  killTree(server);
  console.log(`[e2e] Server auf Port ${PORT} beendet.`);
}
console.log(`[e2e] Gesamtdauer ${((Date.now() - t0) / 1000).toFixed(0)} s, Exit ${code}.`);
process.exit(code);
