/**
 * Füllt eine SEPARATE Mock-Datenbank mit deterministischen Testdaten
 * (siehe prisma/mock-data.ts) und legt Platzhalterbilder im Mock-Medienordner
 * ab.
 *
 * Aufruf über `npm run db:mock` bzw. `npm run mock:setup` (scripts/mock.mjs
 * setzt DATABASE_URL und MEDIA_DIR passend). Direkt aufgerufen verweigert das
 * Skript den Dienst, solange der Datenbankname nicht auf _mock oder _test
 * und der Medienordner nicht auf -mock oder -test endet — es löscht vor dem
 * Befüllen ALLE Daten der Zieldatenbank und ALLE Dateien im Medienordner.
 *
 * Wiederholbar: jeder Lauf leert die Mock-Datenbank und den Mock-Medienordner
 * und baut alles neu auf.
 */
import { readFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { hashToken } from "../lib/ai-tokens";
import { loadGazetteerSync } from "../lib/places/gazetteer-file";
import { matchPlace } from "../lib/places/match";
import { placeKey } from "../lib/places/normalize";
import { parseReleaseNotes } from "../lib/release-notes";
import { generateMockData, type MockData, type MockImage } from "./mock-data";

/** Automatische Ortszuordnung aller Ortstexte der Mock-Daten. */
function mockPlaceAssignments(data: MockData) {
  const texts = new Map<string, string>();
  const add = (t: string | null | undefined) => {
    if (t?.trim() && !texts.has(placeKey(t))) texts.set(placeKey(t), t.trim());
  };
  for (const p of data.persons) {
    add(p.birthPlace);
    add(p.deathPlace);
  }
  for (const r of data.relationships) {
    add(r.startPlace);
    add(r.endPlace);
  }
  for (const e of data.events) add(e.place);
  const gaz = loadGazetteerSync();
  const rows = [];
  for (const [key, text] of texts) {
    const m = matchPlace(gaz, text);
    if (!m) continue;
    rows.push({
      key,
      text,
      source: "AUTO" as const,
      precision: m.precision,
      latitude: m.entry.lat,
      longitude: m.entry.lon,
      label: m.label,
      countryCode: m.entry.cc || null,
      gazetteerId: m.entry.id,
    });
  }
  return rows;
}

const MOCK_NAME = /_(mock|test)$/;
const MOCK_MEDIA_DIR = /-(mock|test)$/;

function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function assertMockDatabase(url: string | undefined): string {
  const name = url ? databaseName(url) : "";
  if (!url || !MOCK_NAME.test(name)) {
    console.error(
      `[mock] Abbruch: DATABASE_URL zeigt auf "${name || "(keine)"}". ` +
        "Dieses Skript löscht alle Daten der Zieldatenbank und läuft deshalb nur " +
        "gegen Datenbanken, deren Name auf _mock oder _test endet.\n" +
        "       Bitte `npm run db:mock` bzw. `npm run mock:setup` verwenden.",
    );
    process.exit(2);
  }
  return name;
}

/** Wie bei der Datenbank: geleert wird nur ein Ordner namens …-mock/…-test. */
function assertMockMediaDir(dir: string | undefined): string {
  const resolved = dir?.trim() ? path.resolve(dir) : "";
  if (!resolved || !MOCK_MEDIA_DIR.test(path.basename(resolved))) {
    console.error(
      `[mock] Abbruch: MEDIA_DIR zeigt auf "${resolved || "(keinen Ordner)"}". ` +
        "Dieses Skript löscht alle Dateien im Medienordner und läuft deshalb nur " +
        "gegen Ordner, deren Name auf -mock oder -test endet.\n" +
        "       Bitte `npm run db:mock` bzw. `npm run mock:setup` verwenden.",
    );
    process.exit(2);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Platzhalterbilder
// ---------------------------------------------------------------------------

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

function portraitSvg(img: MockImage): string {
  const h = img.hue;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${h},45%,72%)"/>
      <stop offset="1" stop-color="hsl(${h},40%,48%)"/>
    </linearGradient>
  </defs>
  <rect width="480" height="600" fill="url(#bg)"/>
  <circle cx="240" cy="230" r="105" fill="hsl(${h},30%,88%)"/>
  <path d="M60 600 C 70 420, 410 420, 420 600 Z" fill="hsl(${h},30%,88%)"/>
  <text x="240" y="262" font-family="Arial, Helvetica, sans-serif" font-size="92" font-weight="bold"
        text-anchor="middle" fill="hsl(${h},40%,35%)">${escapeXml(img.label)}</text>
  <text x="240" y="560" font-family="Arial, Helvetica, sans-serif" font-size="28"
        text-anchor="middle" fill="hsl(${h},40%,22%)">${escapeXml(img.subtitle)}</text>
</svg>`;
}

function weddingSvg(img: MockImage): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="hsl(40,55%,88%)"/>
  <rect x="40" y="40" width="1120" height="720" fill="none" stroke="hsl(40,40%,60%)" stroke-width="6"/>
  <circle cx="470" cy="300" r="90" fill="hsl(215,25%,45%)"/>
  <path d="M330 700 C 340 470, 600 470, 610 700 Z" fill="hsl(215,25%,35%)"/>
  <circle cx="730" cy="310" r="85" fill="hsl(340,30%,70%)"/>
  <path d="M590 700 C 600 480, 860 480, 870 700 Z" fill="hsl(0,0%,98%)"/>
  <text x="600" y="120" font-family="Georgia, serif" font-size="54" text-anchor="middle"
        fill="hsl(40,35%,30%)">${escapeXml(img.label)}</text>
  <text x="600" y="760" font-family="Georgia, serif" font-size="34" text-anchor="middle"
        fill="hsl(40,35%,30%)">${escapeXml(img.subtitle)}</text>
</svg>`;
}

async function renderImage(img: MockImage): Promise<Buffer> {
  const svg = img.kind === "wedding" ? weddingSvg(img) : portraitSvg(img);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Mock-Medienordner anlegen, falls er fehlt, und leeren, damit ein erneuter
 * Lauf keine verwaisten Dateien hinterlässt. Der Ordner selbst bleibt stehen
 * (er könnte ein Mount sein), nur sein Inhalt wird gelöscht.
 */
async function prepareMediaDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  await Promise.all(
    entries.map((e) => rm(path.join(dir, e), { recursive: true, force: true })),
  );
  if (entries.length > 0) {
    console.log(`[mock] ${entries.length} alte Einträge aus ${dir} entfernt.`);
  }
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  const dbName = assertMockDatabase(url);

  const mediaDir = assertMockMediaDir(process.env.MEDIA_DIR);
  // lib/storage liest MEDIA_DIR bei jedem Aufruf; hier aufgelöst festhalten.
  process.env.MEDIA_DIR = mediaDir;

  const data = generateMockData();
  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    console.log(`[mock] Ziel: Datenbank ${dbName}, Medienordner ${mediaDir}`);

    // Alles leeren. TRUNCATE … CASCADE ist schneller als deleteMany je
    // Tabelle und hält sich nicht mit Fremdschlüsseln auf.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "ImportLink", "ExternalId", "ImportRawRecord", "ImportBatch", "Event", "PersonName",
        "AuditLog", "Citation", "Source", "RelationshipMedia", "PersonMedia", "MediaAsset",
        "Relationship", "PersonFamily", "Person", "UserFamily", "Family",
        "Session", "Account", "VerificationToken", "ApiToken", "User", "Place" CASCADE`,
    );

    const familyId = new Map(data.families.map((f) => [f.key, f.id]));

    await prisma.family.createMany({
      data: data.families.map((f) => ({ id: f.id, name: f.name, description: f.description })),
    });

    const latestRelease =
      parseReleaseNotes(readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8")).releases[0]?.id ?? null;
    await prisma.user.createMany({
      data: data.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        aiAccess: u.aiAccess,
        // Neuigkeiten: alle Mock-Benutzer haben das neueste Release schon
        // gesehen — sonst stünde „Was ist neu?“ in jedem Test im Weg.
        // e2e/write/whats-new.spec.ts prüft das Fenster gezielt.
        lastSeenReleaseId: latestRelease,
      })),
    });
    // Feste Testschlüssel (prisma/mock-data.ts) — gespeichert wird wie im
    // Betrieb nur der Hash.
    await prisma.apiToken.createMany({
      data: data.apiTokens.map((t) => ({
        id: t.id,
        userId: t.userId,
        name: t.name,
        prefix: t.prefix,
        secretHash: hashToken(t.secret),
        level: t.level,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
      })),
    });
    await prisma.userFamily.createMany({
      data: data.users.flatMap((u) =>
        u.families.map((f) => ({ userId: u.id, familyId: familyId.get(f.familyKey)!, role: f.role })),
      ),
    });

    await prisma.person.createMany({
      data: data.persons.map(({ familyKeys: _familyKeys, generation: _generation, ...p }) => p),
    });
    await prisma.personFamily.createMany({
      data: data.persons.flatMap((p) =>
        p.familyKeys.map((k) => ({ personId: p.id, familyId: familyId.get(k)! })),
      ),
    });
    await prisma.relationship.createMany({ data: data.relationships });
    // Eigene Person („das bin ich“) erst, wenn die Personen da sind.
    for (const u of data.users) {
      if (u.personId) await prisma.user.update({ where: { id: u.id }, data: { personId: u.personId } });
    }
    // Lebensereignisse und weitere Namen (siehe lib/events.ts).
    await prisma.event.createMany({ data: data.events as never });
    await prisma.personName.createMany({ data: data.personNames });

    // Ortszuordnung für die Karte: alle Ortstexte automatisch aus dem
    // mitgelieferten Ortsverzeichnis (wie die Admin-Aktion „Automatisch
    // zuordnen“, aber ohne Protokoll).
    const placeRows = mockPlaceAssignments(data);
    await prisma.place.createMany({ data: placeRows });

    let imageCount = 0;
    const createdImages = new Set<string>();
    await prepareMediaDir(mediaDir);
    if (data.images.length > 0) {
      const { processAndStoreImage } = await import("../lib/media-processing");
      for (const img of data.images) {
        const stored = await processAndStoreImage(await renderImage(img), {
          keyBase: img.id,
        });
        await prisma.mediaAsset.create({
          data: {
            id: img.id,
            ...stored,
            fileName: img.fileName,
            caption: img.caption,
            uploadedById: "mock-user-admin",
          },
        });
        if (img.personId) {
          await prisma.personMedia.create({
            data: { personId: img.personId, mediaId: img.id, isPrimary: img.isPrimary },
          });
        }
        if (img.relationshipId) {
          await prisma.relationshipMedia.create({
            data: { relationshipId: img.relationshipId, mediaId: img.id, isPrimary: img.isPrimary },
          });
        }
        imageCount++;
        createdImages.add(img.id);
      }
    }

    // Quellen und Belege — der Scan nur, wenn das Bild angelegt wurde.
    await prisma.source.createMany({
      data: data.sources.map(({ scanImageId, ...src }) => ({
        ...src,
        mediaId: scanImageId && createdImages.has(scanImageId) ? scanImageId : null,
      })),
    });
    await prisma.citation.createMany({ data: data.citations });

    const perFamily = data.families
      .map((f) => `${f.name}: ${data.persons.filter((p) => p.familyKeys.includes(f.key)).length}`)
      .join(", ");
    const generations = new Set(data.persons.map((p) => p.generation)).size;

    console.log(
      `[mock] Fertig: ${data.persons.length} Personen über ${generations} Generationen, ` +
        `${data.relationships.length} Beziehungen, ${imageCount} Bilder, ` +
        `${data.sources.length} Quellen mit ${data.citations.length} Belegen, ` +
        `${data.events.length} Ereignisse, ${data.personNames.length} weitere Namen, ${placeRows.length} Ortszuordnungen.`,
    );
    console.log(`[mock] Je Familie: ${perFamily}; ohne Familie: ${data.landmarks.noFamily.length}`);
    console.log("[mock] Benutzer (Dev-Login):");
    for (const u of data.users) {
      const fam = u.families.map((f) => `${f.familyKey}:${f.role}`).join(" ") || "–";
      console.log(`         ${u.email.padEnd(24)} ${u.role.padEnd(7)} ${u.status.padEnd(8)} KI:${u.aiAccess.padEnd(5)} ${fam}`);
    }
    console.log(`[mock] ${data.apiTokens.length} feste KI-Testschlüssel (nur Tests, siehe prisma/mock-data.ts).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[mock] Fehler:", err);
  process.exit(1);
});
