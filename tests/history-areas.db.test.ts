/**
 * Zeitgeschichte mit Geltungsbereich gegen die Mock-Datenbank
 * (lib/services/history.ts, lib/services/history-areas.ts):
 * - anlegen/ändern mit Bereich über Dienst und Route, ungültige Schlüssel
 *   abgelehnt, Verwaltungszustand mit Länderliste und Namen;
 * - Lebenslauf-Zeile: Reihenfolge nach den Orten der Person zur Zeit des
 *   Ereignisses — ein eingeschränkter Benutzer sieht nur die Wirkung der
 *   Orte, die er sehen darf (Heiratsort mit gesperrtem Partner zählt nicht);
 * - Zeitstrahl im Baum: „andere Gegend“ nur aus Orten sichtbarer Personen.
 *
 * Legt kurzzeitig erfundene Personen, Ortstexte und Zuordnungen an und
 * räumt sie wieder ab (eigene Präfixe, keine fremden Datensätze).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

import { prisma } from "@/lib/prisma";
import {
  createHistoryEvent,
  getLifetimeHistory,
  getPersonDetail,
  historyAdminState,
  listHistoryEventsForTree,
  loadGraph,
  scopeForEmail,
  updateHistoryEvent,
} from "@/lib/services";
import { historyAreaLegend, placeAreasOf } from "@/lib/services/history-areas";
import type { Scope } from "@/lib/scope";
import { placeKey, normalizeForLookup } from "@/lib/places/normalize";
import { loadGazetteerSync } from "@/lib/places/gazetteer-file";
import { POST as createPost } from "@/app/api/history-events/route";
import { GET as areasGet } from "@/app/api/history-events/areas/route";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Zeitgeschichte-Gebiete übersprungen: ${skipReason}\n`);

/** Erfundene Ortstexte (eigene Schreibweise, damit keine Mock-Zuordnung berührt wird). */
const PLACES = {
  ost: { text: "Zgr-Testort bei Dresden", name: "Dresden", cc: "DE" },
  west: { text: "Zgr-Testort bei München", name: "München", cc: "DE" },
  paris: { text: "Zgr-Testort bei Paris", name: "Paris", cc: "FR" },
};
const TITLE = "Zgr-Test";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Zeitgeschichte mit Geltungsbereich (Mock-Datenbank)", () => {
  const created = { persons: [] as string[], rels: [] as string[], places: [] as string[] };
  let subject = "";

  async function cleanup() {
    await prisma.historyEvent.deleteMany({ where: { title: { startsWith: TITLE } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "HistoryEvent", diff: { path: ["title"], string_starts_with: TITLE } } });
  }

  beforeAll(async () => {
    await cleanup();
    const gaz = loadGazetteerSync();
    const entry = (name: string, cc: string) => {
      // Größter Ort des Namens (es gibt auch Dörfer namens „München“).
      const hit = (gaz.byName.get(normalizeForLookup(name)) ?? [])
        .map((i) => gaz.entries[i])
        .filter((e) => e.kind === "P" && e.cc === cc)
        .sort((a, b) => b.pop - a.pop)[0];
      if (!hit) throw new Error(`nicht im Ortsverzeichnis: ${name}`);
      return hit;
    };
    for (const p of Object.values(PLACES)) {
      const e = entry(p.name, p.cc);
      const fields = { text: p.text, source: "MANUAL" as const, precision: "PLACE" as const, latitude: e.lat, longitude: e.lon, label: p.name, countryCode: p.cc, gazetteerId: e.id };
      const row = await prisma.place.upsert({ where: { key: placeKey(p.text) }, create: { key: placeKey(p.text), ...fields }, update: fields });
      created.places.push(row.id);
    }
    // Person in Familie A (für den Betrachter sichtbar): geboren 1950 bei Dresden.
    const person = await prisma.person.create({
      data: {
        givenName: "Erfunden",
        familyName: "Zgr-Testperson",
        gender: "MALE",
        birthDate: new Date(Date.UTC(1950, 4, 1)),
        birthDatePrecision: "DAY",
        deathDate: new Date(Date.UTC(2000, 4, 1)),
        deathDatePrecision: "DAY",
        birthPlace: PLACES.ost.text,
        families: { create: [{ familyId: "mock-family-a" }] },
      },
    });
    subject = person.id;
    // Partnerin nur in Familie D (für den Betrachter gesperrt), Heirat 1960 bei München.
    const hidden = await prisma.person.create({
      data: { givenName: "Erfunden", familyName: "Zgr-Gesperrt", gender: "FEMALE", birthPlace: PLACES.paris.text, families: { create: [{ familyId: "mock-family-d" }] } },
    });
    created.persons.push(person.id, hidden.id);
    const rel = await prisma.relationship.create({
      data: {
        type: "PARTNER_OF",
        subtype: "MARRIED",
        fromPersonId: person.id,
        toPersonId: hidden.id,
        startDate: new Date(Date.UTC(1960, 0, 1)),
        startDatePrecision: "YEAR",
        startPlace: PLACES.west.text,
      },
    });
    created.rels.push(rel.id);
  });

  afterAll(async () => {
    session.current = null;
    await cleanup();
    await prisma.relationship.deleteMany({ where: { id: { in: created.rels } } });
    await prisma.person.deleteMany({ where: { id: { in: created.persons } } });
    await prisma.place.deleteMany({ where: { id: { in: created.places } } });
    await prisma.$disconnect();
  });

  it("Ortstexte → Gebiet (Land, Region) in einer Abfrage; offene Texte fehlen", async () => {
    const areas = await placeAreasOf([PLACES.ost.text, PLACES.paris.text, "Zgr-gibt-es-nicht"]);
    expect(areas.get(placeKey(PLACES.ost.text))).toEqual({ country: "DE", region: "DE.13", regionName: "Sachsen" });
    expect(areas.get(placeKey(PLACES.paris.text))).toMatchObject({ country: "FR", region: "FR.11" });
    expect(areas.has(placeKey("Zgr-gibt-es-nicht"))).toBe(false);
  });

  it("Lebenslauf: Bearbeiter mit sichtbarer Partnerin — Umzug nach Bayern zählt", async () => {
    const admin = await scope("admin@example.test");
    const h = (await getLifetimeHistory((await getPersonDetail(admin, subject))!, undefined, new Date(Date.UTC(2026, 10, 27))))!;
    expect(h.regional).toBe(true);
    // 1955–1973: 1955 bei Dresden, ab 1960 bei München → Westdeutschland passt.
    const all = [...h.top, ...h.rest];
    expect(all.map((e) => e.id)).toContain("anwerbung-gastarbeiter");
    expect(all.find((e) => e.id === "anwerbung-gastarbeiter")!.near).toBe("Bayern");
    // Mauerbau 1961: zuletzt bei München → „Land“, nicht „Ort“ (dann ohne Bezug).
    expect(all.find((e) => e.id === "mauerbau")).toBeTruthy();
    expect(all.find((e) => e.id === "mauerbau")!.near).toBeUndefined();
    expect(h.other.map((e) => e.id)).not.toContain("anwerbung-gastarbeiter");
  });

  it("Lebenslauf: eingeschränkter Benutzer — Heiratsort mit gesperrter Partnerin zählt nicht", async () => {
    const viewer = await scope("viewer@example.test");
    const detail = (await getPersonDetail(viewer, subject))!;
    expect(detail).toBeTruthy();
    const h = (await getLifetimeHistory(detail, undefined, new Date(Date.UTC(2026, 10, 27))))!;
    // Nur der Geburtsort bei Dresden: Mauerbau trifft den Ort, die Anwerbung passt nicht.
    expect(h.top.find((e) => e.id === "mauerbau")!.near).toBe("Sachsen");
    expect(h.other.map((e) => e.id)).toContain("anwerbung-gastarbeiter");
    expect(JSON.stringify(h)).not.toContain("Bayern");
  });

  it("Zeitstrahl: „andere Gegend“ nur aus Orten sichtbarer Personen", async () => {
    const admin = await scope("admin@example.test");
    const viewer = await scope("viewer@example.test");
    const forAdmin = await listHistoryEventsForTree(await loadGraph(admin));
    const forViewer = await listHistoryEventsForTree(await loadGraph(viewer));
    const fr = (list: typeof forAdmin) => list.find((e) => e.id === "franzoesische-revolution")!;
    // Die gesperrte Partnerin ist bei Paris geboren — nur der Administrator sieht sie.
    expect(fr(forAdmin).foreign).toBeUndefined();
    expect(fr(forViewer).foreign).toBe(true);
    // Weltweite Ereignisse sind nie „andere Gegend“.
    expect(forViewer.find((e) => e.id === "spanische-grippe")!.foreign).toBeUndefined();
  });

  it("anlegen und ändern mit Bereich; unbekannte Schlüssel abgelehnt; ohne Angabe bleibt der Bereich", async () => {
    const admin = await scope("admin@example.test");
    const base = { title: `${TITLE} Hochwasser`, yearFrom: "1882", kind: "not" };
    await expect(createHistoryEvent(admin, { ...base, areas: ["DE.99"] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createHistoryEvent(admin, { ...base, areas: ["QQ"] })).rejects.toMatchObject({ code: "VALIDATION" });
    const c = await createHistoryEvent(admin, { ...base, areas: ["group:ostdeutschland", "DE"] });
    expect(c.areas).toEqual(["DE", "DE.11", "DE.12", "DE.13", "DE.14", "DE.15", "DE.16"]);
    const u = await updateHistoryEvent(admin, c.id, { ...base, areas: ["DE.13"] });
    expect(u.areas).toEqual(["DE.13"]);
    const kept = await updateHistoryEvent(admin, c.id, { ...base, description: "Der Fluss trat über." });
    expect(kept.areas).toEqual(["DE.13"]);
    const cleared = await updateHistoryEvent(admin, c.id, { ...base, areas: [] });
    expect(cleared.areas).toEqual([]);

    const state = await historyAdminState(admin);
    expect(state.areaCatalog.countries).toContainEqual({ key: "DE", name: "Deutschland" });
    expect(state.areaCatalog.labels["DE.13"]).toBe("Sachsen (Deutschland)");
    expect(state.builtin.find((b) => b.id === "mauerfall")!.areas).toContain("DE.16");
  });

  it("Route: Bereich anlegen (Administrator), Regionen eines Landes nur für Administratoren", async () => {
    const users = Object.fromEntries(mockData().users.map((u) => [u.email, u]));
    const req = (method: string, path: string, body?: unknown) =>
      new Request(`http://localhost:3999${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const params = { params: Promise.resolve({}) } as never;
    session.current = { user: { id: users["admin@example.test"].id, role: "ADMIN" } };
    const ok = await createPost(req("POST", "/api/history-events", { title: `${TITLE} Stadtbrand`, yearFrom: "1842", kind: "not", areas: ["DE.13"] }), params);
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { areas: string[] }).areas).toEqual(["DE.13"]);
    const bad = await createPost(req("POST", "/api/history-events", { title: `${TITLE} Stadtbrand 2`, yearFrom: "1843", kind: "not", areas: ["Sachsen"] }), params);
    expect(bad.status).toBe(400);
    const regions = await areasGet(req("GET", "/api/history-events/areas?country=AT"), params);
    expect(regions.status).toBe(200);
    const legend = (await regions.json()) as Awaited<ReturnType<typeof historyAreaLegend>>;
    expect(legend.country?.regions).toContainEqual({ key: "AT.09", name: "Wien" });
    expect(legend.groups.length).toBeGreaterThan(5);
    session.current = { user: { id: users["editor@example.test"].id, role: users["editor@example.test"].role } };
    expect((await areasGet(req("GET", "/api/history-events/areas?country=AT"), params)).status).toBe(403);
  });
});
