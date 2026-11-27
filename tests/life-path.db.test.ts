/**
 * „Lebensweg“ auf der Karte gegen die Mock-Datenbank (lib/services/life-path.ts):
 * Stationen einer Person, Vater- und Mutterlinie, Datenschutz (Partner und
 * Vorfahren, die der Benutzer nicht sehen darf) und der Einstieg von der
 * Personenseite. Legt kurzzeitig eine gesperrte Partnerin und einen
 * Ortstext ohne Zuordnung an und räumt sie wieder ab. Überspringt sich, wenn
 * die Mock-Datenbank fehlt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { lifePathEntry, loadLifePathView } from "@/lib/services/life-path";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Lebensweg-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const byId = new Map(data.persons.map((p) => [p.id, p]));
const fullName = (id: string) => [byId.get(id)!.givenName, byId.get(id)!.familyName].filter(Boolean).join(" ");

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

/** Erfundene Angaben der kurzzeitig angelegten Datensätze. */
const HIDDEN = { givenName: "Wilhelmine", familyName: "Geheimrath", place: "Bremen", eventPlace: "Kiel" };
const UNASSIGNED = "Erfundenhausen am Testsee";

describe.skipIf(Boolean(skipReason))("Lebensweg (Mock-Datenbank)", () => {
  const founderA = L.founders.A;
  const created: { person?: string; rel?: string; events: string[] } = { events: [] };

  beforeAll(async () => {
    // Zweite Ehe des Stammvaters A mit einer Partnerin nur aus Familie D
    // (für Betrachter und Bearbeiter gesperrt), mit Heiratsort und Verlobung.
    const hidden = await prisma.person.create({
      data: { givenName: HIDDEN.givenName, familyName: HIDDEN.familyName, gender: "FEMALE", families: { create: [{ familyId: "mock-family-d" }] } },
    });
    created.person = hidden.id;
    const rel = await prisma.relationship.create({
      data: {
        type: "PARTNER_OF",
        subtype: "MARRIED",
        fromPersonId: founderA,
        toPersonId: hidden.id,
        startDate: new Date(Date.UTC(1910, 0, 1)),
        startDatePrecision: "YEAR",
        startPlace: HIDDEN.place,
      },
    });
    created.rel = rel.id;
    const engagement = await prisma.event.create({
      data: { relationshipId: rel.id, type: "ENGAGEMENT", date: new Date(Date.UTC(1909, 0, 1)), datePrecision: "YEAR", place: HIDDEN.eventPlace },
    });
    // Wohnort mit einem Ortstext ohne Zuordnung (automatische Zuordnung ist in Tests aus).
    const residence = await prisma.event.create({
      data: { personId: founderA, type: "RESIDENCE", date: new Date(Date.UTC(1895, 0, 1)), datePrecision: "YEAR", place: UNASSIGNED },
    });
    created.events.push(engagement.id, residence.id);
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: created.events } } });
    if (created.rel) await prisma.relationship.deleteMany({ where: { id: created.rel } });
    if (created.person) await prisma.person.deleteMany({ where: { id: created.person } });
    await prisma.$disconnect();
  });

  it("Person: Geburt vorn, Tod und Beerdigung hinten, ohne Datum getrennt, gleiche Orte zusammengefasst", async () => {
    const viewer = await scope("viewer@example.test");
    const view = await loadLifePathView(viewer, { person: founderA, kind: "person" });
    expect(view.person?.id).toBe(founderA);
    const path = view.path!;
    const line = path.stations.filter((s) => s.n !== null);
    expect(line[0].title).toBe("Geburt");
    expect(line.slice(-2).map((s) => s.title)).toEqual(["Tod", "Beerdigung"]);
    expect(line.map((s) => s.n)).toEqual(line.map((_, i) => i + 1));
    // Geburt und Taufe am selben Ort → ein Punkt mit zwei Stationen.
    expect(path.points[0].stations.length).toBeGreaterThanOrEqual(2);
    // Heirat mit der sichtbaren Ehefrau samt Verlobung (Ereignis der Ehe).
    expect(line.some((s) => s.title.startsWith("Heirat mit "))).toBe(true);
    expect(line.some((s) => s.title.startsWith("Verlobung (mit "))).toBe(true);
    // Beruf ohne Datum: nur in der Liste, ohne Nummer und Punkt.
    const job = path.stations.find((s) => s.title === "Beruf")!;
    expect(job).toMatchObject({ n: null, point: null });
    // Ungenaue Geburt („um …“) ist als solche beschriftet.
    expect(line[0].approx).toBe(true);
    expect(line[0].dateText).toMatch(/^um /);
    // Ortstext ohne Zuordnung: in der Liste, nicht auf der Karte.
    const unassigned = path.stations.find((s) => s.placeText === UNASSIGNED)!;
    expect(unassigned).toMatchObject({ placeStatus: "unassigned", point: null });
    expect(path.segments.some((s) => s.skipped)).toBe(true);
  });

  it("Datenschutz: Heirat und Ereignisse mit gesperrter Partnerin fehlen ganz", async () => {
    for (const email of ["viewer@example.test", "editor@example.test"]) {
      const view = await loadLifePathView(await scope(email), { person: founderA, kind: "person" });
      const json = JSON.stringify(view);
      expect(json).not.toContain(HIDDEN.givenName);
      expect(json).not.toContain(HIDDEN.familyName);
      expect(json).not.toContain(created.rel!);
      expect(view.path!.stations.some((s) => s.dateText.includes("1910") || s.dateText.includes("1909"))).toBe(false);
    }
    // Der Admin sieht sie.
    const admin = await loadLifePathView(await scope("admin@example.test"), { person: founderA, kind: "person" });
    expect(admin.path!.stations.map((s) => s.title)).toEqual(
      expect.arrayContaining([`Heirat mit ${HIDDEN.givenName} ${HIDDEN.familyName}`, `Verlobung (mit ${HIDDEN.givenName} ${HIDDEN.familyName})`]),
    );
  });

  it("Vaterlinie des Bearbeiters: älteste Generation zuerst, Vorfahr ohne Ort gestrichelt übersprungen", async () => {
    const editor = await scope("editor@example.test");
    const view = await loadLifePathView(editor, { kind: "father" });
    expect(view.person?.id).toBe(L.selfEditor);
    const st = view.path!.stations;
    expect(st[st.length - 1].personId).toBe(L.selfEditor);
    expect(st[st.length - 1].detail).toBe("Ausgangsperson");
    expect(st[st.length - 2].detail).toBe("Vater");
    // Jeder Vorfahr der Linie ist männlich und für den Bearbeiter sichtbar.
    for (const s of st.slice(0, -1)) {
      const p = byId.get(s.personId!)!;
      expect(p.gender).toBe("MALE");
      expect(p.familyKeys.some((k) => k === "A" || k === "B")).toBe(true);
    }
    expect(st.every((s) => s.n !== null)).toBe(true);
    expect(view.lineEnd).toBe("none");
    // Ein Vorfahr ohne Geburts- und Taufort → Teilstück übersprungen.
    if (st.some((s) => s.placeStatus === "none")) expect(view.path!.segments.some((s) => s.skipped)).toBe(true);
  });

  it("Mutterlinie des Bearbeiters endet an gesperrten Vorfahren — ohne Name, Ort oder Kennung", async () => {
    const editor = await scope("editor@example.test");
    const view = await loadLifePathView(editor, { kind: "mother" });
    expect(view.lineEnd).toBe("restricted");
    const json = JSON.stringify(view);
    for (const p of data.persons.filter((x) => !x.familyKeys.some((k) => k === "A" || k === "B"))) {
      expect(json).not.toContain(`"${p.id}"`);
      expect(json).not.toContain(fullName(p.id));
    }
    for (const s of view.path!.stations) {
      const keys = byId.get(s.personId!)!.familyKeys;
      expect(keys.includes("A") || keys.includes("B")).toBe(true);
      expect(byId.get(s.personId!)!.gender).toBe(s.personId === L.selfEditor ? byId.get(L.selfEditor)!.gender : "FEMALE");
    }
    // Der Admin sieht die Linie weiter hinauf.
    const admin = await loadLifePathView(await scope("admin@example.test"), { person: L.selfEditor, kind: "mother" });
    expect(admin.path!.stations.length).toBeGreaterThan(view.path!.stations.length);
  });

  it("gesperrte Person in der Adresse fällt auf die Bezugsperson zurück", async () => {
    const editor = await scope("editor@example.test");
    const dOnly = data.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
    const view = await loadLifePathView(editor, { person: dOnly.id, kind: "person" });
    expect(view.person?.id).toBe(L.selfEditor);
    expect(JSON.stringify(view)).not.toContain(fullName(dOnly.id));
    // Ohne Familie: keine Person, kein Weg.
    const none = await loadLifePathView(await scope("nofamily@example.test"), { person: founderA, kind: "person" });
    expect(none).toMatchObject({ person: null, path: null });
  });

  it("Einstieg von der Personenseite: nur mit mindestens zwei Punkten", async () => {
    const viewer = await scope("viewer@example.test");
    expect(await lifePathEntry(viewer, founderA)).toBe("person");
    const editor = await scope("editor@example.test");
    const entry = await lifePathEntry(editor, L.selfEditor);
    expect(entry === "person" || entry === "father" || entry === "mother").toBe(true);
    // Gesperrte Person: kein Einstieg.
    const dOnly = data.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!;
    expect(await lifePathEntry(editor, dOnly.id)).toBeNull();
  });
});
