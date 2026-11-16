#!/usr/bin/env node
// Plattformunabhängiger Helfer für die Mock-Umgebung (auch unter Windows, wo
// `VAR=wert befehl` in npm-Skripten nicht funktioniert).
//
//   node scripts/mock.mjs setup   Datenbank anlegen, Schema anwenden, befüllen
//   node scripts/mock.mjs seed    nur neu befüllen (Datenbank muss existieren)
//   node scripts/mock.mjs dev     Dev-Server gegen die Mock-Daten auf Port 3100
//   node scripts/mock.mjs env     berechnete Umgebung anzeigen
//
// Die Mock-Datenbank liegt neben der normalen auf demselben Postgres. Ihr Name
// wird aus DATABASE_URL abgeleitet (…/familytree -> …/familytree_mock) oder
// über MOCK_DATABASE_URL gesetzt. Die normale Datenbank wird nie angefasst.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const MOCK_PORT = process.env.MOCK_PORT ?? "3100";
const MOCK_BUCKET = process.env.MOCK_S3_BUCKET ?? "familytree-mock";

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

/** Umgebung für alle Mock-Befehle. */
const mockEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  S3_BUCKET: MOCK_BUCKET,
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
    `[mock] Dev-Server: http://localhost:${MOCK_PORT}  (Datenbank ${databaseName}, Bucket ${MOCK_BUCKET})`,
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
    case "env":
      console.log(
        JSON.stringify(
          {
            DATABASE_URL: databaseUrl,
            S3_BUCKET: MOCK_BUCKET,
            S3_ENDPOINT: mockEnv.S3_ENDPOINT,
            AUTH_URL: mockEnv.AUTH_URL,
            NEXT_DIST_DIR: mockEnv.NEXT_DIST_DIR,
          },
          null,
          2,
        ),
      );
      break;
    default:
      console.error("Aufruf: node scripts/mock.mjs <setup|seed|dev|env>");
      process.exit(1);
  }
} catch (err) {
  console.error("[mock]", err.message ?? err);
  process.exit(1);
}
