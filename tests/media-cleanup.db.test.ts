/**
 * Löschen einer Person bzw. Beziehung räumt deren Bilder mit ab — samt
 * Dateien im Objektspeicher (hier durch eine Attrappe ersetzt, damit der
 * Test keinen Bucket anfasst). Bilder, die noch woanders hängen, bleiben.
 *
 * Läuft gegen die Mock-Datenbank und überspringt sich ohne sie.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const deleted = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/storage", () => ({
  BUCKET: "attrappe",
  deleteObject: vi.fn(async (key: string) => {
    deleted.push(key);
  }),
  putObject: vi.fn(),
  getObjectStream: vi.fn(),
  getObjectBuffer: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { createPerson, createRelationship, deletePerson, deleteRelationship, scopeForEmail } from "@/lib/services";

async function ready(): Promise<boolean> {
  try {
    return Boolean(await prisma.user.findUnique({ where: { id: "mock-user-admin" } }));
  } catch {
    return false;
  }
}
const dbReady = await ready();
if (!dbReady) console.warn("\n[tests] Bild-Aufräumtests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const tag = `cleanup-${Date.now().toString(36)}`;

async function asset(name: string) {
  return prisma.mediaAsset.create({
    data: {
      storageKey: `test/${tag}/${name}`,
      thumbnailKey: `test/${tag}/${name}-thumb`,
      mimeType: "image/webp",
      sizeBytes: 1,
      fileName: `${name}.webp`,
    },
  });
}

describe.skipIf(!dbReady)("Bilder beim Löschen aufräumen", () => {
  const persons: string[] = [];
  const media: string[] = [];

  beforeEach(() => {
    deleted.length = 0;
  });

  afterAll(async () => {
    await prisma.mediaAsset.deleteMany({ where: { id: { in: media } } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
  });

  it("deletePerson löscht eigene Bilder und Hochzeitsbilder, nicht geteilte und keine Scans", async () => {
    const scope = (await scopeForEmail("admin@example.test"))!;
    const a = await createPerson(scope, { givenName: `Test ${tag} A`, familyIds: ["mock-family-a"] });
    const b = await createPerson(scope, { givenName: `Test ${tag} B`, familyIds: ["mock-family-a"] });
    persons.push(a.id, b.id);
    const marriage = await createRelationship(scope, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: a.id, toPersonId: b.id });

    const own = await asset("own");
    const shared = await asset("shared");
    const wedding = await asset("wedding");
    const scan = await asset("scan");
    media.push(own.id, shared.id, wedding.id, scan.id);
    await prisma.personMedia.createMany({
      data: [
        { personId: a.id, mediaId: own.id, isPrimary: true },
        { personId: a.id, mediaId: shared.id },
        { personId: b.id, mediaId: shared.id },
        { personId: a.id, mediaId: scan.id },
      ],
    });
    await prisma.relationshipMedia.create({ data: { relationshipId: marriage.id, mediaId: wedding.id } });
    const source = await prisma.source.create({ data: { title: `Test ${tag}`, mediaId: scan.id } });

    try {
      await deletePerson(scope, a.id, { force: true });

      const left = new Set((await prisma.mediaAsset.findMany({ where: { id: { in: media } } })).map((m) => m.id));
      expect(left.has(own.id)).toBe(false);
      expect(left.has(wedding.id)).toBe(false);
      expect(left.has(shared.id)).toBe(true); // hängt noch an B
      expect(left.has(scan.id)).toBe(true); // Scan einer Quelle
      expect(deleted.sort()).toEqual(
        [own.storageKey, own.thumbnailKey, wedding.storageKey, wedding.thumbnailKey].sort(),
      );
    } finally {
      await prisma.source.delete({ where: { id: source.id } });
    }
  });

  it("deleteRelationship löscht die Hochzeitsbilder", async () => {
    const scope = (await scopeForEmail("admin@example.test"))!;
    const a = await createPerson(scope, { givenName: `Test ${tag} C`, familyIds: ["mock-family-a"] });
    const b = await createPerson(scope, { givenName: `Test ${tag} D`, familyIds: ["mock-family-a"] });
    persons.push(a.id, b.id);
    const marriage = await createRelationship(scope, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: a.id, toPersonId: b.id });
    const wedding = await asset("wedding2");
    media.push(wedding.id);
    await prisma.relationshipMedia.create({ data: { relationshipId: marriage.id, mediaId: wedding.id } });

    await deleteRelationship(scope, marriage.id);

    expect(await prisma.mediaAsset.count({ where: { id: wedding.id } })).toBe(0);
    expect(deleted.sort()).toEqual([wedding.storageKey, wedding.thumbnailKey].sort());
  });
});
