/**
 * Karte und Ortszuordnung gegen die Mock-Datenbank: Datenschutz der
 * Kartendaten (nur sichtbare Personen, auch nicht in Zahlen), Linien,
 * Admin-Rechte der Ortszuordnung, „von Hand nie überschreiben“ und das
 * Protokoll. Räumt die eigenen Änderungen an der Tabelle Place wieder ab.
 * Überspringt sich, wenn die Mock-Datenbank fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { loadMapView } from "@/lib/services/map";
import { assignPlace, autoAssignPlaces, listPlaces, searchPlaceDirectory } from "@/lib/services/places";
import { placeKey } from "@/lib/places/normalize";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Karten-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const byId = new Map(data.persons.map((p) => [p.id, p]));

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Karte (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Betrachter (Familie A): nur Personen aus Familie A, Zahlen ohne gesperrte", async () => {
    const viewer = await scope("viewer@example.test");
    const view = await loadMapView(viewer, { mode: "all", currentYear: 2025 });
    const visibleIds = data.persons.filter((p) => p.familyKeys.includes("A")).map((p) => p.id);
    expect(view.selected).toBe(visibleIds.length);
    for (const p of view.payload.persons) expect(byId.get(p.id)?.familyKeys).toContain("A");
    expect(view.payload.persons.length + view.payload.undated).toBe(visibleIds.length);
    // Ohne Bezugsperson keine Linien.
    expect(view.person).toBeNull();
    expect(view.payload.persons.every((p) => !p.ln)).toBe(true);
  });

  it("ohne Familie: nichts, auch keine Zahl", async () => {
    const nofamily = await scope("nofamily@example.test");
    const view = await loadMapView(nofamily, { mode: "all" });
    expect(view.selected).toBe(0);
    expect(view.payload.persons).toEqual([]);
    expect(view.payload.undated).toBe(0);
    expect(view.payload.places).toEqual([]);
  });

  it("Bearbeiter: Vorfahren seiner eigenen Person, gesperrte Großeltern fehlen", async () => {
    const editor = await scope("editor@example.test");
    const view = await loadMapView(editor, { currentYear: 2025 });
    expect(view.mode).toBe("ancestors");
    expect(view.person).toMatchObject({ id: L.selfEditor, isSelf: true });
    // Großeltern mütterlicherseits gehören nur zu Familie D → für ihn gesperrt.
    expect(view.grandparents?.MF).toBeNull();
    expect(view.grandparents?.MM).toBeNull();
    expect(view.grandparents?.FF).not.toBeNull();
    for (const p of view.payload.persons) {
      const keys = byId.get(p.id)!.familyKeys;
      expect(keys.includes("A") || keys.includes("B")).toBe(true);
    }
    const self = view.payload.persons.find((p) => p.id === L.selfEditor);
    expect(self).toBeDefined();
    expect(view.payload.persons.some((p) => (p.ln ?? 0) > 0)).toBe(true);
  });

  it("gesperrte Ausgangsperson in der Adresse wird ignoriert", async () => {
    const editor = await scope("editor@example.test");
    const dOnly = data.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
    const view = await loadMapView(editor, { person: dOnly.id });
    expect(view.person?.id).toBe(L.selfEditor);
    expect(view.payload.persons.some((p) => p.id === dOnly.id)).toBe(false);
    // Admin darf sie wählen.
    const admin = await scope("admin@example.test");
    const asAdmin = await loadMapView(admin, { person: dOnly.id });
    expect(asAdmin.person?.id).toBe(dOnly.id);
  });

  it("Admin, alle Personen: Orte der Mock-Daten auf der Karte, Ereignisorte eingeschlossen", async () => {
    const admin = await scope("admin@example.test");
    const view = await loadMapView(admin, { mode: "all" });
    const labels = view.payload.places.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(["Wrocław (Breslau), Polen", "Timișoara (Temeswar), Rumänien", "Berkum, Saarland, Deutschland"]));
    expect(view.payload.unmappedTexts).toBe(0);
  });
});

describe.skipIf(Boolean(skipReason))("Ortszuordnung (Mock-Datenbank)", () => {
  const KIEL = "Kiel";

  afterAll(async () => {
    // Ausgangszustand: Kiel wieder automatisch zugeordnet.
    const admin = await scope("admin@example.test");
    await assignPlace(admin, { action: "reset", text: KIEL });
    await autoAssignPlaces(admin);
    await prisma.$disconnect();
  });

  it("nur für Administratoren", async () => {
    const editor = await scope("editor@example.test");
    await expect(listPlaces(editor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(searchPlaceDirectory(editor, "Kiel")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(autoAssignPlaces(editor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignPlace(editor, { action: "unresolvable", text: KIEL })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Liste mit Häufigkeit und Status", async () => {
    const admin = await scope("admin@example.test");
    const list = await listPlaces(admin, { q: "kiel" });
    const kiel = list.rows.find((r) => r.key === "kiel")!;
    expect(kiel.count).toBeGreaterThan(1);
    expect(kiel.status).toBe("auto");
    expect(kiel.suggestion?.label).toMatch(/^Kiel, Schleswig-Holstein/);
    expect(list.counts.all).toBeGreaterThanOrEqual(36);
  });

  it("von Hand Bestätigtes überschreibt die automatische Zuordnung nie, alles wird protokolliert", async () => {
    const admin = await scope("admin@example.test");
    // Ausgangszustand (auch nach einem abgebrochenen Lauf): automatisch zugeordnet.
    await assignPlace(admin, { action: "reset", text: KIEL });
    await autoAssignPlaces(admin);
    const before = await prisma.auditLog.count({ where: { entityType: "Place" } });

    await assignPlace(admin, { action: "coordinates", text: KIEL, latitude: 54.5, longitude: 10.5, precision: "REGION", label: "Kieler Förde" });
    const auto = await autoAssignPlaces(admin);
    expect(auto.manual).toBeGreaterThanOrEqual(1);
    const row = await prisma.place.findUnique({ where: { key: placeKey(KIEL) } });
    expect(row).toMatchObject({ source: "MANUAL", latitude: 54.5, longitude: 10.5, precision: "REGION", label: "Kieler Förde" });

    await assignPlace(admin, { action: "unresolvable", text: KIEL });
    await autoAssignPlaces(admin);
    expect(await prisma.place.findUnique({ where: { key: "kiel" } })).toMatchObject({ source: "MANUAL", unresolvable: true, latitude: null });
    // Nicht zuordenbar: der Text „Kiel“ hat keine Koordinaten mehr (andere
    // Schreibweisen wie „Kiel, Schleswig-Holstein, Germany“ behalten ihre).
    const view = await loadMapView(admin, { mode: "all" });
    expect(view.payload.unmappedTexts).toBe(1);

    // Zurücksetzen: wieder offen, die automatische Zuordnung füllt es.
    await assignPlace(admin, { action: "reset", text: KIEL });
    expect(await prisma.place.findUnique({ where: { key: "kiel" } })).toBeNull();
    const again = await autoAssignPlaces(admin);
    expect(again.created).toBe(1);
    expect(await prisma.place.findUnique({ where: { key: "kiel" } })).toMatchObject({ source: "AUTO", precision: "PLACE" });

    const entries = await prisma.auditLog.findMany({
      where: { entityType: "Place" },
      orderBy: { createdAt: "asc" },
      skip: before,
    });
    expect(entries.map((e) => e.action)).toEqual(["UPDATE", "UPDATE", "DELETE", "CREATE"]);
    expect(entries.every((e) => e.userId === "mock-user-admin")).toBe(true);
  });

  it("Suche im Verzeichnis, Bestätigen übernimmt den Treffer", async () => {
    const admin = await scope("admin@example.test");
    const hits = await searchPlaceDirectory(admin, "Breslau");
    const wroclaw = hits.find((h) => h.label.startsWith("Wrocław"))!;
    expect(wroclaw).toBeDefined();
    await assignPlace(admin, { action: "confirm", text: KIEL });
    expect(await prisma.place.findUnique({ where: { key: "kiel" } })).toMatchObject({ source: "MANUAL", precision: "PLACE" });
  });
});
