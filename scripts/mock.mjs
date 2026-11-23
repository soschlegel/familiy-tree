#!/usr/bin/env node
// Plattformunabhängiger Helfer für die Mock-Umgebung (auch unter Windows, wo
// `VAR=wert befehl` in npm-Skripten nicht funktioniert).
//
//   node scripts/mock.mjs setup   Datenbank anlegen, Schema anwenden, befüllen
//   node scripts/mock.mjs seed    nur neu befüllen (Datenbank muss existieren)
//   node scripts/mock.mjs dev     Dev-Server gegen die Mock-Daten auf Port 3100
//   node scripts/mock.mjs build [--if-stale]
//                                 Produktions-Build für die E2E-Tests in .next-e2e
//                                 (--if-stale: nur, wenn Quellen neuer als der Build)
//   node scripts/mock.mjs start   diesen Build mit `next start` auf Port 3100
//                                 (Mock-Datenbank, Mock-Bilder, Dev-Login)
//   node scripts/mock.mjs env     berechnete Umgebung anzeigen
//   node scripts/mock.mjs mcp     MCP-Server (stdio, nur Entwicklung/Tests) gegen die Mock-Daten
//   node scripts/mock.mjs mcp-key [name]
//                                 festen Mock-Schlüssel für den MCP-Endpunkt
//                                 ausgeben (Standard: editor-read), z.B. für
//                                 FAMILYTREE_MCP_KEY in .mcp.json
//
// Die Mock-Datenbank liegt neben der normalen auf demselben Postgres. Ihr Name
// wird aus DATABASE_URL abgeleitet (…/familytree -> …/familytree_mock) oder
// über MOCK_DATABASE_URL gesetzt. Die normale Datenbank wird nie angefasst.
// Ebenso die Bilder: sie liegen in einem eigenen Ordner (Standard
// ./data/media-mock, änderbar über MOCK_MEDIA_DIR; der Name muss auf -mock
// oder -test enden), nie im normalen MEDIA_DIR.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const MOCK_PORT = process.env.MOCK_PORT ?? "3100";
const MOCK_MEDIA_DIR = resolve(root, process.env.MOCK_MEDIA_DIR ?? join("data", "media-mock"));

if (existsSync(join(root, ".env"))) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch (err) {
    console.warn("[mock] .env konnte nicht gelesen werden:", err.message);
  }
}

function mockDatabaseUrl() {
  if (process.env.MOCK_DATABASE_URL) return process.env.MOCK_DATABASE_URL;
  const base =
    process.env.DATABASE_URL ??
    "postgresql://familytree:familytree@localhost:5432/familytree";
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "") || "familytree";
  url.pathname = `/${name.replace(/_(mock|test)$/, "")}_mock`;
  return url.toString();
}

const databaseUrl = mockDatabaseUrl();
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));

if (!/_(mock|test)$/.test(databaseName)) {
  console.error(
    `[mock] Abbruch: "${databaseName}" endet nicht auf _mock oder _test.`,
  );
  process.exit(2);
}

if (!/-(mock|test)$/.test(basename(MOCK_MEDIA_DIR))) {
  console.error(
    `[mock] Abbruch: Medienordner "${MOCK_MEDIA_DIR}" endet nicht auf -mock oder -test.`,
  );
  process.exit(2);
}

/** Umgebung für alle Mock-Befehle. */
const mockEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  MEDIA_DIR: MOCK_MEDIA_DIR,
  AUTH_URL: `http://localhost:${MOCK_PORT}`,
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET:
    process.env.AUTH_SECRET && process.env.AUTH_SECRET !== "bitte-ersetzen"
      ? process.env.AUTH_SECRET
      : "mock-secret-nur-fuer-lokale-tests-0123456789",
  ENABLE_DEV_LOGIN: "true",
  // Eigener Build-Ordner, damit der Mock-Server parallel zum normalen
  // Dev-Server (Port 3000, .next) laufen kann.
  NEXT_DIST_DIR: ".next-mock",
  PORT: MOCK_PORT,
};

/**
 * Produktions-Build der Mock-Umgebung (E2E-Tests). Eigener Ausgabeordner, damit
 * er weder den normalen (.next) noch den Mock-Dev-Server (.next-mock) stört.
 * Im Build selbst steckt nichts Ortsabhängiges (Port, Datenbank, Medienordner
 * und Anmeldung liest der Server erst beim Start), er gilt also für jeden Port.
 */
const E2E_DIST_DIR = ".next-e2e";
const E2E_STAMP = join(root, E2E_DIST_DIR, "e2e-build-stamp.json");
const e2eEnv = {
  ...mockEnv,
  NEXT_DIST_DIR: E2E_DIST_DIR,
  // Eng begrenzte Freigabe des Dev-Logins im Produktionsmodus — wirkt nur
  // zusammen mit Mock-Datenbank und Mock-Medienordner (lib/dev-login.ts).
  E2E_PRODUCTION_DEV_LOGIN: "mock-only",
  // Keine Telemetrie-Hinweise im Testprotokoll.
  NEXT_TELEMETRY_DISABLED: "1",
  // Anfragegrenzen (lib/rate-limit.ts) aus: Viele parallele Testläufer teilen
  // sich wenige Testbenutzer und würden sonst gedrosselt. Geprüft werden die
  // Grenzen in Vitest (tests/rate-limit.test.ts).
  RATE_LIMIT: "off",
};
delete e2eEnv.NODE_ENV; // setzt next build/start selbst

/** Alles, was in den Build eingeht (für --if-stale). */
const BUILD_INPUTS = [
  "app", "components", "lib", "public", "geo",
  "prisma/schema.prisma", "next.config.mjs", "package-lock.json",
  "tailwind.config.ts", "postcss.config.mjs", "tsconfig.json",
];

/** Jüngste Änderungszeit (ms) unter den Build-Eingaben. */
function newestInput() {
  let newest = 0;
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) visit(join(p, name));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  for (const rel of BUILD_INPUTS) visit(join(root, rel));
  return newest;
}

/** Ist der E2E-Build vorhanden und jünger als alle Eingaben? */
function e2eBuildFresh() {
  if (!existsSync(E2E_STAMP) || !existsSync(join(root, E2E_DIST_DIR, "BUILD_ID"))) return false;
  return statSync(E2E_STAMP).mtimeMs >= newestInput();
}

async function build({ ifStale = false } = {}) {
  if (ifStale && e2eBuildFresh()) {
    console.log(`[mock] E2E-Build in ${E2E_DIST_DIR} ist aktuell — übersprungen.`);
    return;
  }
  const started = Date.now();
  console.log(`[mock] Produktions-Build der Mock-Umgebung nach ${E2E_DIST_DIR} …`);
  // Zeitstempel VOR dem Build nehmen: was währenddessen geändert wird, gilt
  // beim nächsten --if-stale als neuer.
  const startedAt = new Date();
  await run([bin.next, "build"], { env: e2eEnv });
  writeFileSync(E2E_STAMP, JSON.stringify({ builtAt: startedAt.toISOString() }, null, 2));
  utimesSync(E2E_STAMP, startedAt, startedAt);
  console.log(`[mock] Build fertig in ${Math.round((Date.now() - started) / 1000)} s.`);
}

async function start() {
  if (!existsSync(join(root, E2E_DIST_DIR, "BUILD_ID"))) {
    throw new Error(`Kein Build in ${E2E_DIST_DIR} — zuerst npm run mock:build`);
  }
  if (!e2eBuildFresh()) {
    console.warn(`[mock] Hinweis: Quellen sind neuer als der Build in ${E2E_DIST_DIR} (npm run mock:build).`);
  }
  console.log(
    `[mock] Produktionsserver: http://localhost:${MOCK_PORT}  (Datenbank ${databaseName}, Bilder ${MOCK_MEDIA_DIR})`,
  );
  await run([bin.next, "start", "-p", MOCK_PORT], { env: e2eEnv });
}

function run(args, { env = mockEnv } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      if (code === 0) resolve();
      else reject(new Error(`${args.slice(0, 2).join(" ")} endete mit ${code ?? signal}`));
    });
    child.on("error", reject);
  });
}

const bin = {
  prisma: require.resolve("prisma/build/index.js"),
  tsx: require.resolve("tsx/cli"),
  next: require.resolve("next/dist/bin/next"),
};

/** Legt die Mock-Datenbank an, falls sie fehlt (über die Wartungsdatenbank). */
async function ensureDatabase() {
  const { PrismaClient } = await import("@prisma/client");
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  const prisma = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      databaseName,
    );
    if (rows.length === 0) {
      // Name ist oben auf [_a-z0-9] geprüft worden; Bezeichner lassen sich
      // nicht als Parameter übergeben.
      if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
        throw new Error(`Ungültiger Datenbankname: ${databaseName}`);
      }
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      console.log(`[mock] Datenbank ${databaseName} angelegt.`);
    } else {
      console.log(`[mock] Datenbank ${databaseName} vorhanden.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function pushSchema() {
  // Nur gegen die Mock-Datenbank: Datenverlust ist hier ausdrücklich egal,
  // der Seed baut ohnehin alles neu auf.
  await run([bin.prisma, "db", "push", "--skip-generate", "--accept-data-loss"]);
}

async function seed() {
  await run([bin.tsx, "prisma/seed-mock.ts"]);
}

async function dev() {
  console.log(
    `[mock] Dev-Server: http://localhost:${MOCK_PORT}  (Datenbank ${databaseName}, Bilder ${MOCK_MEDIA_DIR})`,
  );
  console.log("[mock] Anmelden per Dev-Login, z.B. admin@example.test");
  await run([bin.next, "dev", "-p", MOCK_PORT]);
}

const command = process.argv[2];

try {
  switch (command) {
    case "setup":
      await ensureDatabase();
      await pushSchema();
      await seed();
      break;
    case "seed":
      await seed();
      break;
    case "dev":
      await dev();
      break;
    case "build":
      await build({ ifStale: process.argv.includes("--if-stale") });
      break;
    case "start":
      await start();
      break;
    case "mcp":
      // MCP-Server (mcp/server.ts) gegen die Mock-Datenbank. Hier nichts auf
      // stdout ausgeben — das gehört allein dem MCP-Protokoll.
      await run([bin.tsx, "mcp/server.ts"]);
      break;
    case "mcp-key": {
      // Nur die festen, öffentlich bekannten Testschlüssel der Mock-Daten
      // (prisma/mock-data.ts) — gelten ausschließlich in der Mock-Datenbank.
      // Ausgabe: nur der Schlüssel, damit er sich direkt in eine Variable
      // übernehmen lässt.
      const name = process.argv[3] ?? "editor-read";
      const script = [
        `import("./prisma/mock-data.ts").then((m) => {`,
        `  const t = m.generateMockData().apiTokens.find((x) => x.id === "mock-token-" + process.env.MCP_KEY_NAME);`,
        `  if (!t) { console.error("[mock] Unbekannter Schlüssel. Verfügbar: " + m.MOCK_API_TOKEN_KEYS.join(", ")); process.exit(1); }`,
        `  console.log(t.secret);`,
        `});`,
      ].join("\n");
      await run([bin.tsx, "--eval", script], { env: { ...mockEnv, MCP_KEY_NAME: name } });
      break;
    }
    case "env":
      console.log(
        JSON.stringify(
          {
            DATABASE_URL: databaseUrl,
            MEDIA_DIR: MOCK_MEDIA_DIR,
            AUTH_URL: mockEnv.AUTH_URL,
            NEXT_DIST_DIR: mockEnv.NEXT_DIST_DIR,
          },
          null,
          2,
        ),
      );
      break;
    default:
      console.error("Aufruf: node scripts/mock.mjs <setup|seed|dev|build|start|env|mcp|mcp-key>");
      process.exit(1);
  }
} catch (err) {
  console.error("[mock]", err.message ?? err);
  process.exit(1);
}
