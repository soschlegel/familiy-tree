/**
 * Füllt eine SEPARATE Mock-Datenbank mit deterministischen Testdaten
 * (siehe prisma/mock-data.ts) und legt Platzhalterbilder im Mock-Bucket ab.
 *
 * Aufruf über `npm run db:mock` bzw. `npm run mock:setup` (scripts/mock.mjs
 * setzt DATABASE_URL und S3_BUCKET passend). Direkt aufgerufen verweigert das
 * Skript den Dienst, solange der Datenbankname nicht auf _mock oder _test
 * endet — es löscht vor dem Befüllen ALLE Daten der Zieldatenbank.
 *
 * Wiederholbar: jeder Lauf leert die Mock-Datenbank und den Mock-Bucket und
 * baut alles neu auf.
 */
import { PrismaClient } from "@prisma/client";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

import { generateMockData, type MockImage } from "./mock-data";

const MOCK_NAME = /_(mock|test)$/;
const MOCK_BUCKET = /-(mock|test)$/;

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
 * Bucket erreichbar machen: anlegen, falls er fehlt, und leeren, damit ein
 * erneuter Lauf keine verwaisten Dateien hinterlässt. Liefert false, wenn der
 * Objektspeicher nicht erreichbar ist — dann geht es ohne Bilder weiter.
 */
async function prepareBucket(bucket: string): Promise<boolean> {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9100",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
    },
  });

  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) throw err;
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[mock] Bucket ${bucket} angelegt.`);
    }

    let token: string | undefined;
    let removed = 0;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
        removed += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    if (removed > 0) console.log(`[mock] ${removed} alte Objekte aus ${bucket} entfernt.`);
    return true;
  } catch (err) {
    console.warn(
      `[mock] WARNUNG: Objektspeicher (${process.env.S3_ENDPOINT}) nicht erreichbar — ` +
        `es werden keine Bilder angelegt. (${(err as Error).name}: ${(err as Error).message})`,
    );
    return false;
  } finally {
    client.destroy();
  }
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  const dbName = assertMockDatabase(url);

  const bucket = process.env.S3_BUCKET && MOCK_BUCKET.test(process.env.S3_BUCKET)
    ? process.env.S3_BUCKET
    : "familytree-mock";
  // lib/storage liest den Bucket beim Import — deshalb vor dem dynamischen
  // Import setzen.
  process.env.S3_BUCKET = bucket;

  const data = generateMockData();
  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    console.log(`[mock] Ziel: Datenbank ${dbName}, Bucket ${bucket}`);

    // Alles leeren. TRUNCATE … CASCADE ist schneller als deleteMany je
    // Tabelle und hält sich nicht mit Fremdschlüsseln auf.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "AuditLog", "RelationshipMedia", "PersonMedia", "MediaAsset",
        "Relationship", "PersonFamily", "Person", "UserFamily", "Family",
        "Session", "Account", "VerificationToken", "User" CASCADE`,
    );

    const familyId = new Map(data.families.map((f) => [f.key, f.id]));

    await prisma.family.createMany({
      data: data.families.map((f) => ({ id: f.id, name: f.name, description: f.description })),
    });

    await prisma.user.createMany({
      data: data.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
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

    let imageCount = 0;
    if (data.images.length > 0 && (await prepareBucket(bucket))) {
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
      }
    }

    const perFamily = data.families
      .map((f) => `${f.name}: ${data.persons.filter((p) => p.familyKeys.includes(f.key)).length}`)
      .join(", ");
    const generations = new Set(data.persons.map((p) => p.generation)).size;

    console.log(
      `[mock] Fertig: ${data.persons.length} Personen über ${generations} Generationen, ` +
        `${data.relationships.length} Beziehungen, ${imageCount} Bilder.`,
    );
    console.log(`[mock] Je Familie: ${perFamily}; ohne Familie: ${data.landmarks.noFamily.length}`);
    console.log("[mock] Benutzer (Dev-Login):");
    for (const u of data.users) {
      const fam = u.families.map((f) => `${f.familyKey}:${f.role}`).join(" ") || "–";
      console.log(`         ${u.email.padEnd(24)} ${u.role.padEnd(7)} ${u.status.padEnd(8)} ${fam}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[mock] Fehler:", err);
  process.exit(1);
});
