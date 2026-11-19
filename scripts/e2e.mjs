#!/usr/bin/env node
// Startet die Playwright-Tests in Teilen (plattformunabhängig, auch unter
// Windows, wo `VAR=wert befehl` in npm-Skripten nicht geht).
//
//   node scripts/e2e.mjs all    [Optionen] [Playwright-Argumente]   alles: setup → read → write
//   node scripts/e2e.mjs read   …                                    setup → read
//   node scripts/e2e.mjs write  …                                    setup → write (ohne read)
//   node scripts/e2e.mjs setup                                       nur Mock-Daten, Anmeldungen, Vorwärmen
//
// Optionen:
//   --skip-setup   Setup überspringen (Zustand ist schon vorbereitet, z.B.
//                  direkt nach `npm run test:e2e:setup`). Gleichbedeutend:
//                  Umgebungsvariable E2E_SKIP_SETUP=1.
//
// Alles Weitere geht unverändert an `playwright test`, z.B. eine Datei
// (`e2e/write/sources.spec.ts`), `-g "Quelle löschen"`, `--headed`,
// `--shard=1/2`, `--repeat-each=2`.
//
// Filter (Dateien, -g/--grep) bei `all`: In playwright.config.ts hängt „write“
// an „read“, und Playwright führt Abhängigkeiten immer vollständig aus — ein
// Filter auf eine write-Datei würde also alle lesenden Tests mitlaufen lassen.
// Deshalb läuft `all` mit Filter in drei Schritten nacheinander: Setup (ohne
// Filter), dann die gefilterten lesenden, dann die gefilterten ändernden
// Tests. Die Reihenfolge read vor write bleibt so erhalten. Der HTML-Bericht
// zeigt danach nur den letzten Schritt.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [area = "all", ...rest] = process.argv.slice(2);
const AREAS = { all: [], read: ["--project=read"], write: ["--project=write"], setup: ["--project=setup"] };
if (!(area in AREAS)) {
  console.error(`Aufruf: node scripts/e2e.mjs <${Object.keys(AREAS).join("|")}> [--skip-setup] [Playwright-Argumente]`);
  process.exit(1);
}

let skipSetup = process.env.E2E_SKIP_SETUP === "1";
const args = rest.filter((a) => {
  if (a !== "--skip-setup") return true;
  skipSetup = true;
  return false;
});

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
let child;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));

function run(playwrightArgs, extraEnv) {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [cli, "test", ...playwrightArgs], {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const base = skipSetup ? { E2E_SKIP_SETUP: "1" } : {};
let code;
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
  code = await run([...AREAS[area], ...args], { ...base, E2E_AREA: area });
}
process.exit(code);
