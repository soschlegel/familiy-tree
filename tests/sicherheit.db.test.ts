/**
 * Befunde der Sicherheitsprüfung (docs/sicherheit.md) gegen die
 * Mock-Datenbank: Löschregel für Quellen-Scans (auch über „lösen“),
 * verborgene Personen beim Anlegen von Beziehungen, keine Bildverluste über
 * den KI-Zugang, add_media prüft Ziele vor dem Abruf, keine internen
 * Fehlermeldungen an KI-Clients.
 *
 * Familien der Mock-Daten: Editor = A bearbeiten, B nur sehen, C gar nicht.
 * Legt eigene Personen, Quellen und Bilder an und räumt sie wieder ab.
 */
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { canDeleteMedia } from "@/lib/media-scope";
import {
  addMedia,
  authorizeAiCall,
  createCitation,
  createEvent,
  createPerson,
  createRelationship,
  createSource,
  deleteEvent,
  deleteRelationship,
  scopeForEmail,
  ServiceError,
  unlinkMedia,
} from "@/lib/services";
import { removeOrphanedMedia } from "@/lib/services/media";
import { createMcpServer } from "@/mcp/register";
import type { ResolvedAddress, Transport } from "@/lib/safe-fetch";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const dbReady = !(await mockDbSkipReason());
if (!dbReady) console.warn("\n[tests] Sicherheits-Tests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const data = mockData();
const famId = (key: string) => data.families.find((f) => f.key === key)!.id;
const tag = `sich-${Date.now().toString(36)}`;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

/** Scope wie beim KI-Zugang (mit `via`). */
async function aiScope(email: string): Promise<Scope> {
  const r = await authorizeAiCall({ kind: "dev", email, allowWrite: true }, "WRITE");
  if (!r.ok) throw new Error(r.message);
  return r.scope;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof ServiceError) return err.code;
    throw err;
  }
}

const png = (r: number) =>
  sharp({ create: { width: 10, height: 8, channels: 3, background: { r, g: 90, b: 160 } } }).png().toBuffer();

describe.skipIf(!dbReady)("Sicherheitsbefunde (Mock-Datenbank)", () => {
  let admin: Scope, editor: Scope;
  const persons: string[] = [];
  const sources: string[] = [];
  const media: string[] = [];
  let pA: string, pA2: string, pB: string, pB2: string, pC: string;
  let shared: string;

  beforeAll(async () => {
    [admin, editor] = await Promise.all([scope("admin@example.test"), scope("editor@example.test")]);
    const mk = async (key: string, given: string) => {
      const p = await createPerson(admin, { givenName: given, familyName: `Sicher${tag}`, familyIds: [famId(key)] });
      persons.push(p.id);
      return p.id;
    };
    pA = await mk("A", "Anton");
    pA2 = await mk("A", "Agnes");
    pB = await mk("B", "Berta");
    pB2 = await mk("B", "Bruno");
    pC = await mk("C", "Cäsar");
    // Gemeinsam genutzte Quelle: ein Beleg in A (Editor darf ändern), einer in B (nur sehen).
    shared = (await createSource(admin, { title: `Kirchenbuch ${tag}`, kind: "CHURCH_BOOK" })).id;
    sources.push(shared);
    await createCitation(admin, { sourceId: shared, personId: pA, fact: "BIRTH", detail: "S. 1" });
    await createCitation(admin, { sourceId: shared, personId: pB, fact: "BIRTH", detail: "S. 2" });
  });

  afterAll(async () => {
    const logs = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: { in: [...persons, ...sources, ...media] } }, { personIds: { hasSome: persons } }] },
      select: { id: true, changeSetId: true },
    });
    await prisma.auditLog.deleteMany({ where: { id: { in: logs.map((l) => l.id) } } });
    const sets = [...new Set(logs.map((l) => l.changeSetId).filter((x): x is string => Boolean(x)))];
    await prisma.changeSet.deleteMany({ where: { id: { in: sets }, entries: { none: {} } } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.source.deleteMany({ where: { id: { in: sources } } });
    await removeOrphanedMedia(media);
  });

  it("Scan einer gemeinsam genutzten Quelle: weder löschen noch über „lösen“ entfernen", async () => {
    const scan = (await addMedia(admin, { bytes: await png(1), fileName: "scan.png", targets: { sourceIds: [shared] } })).media.id;
    media.push(scan);
    expect(await canDeleteMedia(editor, scan)).toBe(false);
    expect(await canDeleteMedia(admin, scan)).toBe(true);
    expect(await code(unlinkMedia(editor, scan, { sourceIds: [shared] }, { deleteOrphan: true }))).toBe("FORBIDDEN");
    expect(await prisma.mediaAsset.count({ where: { id: scan } })).toBe(1);
    expect(await prisma.sourceMedia.count({ where: { mediaId: scan } })).toBe(1);
  });

  it("Beziehung zu einer verborgenen Person: wie nicht vorhanden (404), nicht 403", async () => {
    expect(await code(createRelationship(editor, { type: "PARENT_OF", fromPersonId: pA, toPersonId: pC }))).toBe("NOT_FOUND");
    expect(await code(createRelationship(editor, { type: "PARENT_OF", fromPersonId: pC, toPersonId: pA }))).toBe("NOT_FOUND");
    expect(await code(createRelationship(editor, { type: "PARENT_OF", fromPersonId: pA, toPersonId: "gibt-es-nicht" }))).toBe("NOT_FOUND");
    // Sichtbar, aber gar nicht bearbeitbar (beide in B): weiterhin 403.
    expect(await code(createRelationship(editor, { type: "PARENT_OF", fromPersonId: pB, toPersonId: pB2 }))).toBe("FORBIDDEN");
  });

  it("KI-Zugang löscht kein Ereignis, an dem allein ein Bild hängt — die App schon", async () => {
    const ai = await aiScope("editor@example.test");
    const ev = (await createEvent(editor, { personId: pA, type: "BAPTISM", date: "1880" })).id;
    const img = (await addMedia(editor, { bytes: await png(2), targets: { eventIds: [ev] } })).media.id;
    media.push(img);
    expect(await code(deleteEvent(ai, ev))).toBe("CONFLICT");
    expect(await prisma.event.count({ where: { id: ev } })).toBe(1);
    expect(await prisma.mediaAsset.count({ where: { id: img } })).toBe(1);
    // Hängt das Bild zusätzlich an der Person, darf die KI das Ereignis löschen.
    const ev2 = (await createEvent(editor, { personId: pA, type: "BURIAL", date: "1950" })).id;
    const img2 = (await addMedia(editor, { bytes: await png(3), targets: { eventIds: [ev2], personIds: [pA] } })).media.id;
    media.push(img2);
    expect(await code(deleteEvent(ai, ev2))).toBe("OK");
    expect(await prisma.mediaAsset.count({ where: { id: img2 } })).toBe(1);
    // In der App (mit Rückfrage) geht es; das Bild verschwindet mit.
    expect(await code(deleteEvent(editor, ev))).toBe("OK");
    expect(await prisma.mediaAsset.count({ where: { id: img } })).toBe(0);
  });

  it("KI-Zugang löscht keine Beziehung, deren Ereignis allein ein Bild trägt", async () => {
    const ai = await aiScope("editor@example.test");
    const rel = (await createRelationship(editor, { type: "PARTNER_OF", fromPersonId: pA, toPersonId: pA2 })).id;
    const ev = (await createEvent(editor, { relationshipId: rel, type: "ENGAGEMENT", date: "1900" })).id;
    const img = (await addMedia(editor, { bytes: await png(4), targets: { eventIds: [ev] } })).media.id;
    media.push(img);
    expect(await code(deleteRelationship(ai, rel))).toBe("CONFLICT");
    expect(await prisma.relationship.count({ where: { id: rel } })).toBe(1);
    // In der App: Beziehung samt Ereignis weg, das verwaiste Bild ebenfalls.
    expect(await code(deleteRelationship(editor, rel))).toBe("OK");
    expect(await prisma.mediaAsset.count({ where: { id: img } })).toBe(0);
  });

  describe("MCP", () => {
    const fetched: string[] = [];
    const resolver = async (): Promise<ResolvedAddress[]> => [{ address: "93.184.216.34", family: 4 }];
    const transport: Transport = async ({ url, address }) => {
      fetched.push(url.toString());
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: (async function* () {
          yield await png(5);
        })(),
        remoteAddress: address.address,
        destroy: () => {},
      };
    };

    async function connect(email: string) {
      const credential = { kind: "dev" as const, email, allowWrite: true };
      const server = createMcpServer({
        label: email,
        allowWrite: true,
        authorize: (need) => authorizeAiCall(credential, need),
        mediaFetch: { resolver, transport },
      });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "vitest-sicherheit", version: "1.0.0" });
      await Promise.all([server.connect(a), client.connect(b)]);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
        return { isError: Boolean(r.isError), text: r.content[0]?.text ?? "" };
      };
      return { call, close: () => client.close() };
    }

    it("add_media per Adresse: ohne bearbeitbares Ziel wird nichts abgerufen", async () => {
      const s = await connect("editor@example.test");
      try {
        fetched.length = 0;
        const hidden = await s.call("add_media", { url: "https://bilder.example/a.png", person_ids: [pC] });
        expect(hidden.isError).toBe(true);
        const readOnly = await s.call("add_media", { url: "https://bilder.example/b.png", person_ids: [pB] });
        expect(readOnly.isError).toBe(true);
        expect(fetched).toEqual([]);
      } finally {
        await s.close();
      }
    });

    it("interne Fehler: nur eine Kennung, keine Datenbankmeldung", async () => {
      const s = await connect("editor@example.test");
      try {
        // Ein Nullzeichen lehnt PostgreSQL ab — ein Fehler außerhalb der Fachlogik.
        const r = await s.call("get_person", { person_id: "x\u0000y" });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/Interner Fehler \(Kennung [a-z0-9]+\)/);
        expect(r.text.toLowerCase()).not.toMatch(/prisma|invalid|byte|postgres|select/);
      } finally {
        await s.close();
      }
    });
  });
});
