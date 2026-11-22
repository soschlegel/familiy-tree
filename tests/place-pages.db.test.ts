/**
 * Ortsseiten und „echte“ Orte (gegen die Mock-Datenbank):
 * - Ortsseite: mehrere Ortstexte = ein Ort, Sichtbarkeit (gesperrte Personen
 *   weder genannt noch gezählt, ihre Texte fehlen), Admin-Notizen.
 * - Verweise für die Personenseite (placeLinksFor).
 * - Auswahl im Ortsfeld (choosePlaceForEntry): Rechte, nur der eigene Text,
 *   von Hand Bestätigtes bleibt für Bearbeiter.
 * - GEDCOM-Export mit heutiger Form, MAP und NOTE; Rundreise über den
 *   eigenen Import (Originaltext zurück); Austauschformat mit Zuordnungen.
 * - MCP: get_person mit `places`, get_place.
 *
 * Eigene Personen „Vitest-Ortsseite“ in Familie A (Betrachter sieht sie) und
 * Familie B (für den Betrachter gesperrt); räumt alles wieder ab.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { assignNewPlaceTexts, choosePlaceForEntry } from "@/lib/services/places";
import { getPlacePage, placeLinksFor } from "@/lib/services/place-pages";
import { buildGedcomExport } from "@/lib/services/gedcom-export";
import { buildExport } from "@/lib/services/exchange-export";
import { placeKey } from "@/lib/places/normalize";
import { diagnoseGedcom, parseGedcom } from "@/lib/gedcom";
import { mapGedcomDocument } from "@/lib/gedcom-import/mapping";
import * as mcpRoute from "@/app/api/mcp/route";
import { resetMcpRateLimit } from "@/mcp/http";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason({ check: async () => (await prisma.apiToken.count()) > 0, missing: "ohne KI-Testschlüssel" });
if (skipReason) console.warn(`\n[tests] Ortsseiten-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const secretOf = (key: string) => data.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;

const T = {
  breslauA: "Breslau, Kreis Breslau",
  wroclawB: "Wrocław, Dolnośląskie, Polska",
  danzigA: "Danzig, Freie Stadt",
  ownA: "Hof Vitestfeld",
  otherA: "Peine-Berkum, Amt Peine",
};
const KEYS = Object.values(T).map(placeKey);
const created: string[] = [];
const GAZ_BRESLAU = "3081368";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

let personA = "";
let personB = "";

describe.skipIf(Boolean(skipReason))("Ortsseiten, Ortsverweise, Auswahl, Export (Mock-Datenbank)", () => {
  beforeAll(async () => {
    await prisma.place.deleteMany({ where: { key: { in: KEYS } } });
    const a = await prisma.person.create({
      data: {
        givenName: "Anna",
        familyName: "Vitest-Ortsseite",
        birthPlace: T.breslauA,
        birthDate: new Date(Date.UTC(1880, 0, 1)),
        birthDatePrecision: "YEAR",
        deathPlace: T.danzigA,
        families: { create: [{ familyId: "mock-family-a" }] },
        events: { create: [{ type: "RESIDENCE", place: T.ownA, date: new Date(Date.UTC(1905, 0, 1)), datePrecision: "YEAR" }] },
      },
    });
    const b = await prisma.person.create({
      data: {
        givenName: "Berta",
        familyName: "Vitest-Ortsseite",
        birthPlace: T.wroclawB,
        families: { create: [{ familyId: "mock-family-b" }] },
      },
    });
    personA = a.id;
    personB = b.id;
    created.push(a.id, b.id);
    await assignNewPlaceTexts({ userId: "mock-user-admin" }, [T.breslauA, T.wroclawB, T.danzigA]);
  });

  afterAll(async () => {
    for (const c of clients) await c.close().catch(() => {});
    resetMcpRateLimit();
    const places = await prisma.place.findMany({ where: { key: { in: KEYS } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Place", entityId: { in: places.map((p) => p.id) } } });
    await prisma.place.deleteMany({ where: { key: { in: KEYS } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
    await prisma.person.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it("Ortsseite: mehrere Texte ein Ort; gesperrte Personen weder genannt noch gezählt", async () => {
    const ref = `g-${GAZ_BRESLAU}`;
    const viewer = await getPlacePage(await scope("viewer@example.test"), ref);
    expect(viewer).not.toBeNull();
    expect(viewer!.label).toBe("Wrocław (Breslau), Polen");
    expect(viewer!.historicName).toBe("Breslau");
    expect(viewer!.country).toBe("Polen");
    expect(viewer!.otherNames).toContain("Breslau");
    expect(viewer!.notes).toBeUndefined();
    const ids = viewer!.entries.map((e) => e.person.id);
    expect(ids).toContain(personA);
    expect(ids).not.toContain(personB);
    expect(viewer!.texts.map((t) => t.text)).toContain(T.breslauA);
    expect(viewer!.texts.map((t) => t.text)).not.toContain(T.wroclawB);
    expect(viewer!.entries.find((e) => e.person.id === personA)).toMatchObject({ kind: "birth", label: "Geburt", year: 1880, text: T.breslauA });

    const admin = await getPlacePage(await scope("admin@example.test"), ref);
    expect(admin!.entries.map((e) => e.person.id)).toEqual(expect.arrayContaining([personA, personB]));
    expect(admin!.total).toBe(viewer!.total + 1);
    expect(admin!.texts.map((t) => t.text)).toContain(T.wroclawB);
    expect(admin!.notes).toBeDefined();

    // Ohne sichtbare Angabe: für Nicht-Admins nicht vorhanden.
    expect(await getPlacePage(await scope("nofamily@example.test"), ref)).toBeNull();
    expect(await getPlacePage(await scope("admin@example.test"), "g-gibtesnicht")).toBeNull();
    expect(await getPlacePage(await scope("admin@example.test"), "unsinn")).toBeNull();
  });

  it("Verweise für die Personenseite: eine Abfrage, Zusatz nur bei anderem Namen", async () => {
    const links = await placeLinksFor([T.breslauA, T.danzigA, "Unbekanntes Nest", null]);
    expect(links[placeKey(T.breslauA)]).toMatchObject({ ref: `g-${GAZ_BRESLAU}`, short: "Wrocław, Polen", same: false });
    expect(links[placeKey(T.danzigA)]).toMatchObject({ short: "Gdańsk, Polen", same: false });
    expect(links[placeKey("Unbekanntes Nest")]).toBeUndefined();
    const same = await placeLinksFor(["Wrocław, Dolnośląskie, Polska"]);
    expect(same[placeKey(T.wroclawB)].same).toBe(true);
  });

  it("Auswahl im Ortsfeld: speichert genau diesen Text „von Hand“, Rechte und Schutz bestätigter Zuordnungen", async () => {
    const editor = await scope("editor@example.test");
    const viewer = await scope("viewer@example.test");
    const event = await prisma.event.findFirstOrThrow({ where: { personId: personA } });
    const own = { text: T.ownA, eventId: event.id, latitude: 52.3, longitude: 10.2, label: "Hof Vitestfeld, Niedersachsen, Deutschland" };
    await expect(choosePlaceForEntry(viewer, own)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(choosePlaceForEntry(editor, { ...own, text: "Anderer Text" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(choosePlaceForEntry(editor, { ...own, eventId: undefined, personId: personB })).rejects.toMatchObject({ code: "FORBIDDEN" }); // Familie B: nur lesend
    const before = await prisma.place.findUnique({ where: { key: placeKey(T.breslauA) } });

    const r = await choosePlaceForEntry(editor, own);
    expect(r).toMatchObject({ source: "MANUAL", latitude: 52.3, longitude: 10.2, label: own.label });
    // Andere Texte bleiben unberührt.
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.breslauA) } })).toEqual(before);
    // Eigener Ort hat eine Seite (Koordinaten).
    const page = await getPlacePage(editor, "c-52.30000_10.20000");
    expect(page).toMatchObject({ kind: "eigener Ort", name: "Hof Vitestfeld" });
    expect(page!.entries[0]).toMatchObject({ kind: "event", label: "Wohnort", year: 1905 });

    // Verzeichniswahl für die Geburt; danach ist der Text von Hand bestätigt.
    await choosePlaceForEntry(editor, { text: T.breslauA, personId: personA, gazetteerId: GAZ_BRESLAU });
    expect(await prisma.place.findUnique({ where: { key: placeKey(T.breslauA) } })).toMatchObject({ source: "MANUAL", gazetteerId: GAZ_BRESLAU });
    // Ein Bearbeiter ändert eine bestätigte Zuordnung nicht auf ein anderes Ziel, ein Admin schon.
    const other = { text: T.breslauA, personId: personA, latitude: 1, longitude: 2, label: "Falsch" };
    await expect(choosePlaceForEntry(editor, other)).rejects.toMatchObject({ code: "CONFLICT" });
    await choosePlaceForEntry(await scope("admin@example.test"), { text: T.breslauA, personId: personA, gazetteerId: GAZ_BRESLAU });
  });

  it("GEDCOM-Export: heutige Form mit MAP und Originaltext; Rundreise gibt den Freitext zurück", async () => {
    const admin = await scope("admin@example.test");
    const g = await buildGedcomExport(admin, { selection: { familyIds: ["mock-family-a"], withoutFamily: false } });
    const text = g.text;
    const block = text.slice(text.indexOf("1 NAME Anna /Vitest-Ortsseite/"));
    const birth = block.slice(block.indexOf("1 BIRT"), block.indexOf("1 DEAT"));
    expect(birth).toContain("2 PLAC Wrocław, Województwo dolnośląskie, Polen"); // Region wie im Verzeichnis (Landessprache)
    expect(birth).toMatch(/3 MAP\r?\n4 LATI N51\.1\d*\r?\n4 LONG E17\.03\d*/);
    expect(birth).toContain("3 NOTE Originaltext: Breslau, Kreis Breslau");
    // Eigener Ort: Bezeichnung ohne Klammer, Koordinaten.
    expect(block).toContain("2 PLAC Hof Vitestfeld, Niedersachsen, Deutschland");
    expect(block).toMatch(/4 LATI N52\.3\r?\n4 LONG E10\.2/);

    const doc = parseGedcom(text).document;
    expect(diagnoseGedcom(doc).filter((d) => d.severity !== "info" && /PLAC|MAP|LATI|LONG|NOTE/.test(d.message))).toEqual([]);
    const mapped = mapGedcomDocument(doc);
    const anna = mapped.persons.find((p) => p.familyName === "Vitest-Ortsseite" && p.givenName === "Anna")!;
    expect(anna.birthPlace).toBe(T.breslauA);
    expect(anna.deathPlace).toBe(T.danzigA);
    expect(mapped.events.some((e) => e.place === T.ownA)).toBe(true);
  });

  it("Austauschformat: Freitext bleibt, Zuordnungen reisen mit (Notizen nur für Admins)", async () => {
    const editor = await scope("editor@example.test");
    const { data } = await buildExport(editor, { familyIds: ["mock-family-a"], withoutFamily: false });
    expect(data.version).toBe(5);
    expect(data.persons.find((p) => p.id === personA)?.birthPlace).toBe(T.breslauA);
    const pl = data.places.find((p) => placeKey(p.text) === placeKey(T.breslauA));
    expect(pl).toMatchObject({ source: "MANUAL", gazetteerId: GAZ_BRESLAU });
    expect(pl).not.toHaveProperty("note");
    // Nichts aus Familie B.
    expect(data.places.some((p) => placeKey(p.text) === placeKey(T.wroclawB))).toBe(false);
  });

  it("MCP: get_person mit zugeordneten Orten, get_place mit Sichtbarkeit", async () => {
    const s = await connect(secretOf("viewer-read"));
    const p = await s.call("get_person", { person_id: personA });
    expect(p.isError, p.text).toBe(false);
    expect(p.data.places[T.breslauA]).toMatchObject({ placeId: `g-${GAZ_BRESLAU}`, label: expect.stringMatching(/^Wrocław/) });
    expect(p.data.person.birthPlace).toBe(T.breslauA);
    const ev = await s.call("list_events", { person_id: personA });
    expect(ev.data.places[T.ownA]).toMatchObject({ placeId: "c-52.30000_10.20000" });

    const place = await s.call("get_place", { place_id: `g-${GAZ_BRESLAU}` });
    expect(place.isError, place.text).toBe(false);
    expect(place.data.entries.some((e: { person: { id: string } }) => e.person.id === personA)).toBe(true);
    expect(place.data.entries.some((e: { person: { id: string } }) => e.person.id === personB)).toBe(false);
    expect(JSON.stringify(place.data)).not.toContain("Berta");
    const byText = await s.call("get_place", { text: T.danzigA });
    expect(byText.data.label).toMatch(/^Gdańsk/);
    expect((await s.call("get_place", { text: "Unbekanntes Nest" })).isError).toBe(true);
  });
});

const URL_MCP = "http://localhost:3100/api/mcp";
const clients: Client[] = [];

async function connect(secret: string) {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: async (input: string | URL | Request, init?: RequestInit) => mcpRoute.POST(new Request(input, init)),
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  const client = new Client({ name: "vitest-place-pages", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return {
    // Werkzeugergebnisse sind frei geformtes JSON; im Test bewusst untypisiert.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: any; text: string }> => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
      const text = r.content[0]?.text ?? "";
      const isError = Boolean(r.isError);
      return { isError, data: isError ? null : JSON.parse(text), text };
    },
  };
}
