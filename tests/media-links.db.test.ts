/**
 * Bilder an Ereignissen, Belegen und Quellen gegen die Mock-Datenbank:
 * Rechte (Ziele bearbeitbar, Bild sichtbar, alles oder nichts), Größe und Typ,
 * die Regel „wo erscheint welches Bild“, Lösen (letzte Zuordnung), Audit mit
 * betroffenen Personen, die MCP-Werkzeuge add_media/link_media (base64, per
 * Adresse ohne echtes Netz, abgelehnte interne Adressen) und Export (JSON,
 * GEDCOM mit OBJE an SOUR/Ereignis/Beleg, Familienauswahl).
 *
 * Legt eigene Personen, Quellen und Bilder an (Medienordner der Tests) und
 * räumt sie samt Audit-Einträgen wieder ab. Überspringt sich ohne Mock-DB.
 */
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { canViewMedia } from "@/lib/media-scope";
import {
  addMedia,
  authorizeAiCall,
  createCitation,
  createEvent,
  createPerson,
  createSource,
  deleteEvent,
  getPersonDetail,
  getSource,
  linkMedia,
  listPersonCitations,
  mediaErrorReason,
  scopeForEmail,
  ServiceError,
  unlinkMedia,
} from "@/lib/services";
import { removeOrphanedMedia } from "@/lib/services/media";
import { buildExport } from "@/lib/services/exchange-export";
import { buildGedcomExport } from "@/lib/services/gedcom-export";
import { createMcpServer } from "@/mcp/register";
import type { ResolvedAddress, Transport } from "@/lib/safe-fetch";
import { mockData } from "./helpers";

const dbReady = !(await mockDbSkipReason());
if (!dbReady) console.warn("\n[tests] Bilder-an-Einträgen-Tests übersprungen: Mock-Datenbank nicht erreichbar.\n");

const data = mockData();
const famId = (key: string) => data.families.find((f) => f.key === key)!.id;
const tag = `medien-${Date.now().toString(36)}`;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof ServiceError) return mediaErrorReason(err) ?? err.code;
    throw err;
  }
}

const png = (r: number) =>
  sharp({ create: { width: 12, height: 9, channels: 3, background: { r, g: 120, b: 200 } } }).png().toBuffer();

describe.skipIf(!dbReady)("Bilder an Ereignissen, Belegen und Quellen", () => {
  let admin: Scope, editor: Scope, viewer: Scope, nofamily: Scope;
  const persons: string[] = [];
  const sources: string[] = [];
  const media: string[] = [];
  let pA: string, pB: string, pC: string;
  let eA: string, eB: string;
  let srcA: string;
  let cA1: string, cA2: string, cB: string;
  let imgC: string;

  beforeAll(async () => {
    [admin, editor, viewer, nofamily] = await Promise.all([
      scope("admin@example.test"),
      scope("editor@example.test"),
      scope("viewer@example.test"),
      scope("nofamily@example.test"),
    ]);
    const mk = async (key: string, given: string) => {
      const p = await createPerson(admin, { givenName: given, familyName: `Medien${tag}`, familyIds: [famId(key)] });
      persons.push(p.id);
      return p.id;
    };
    pA = await mk("A", "Anna");
    pB = await mk("B", "Bernd");
    pC = await mk("C", "Clara");
    eA = (await createEvent(admin, { personId: pA, type: "BAPTISM", date: "1850", place: "Celle" })).id;
    eB = (await createEvent(admin, { personId: pB, type: "BURIAL", date: "1901" })).id;
    srcA = (await createSource(admin, { title: `Kirchenbuch ${tag}`, kind: "CHURCH_BOOK" })).id;
    sources.push(srcA);
    cA1 = (await createCitation(admin, { sourceId: srcA, personId: pA, fact: "BIRTH", detail: "S. 12" })).id;
    cA2 = (await createCitation(admin, { sourceId: srcA, eventId: eA, detail: "S. 13" })).id;
    cB = (await createCitation(admin, { sourceId: srcA, personId: pB, fact: "DEATH", detail: "S. 40" })).id;
    imgC = (await addMedia(admin, { bytes: await png(9), fileName: "clara.png", targets: { personIds: [pC] } })).media.id;
    media.push(imgC);
  });

  afterAll(async () => {
    const ids = [...persons, ...sources, ...media, eA, eB, cA1, cA2, cB].filter(Boolean);
    const logs = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: { in: ids } }, { personIds: { hasSome: persons } }] },
      select: { id: true, changeSetId: true },
    });
    await prisma.auditLog.deleteMany({ where: { id: { in: logs.map((l) => l.id) } } });
    const sets = [...new Set(logs.map((l) => l.changeSetId).filter((x): x is string => Boolean(x)))];
    await prisma.changeSet.deleteMany({ where: { id: { in: sets }, entries: { none: {} } } });
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.source.deleteMany({ where: { id: { in: sources } } });
    await removeOrphanedMedia(media);
  });

  it("Rechte: nur bearbeitbare Ziele, unsichtbare gelten als nicht vorhanden, alles oder nichts", async () => {
    const before = await prisma.mediaAsset.count();
    // Editor: Familie A bearbeiten, Familie B nur sehen
    expect(await code(addMedia(editor, { bytes: await png(1), targets: { eventIds: [eB] } }))).toBe("FORBIDDEN");
    expect(await code(addMedia(editor, { bytes: await png(1), targets: { citationIds: [cB] } }))).toBe("FORBIDDEN");
    expect(await code(addMedia(viewer, { bytes: await png(1), targets: { eventIds: [eA] } }))).toBe("FORBIDDEN");
    expect(await code(addMedia(nofamily, { bytes: await png(1), targets: { eventIds: [eA] } }))).toBe("NOT_FOUND");
    expect(await code(addMedia(editor, { bytes: await png(1), targets: { personIds: [pC] } }))).toBe("NOT_FOUND");
    // Ein erlaubtes und ein verbotenes Ziel: nichts wird angelegt
    expect(await code(addMedia(editor, { bytes: await png(1), targets: { eventIds: [eA, eB] } }))).toBe("FORBIDDEN");
    // Ohne Ziel: in der App nur Admins, über MCP nie
    expect(await code(addMedia(editor, { bytes: await png(1), targets: {} }))).toBe("FORBIDDEN");
    expect(await code(addMedia(admin, { bytes: await png(1), targets: {}, requireTarget: true }))).toBe("VALIDATION");
    expect(await prisma.mediaAsset.count()).toBe(before);

    // Kein Verknüpfen fremder, unsichtbarer Bilder (Familie C sieht der Editor nicht)
    expect(await code(linkMedia(editor, imgC, { eventIds: [eA] }))).toBe("NOT_FOUND");
    expect(await prisma.eventMedia.count({ where: { mediaId: imgC } })).toBe(0);
  });

  it("Größe und Typ: geprüft anhand der Bytes, Angabe muss passen", async () => {
    const prev = process.env.MAX_UPLOAD_BYTES;
    process.env.MAX_UPLOAD_BYTES = "50";
    try {
      expect(await code(addMedia(editor, { bytes: await png(2), targets: { eventIds: [eA] } }))).toBe("TOO_LARGE");
    } finally {
      if (prev === undefined) delete process.env.MAX_UPLOAD_BYTES;
      else process.env.MAX_UPLOAD_BYTES = prev;
    }
    const t = { eventIds: [eA] };
    expect(await code(addMedia(editor, { bytes: Buffer.from("kein Bild"), targets: t }))).toBe("FORMAT");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    expect(await code(addMedia(editor, { bytes: svg, declaredMime: "image/png", targets: t }))).toBe("FORMAT");
    expect(await code(addMedia(editor, { bytes: await png(2), declaredMime: "image/jpeg", targets: t }))).toBe("TYPE_MISMATCH");
    expect(await code(addMedia(editor, { bytes: await png(2), declaredMime: "application/pdf", targets: t }))).toBe("FORMAT");
    expect(await prisma.eventMedia.count({ where: { eventId: eA } })).toBe(0);
  });

  it("Regel: Ereignisbild beim Ereignis, Quellenbild bei allen Belegen — außer es hängt an einem Beleg", async () => {
    const ev = await addMedia(editor, { bytes: await png(3), caption: "Taufschein", targets: { eventIds: [eA] } });
    const src = await addMedia(editor, { bytes: await png(4), caption: "Titelblatt", targets: { sourceIds: [srcA] } });
    const page = await addMedia(editor, { bytes: await png(5), caption: "Seite 12", targets: { sourceIds: [srcA] } });
    media.push(ev.media.id, src.media.id, page.media.id);

    let detail = (await getPersonDetail(viewer, pA))!;
    expect(detail.events.find((e) => e.id === eA)?.media?.map((m) => m.mediaId)).toEqual([ev.media.id]);
    // Personenbilder (Galerie) bleiben getrennt
    expect(detail.media.map((m) => m.mediaId)).not.toContain(ev.media.id);
    let cites = await listPersonCitations(viewer, pA);
    const inherited = (id: string) => cites.find((c) => c.id === id)!.sourceMedia!.map((m) => m.mediaId).sort();
    expect(inherited(cA1)).toEqual([src.media.id, page.media.id].sort());
    expect(inherited(cA2)).toEqual([src.media.id, page.media.id].sort());

    // „Seite 12“ gehört zu Beleg cA1 → nur noch dort (als eigenes Bild)
    await linkMedia(editor, page.media.id, { citationIds: [cA1] });
    cites = await listPersonCitations(viewer, pA);
    expect(cites.find((c) => c.id === cA1)!.media!.map((m) => m.mediaId)).toEqual([page.media.id]);
    expect(inherited(cA1)).toEqual([src.media.id]);
    expect(inherited(cA2)).toEqual([src.media.id]);
    // Familie B (Beleg cB derselben Quelle) bekommt das Titelblatt, nicht Seite 12
    const citesB = await listPersonCitations(admin, pB);
    expect(citesB.find((c) => c.id === cB)!.sourceMedia!.map((m) => m.mediaId)).toEqual([src.media.id]);

    // Quelle: Bilder der Quelle und am Beleg
    const s = (await getSource(viewer, srcA))!;
    expect(s.images.map((m) => m.mediaId).sort()).toEqual([src.media.id, page.media.id].sort());
    expect(s.citations.find((c) => c.id === cA1)!.media.map((m) => m.mediaId)).toEqual([page.media.id]);

    // Sichtbarkeit folgt den Zuordnungen: Betrachter A sieht Ereignis- und
    // Quellenbilder, wer keine Familie hat, sieht nichts davon.
    expect(await canViewMedia(viewer, ev.media.id)).toBe(true);
    expect(await canViewMedia(viewer, src.media.id)).toBe(true);
    expect(await canViewMedia(nofamily, ev.media.id)).toBe(false);
    expect(await canViewMedia(nofamily, src.media.id)).toBe(false);

    detail = (await getPersonDetail(viewer, pA))!;
    expect(detail.events.find((e) => e.id === eA)?.media).toHaveLength(1);
  });

  it("Audit: Hochladen und Verknüpfen mit den betroffenen Personen", async () => {
    const r = await addMedia(editor, { bytes: await png(6), targets: { citationIds: [cA1] } });
    media.push(r.media.id);
    const created = await prisma.auditLog.findFirst({ where: { entityType: "MediaAsset", entityId: r.media.id, action: "CREATE" } });
    expect(created?.personIds).toContain(pA);
    expect(created?.familyIds).toContain(famId("A"));

    await linkMedia(editor, r.media.id, { sourceIds: [srcA] });
    const linked = await prisma.auditLog.findFirst({
      where: { entityType: "MediaAsset", entityId: r.media.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    // Ein Quellenbild betrifft alle Personen, die die Quelle belegt (auch Familie B)
    expect(linked?.personIds).toEqual(expect.arrayContaining([pA, pB]));
    expect((linked?.diff as { linked?: unknown })?.linked).toEqual({ sourceIds: [srcA] });
  });

  it("Lösen: letzte Zuordnung nur in der App (Bild wird dann gelöscht), nie über MCP", async () => {
    const r = await addMedia(editor, { bytes: await png(7), targets: { eventIds: [eA] } });
    media.push(r.media.id);
    expect(await code(unlinkMedia(editor, r.media.id, { eventIds: [eA] }))).toBe("LAST_LINK"); // CONFLICT mit Grund
    expect(await code(unlinkMedia(editor, r.media.id, { citationIds: [cA2] }))).toBe("NOT_FOUND");
    expect(await code(unlinkMedia(viewer, r.media.id, { eventIds: [eA] }))).toBe("FORBIDDEN");

    await linkMedia(editor, r.media.id, { citationIds: [cA2] });
    expect((await unlinkMedia(editor, r.media.id, { eventIds: [eA] })).deleted).toBe(false);
    expect(await prisma.mediaAsset.count({ where: { id: r.media.id } })).toBe(1);
    const last = await unlinkMedia(editor, r.media.id, { citationIds: [cA2] }, { deleteOrphan: true });
    expect(last.deleted).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { id: r.media.id } })).toBe(0);
  });

  it("Ereignis löschen räumt Bilder ab, die nur daran hingen", async () => {
    const e = await createEvent(admin, { personId: pA, type: "RESIDENCE", date: "1870" });
    const only = await addMedia(editor, { bytes: await png(8), targets: { eventIds: [e.id] } });
    const shared = await addMedia(editor, { bytes: await png(10), targets: { eventIds: [e.id, eA] } });
    media.push(only.media.id, shared.media.id);
    await deleteEvent(admin, e.id);
    expect(await prisma.mediaAsset.count({ where: { id: only.media.id } })).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { id: shared.media.id } })).toBe(1);
  });

  describe("MCP: add_media und link_media", () => {
    const PUBLIC: Record<string, string[]> = { "bilder.example": ["93.184.216.34"], "nas.example": ["192.168.1.2"] };
    const resolver = async (host: string): Promise<ResolvedAddress[]> => {
      if (!PUBLIC[host]) throw new Error("ENOTFOUND");
      return PUBLIC[host].map((address) => ({ address, family: 4 as const }));
    };
    let fetched: string[] = [];
    let pngBody: Buffer;
    const transport: Transport = async ({ url, address }) => {
      fetched.push(`${url}@${address.address}`);
      return {
        status: 200,
        headers: { "content-type": "image/png" },
        body: (async function* () {
          yield pngBody;
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
      const client = new Client({ name: "vitest-media", version: "1.0.0" });
      await Promise.all([server.connect(a), client.connect(b)]);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
          structuredContent?: Record<string, unknown>;
        };
        return { isError: Boolean(r.isError), text: r.content[0]?.text ?? "", data: r.structuredContent };
      };
      return { call, close: () => client.close() };
    }

    it("Weg 2 (data_base64), Weg 1 (url) und Weg 3 (media_id); Lese-Werkzeuge zeigen die Bilder", async () => {
      pngBody = await png(11);
      fetched = [];
      const s = await connect("editor@example.test");
      try {
        const viaData = await s.call("add_media", {
          data_base64: `data:image/png;base64,${(await png(12)).toString("base64")}`,
          caption: "Taufeintrag",
          file_name: "taufe.png",
          event_ids: [eA],
        });
        expect(viaData.isError, viaData.text).toBe(false);
        const dataId = (viaData.data!.media as { id: string }).id;
        media.push(dataId);

        const viaUrl = await s.call("add_media", { url: "https://bilder.example/scan/seite13.png", citation_ids: [cA2] });
        expect(viaUrl.isError, viaUrl.text).toBe(false);
        const urlId = (viaUrl.data!.media as { id: string; fileName: string }).id;
        media.push(urlId);
        expect((viaUrl.data!.media as { fileName: string }).fileName).toBe("seite13.png");
        expect(fetched).toEqual(["https://bilder.example/scan/seite13.png@93.184.216.34"]);

        // Interne Adresse: abgelehnt, ohne Verbindung
        fetched = [];
        const internal = await s.call("add_media", { url: "https://nas.example/bild.png", event_ids: [eA] });
        expect(internal.isError).toBe(true);
        expect(internal.text).toContain("internen Netz");
        expect(fetched).toEqual([]);
        // Beides oder nichts angegeben, Typ passt nicht, fremdes Ziel
        expect((await s.call("add_media", { event_ids: [eA] })).isError).toBe(true);
        const mismatch = await s.call("add_media", { data_base64: (await png(13)).toString("base64"), mime_type: "image/gif", event_ids: [eA] });
        expect(mismatch.isError).toBe(true);
        expect(mismatch.text).toContain("passt nicht");
        const foreign = await s.call("add_media", { data_base64: (await png(13)).toString("base64"), event_ids: [eB] });
        expect(foreign.text).toContain("FORBIDDEN");
        expect((await s.call("add_media", { data_base64: (await png(13)).toString("base64") })).isError).toBe(true);

        // Weg 3: vorhandenes Bild an weitere Einträge; Lösen der letzten Zuordnung verweigert
        const link = await s.call("link_media", { media_id: dataId, citation_ids: [cA1] });
        expect(link.isError, link.text).toBe(false);
        expect(link.data!.changed).toBe(1);
        expect((await s.call("link_media", { media_id: imgC, event_ids: [eA] })).text).toContain("NOT_FOUND");
        const unlinkOne = await s.call("link_media", { media_id: dataId, action: "unlink", citation_ids: [cA1] });
        expect(unlinkOne.isError, unlinkOne.text).toBe(false);
        const unlinkLast = await s.call("link_media", { media_id: dataId, action: "unlink", event_ids: [eA] });
        expect(unlinkLast.isError).toBe(true);
        expect(unlinkLast.text).toContain("CONFLICT");

        const person = await s.call("get_person", { person_id: pA });
        const events = person.data!.events as { id: string; media?: { mediaId: string }[] }[];
        expect(events.find((e) => e.id === eA)?.media?.map((m) => m.mediaId)).toContain(dataId);
        const citations = person.data!.citations as { id: string; media?: { mediaId: string }[] }[];
        expect(citations.find((c) => c.id === cA2)?.media?.map((m) => m.mediaId)).toContain(urlId);

        const source = await s.call("get_source", { source_id: srcA });
        expect(source.isError, source.text).toBe(false);
        expect((source.data!.images as unknown[]).length).toBeGreaterThan(0);

        // Changelog: über MCP mit Kanal und Paket
        const log = await prisma.auditLog.findFirst({ where: { entityType: "MediaAsset", entityId: urlId, action: "CREATE" } });
        expect(log?.channel).toBe("MCP");
        expect(log?.changeSetId).toBeTruthy();
        expect(log?.personIds).toContain(pA);
        expect((log?.diff as { url?: string }).url).toBe("https://bilder.example/scan/seite13.png");
      } finally {
        await s.close();
      }
    });

    it("Betrachter: Schreibwerkzeuge verweigern die Änderung", async () => {
      const s = await connect("viewer@example.test");
      try {
        const r = await s.call("add_media", { data_base64: (await png(14)).toString("base64"), event_ids: [eA] });
        expect(r.isError).toBe(true);
      } finally {
        await s.close();
      }
    });
  });

  it("Export: JSON mit Verknüpfungen, GEDCOM mit OBJE an Quelle, Ereignis und Beleg, Familienauswahl", async () => {
    const ev = await addMedia(admin, { bytes: await png(15), caption: "Export-Ereignis", targets: { eventIds: [eA] } });
    const ci = await addMedia(admin, { bytes: await png(16), caption: "Export-Beleg", targets: { citationIds: [cA1] } });
    const so = await addMedia(admin, { bytes: await png(17), caption: "Export-Quelle", targets: { sourceIds: [srcA] } });
    const evB = await addMedia(admin, { bytes: await png(18), caption: "Export-B", targets: { eventIds: [eB] } });
    media.push(ev.media.id, ci.media.id, so.media.id, evB.media.id);

    const { data: full } = await buildExport(admin);
    expect(full.version).toBe(5);
    const mediaIds = new Set(full.media.map((m) => m.id));
    expect(full.events.find((e) => e.id === eA)?.media.map((m) => m.mediaId)).toContain(ev.media.id);
    expect(full.citations.find((c) => c.id === cA1)?.media.map((m) => m.mediaId)).toContain(ci.media.id);
    expect(full.sources.find((s) => s.id === srcA)?.media.map((m) => m.mediaId)).toContain(so.media.id);
    for (const id of [ev.media.id, ci.media.id, so.media.id, evB.media.id]) expect(mediaIds.has(id)).toBe(true);

    // Familienauswahl nur B: Ereignis- und Belegbilder von Anna (A) fehlen, Bernds Bild und das Quellenbild reisen mit
    const { data: onlyB } = await buildExport(admin, { familyIds: [famId("B")], withoutFamily: false });
    const bIds = new Set(onlyB.media.map((m) => m.id));
    expect(bIds.has(evB.media.id)).toBe(true);
    expect(bIds.has(so.media.id)).toBe(true);
    expect(bIds.has(ev.media.id)).toBe(false);
    expect(bIds.has(ci.media.id)).toBe(false);

    // GEDCOM 5.5.1: OBJE unter dem Ereignis (Ebene 2), unter dem Beleg der Geburt (Ebene 3) und im SOUR-Datensatz (Ebene 1)
    const g = await buildGedcomExport(admin, { mediaPrefix: "media/" });
    const records = g.text.split(/\r?\n(?=0 )/);
    const fileOf = (id: string) => full.media.find((m) => m.id === id)!.fileName;
    const indi = records.find((r) => r.includes(`/Medien${tag}/`) && r.includes("Anna"))!;
    expect(indi).toBeTruthy();
    expect(indi).toMatch(new RegExp(`1 BAPM[\\s\\S]*?2 OBJE\\r?\\n3 FILE media/${fileOf(ev.media.id).replace(".", "\\.")}`));
    expect(indi).toMatch(new RegExp(`1 BIRT[\\s\\S]*?2 SOUR @[^@]+@[\\s\\S]*?3 OBJE\\r?\\n4 FILE media/${fileOf(ci.media.id).replace(".", "\\.")}`));
    const sour = records.find((r) => r.includes(`1 TITL Kirchenbuch ${tag}`))!;
    expect(sour).toContain(`1 OBJE`);
    expect(sour).toContain(`2 FILE media/${fileOf(so.media.id)}`);
    expect(g.mediaFiles.has(fileOf(so.media.id))).toBe(true);
  });
});
