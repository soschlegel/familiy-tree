/**
 * Ansicht „Ringe“, Richtung „Nachfahren“, gegen die Mock-Datenbank
 * (lib/services/descendant-rings.ts): Flächen und Begriffe, Gewichtung,
 * Adoption (leiblich und adoptiert, keine Stief- und Pflegekinder),
 * Partner, Rechte (der Sohn der Cousine des Bearbeiters gehört nur zu
 * Familie D und erscheint nur als „nicht freigegeben“ — ohne Kennung,
 * ohne irgendetwas von ihm oder seiner Tochter), Tiefe, Obergrenze,
 * Startperson. Nur lesend. Überspringt sich, wenn die Mock-Datenbank fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { defaultDescendantRingsRootId, loadDescendantRings } from "@/lib/services/descendant-rings";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Nachfahren-Ringe-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

const childrenIn = (parentId: string) =>
  data.relationships
    .filter((r) => r.type === "PARENT_OF" && r.fromPersonId === parentId && (r.subtype === "BIOLOGICAL" || r.subtype === "ADOPTIVE"))
    .map((r) => r.toPersonId);

describe.skipIf(Boolean(skipReason))("Nachfahren-Ringe (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Administrator: Kinder im ersten Ring, Begriffe, Vollkreis, Zählung, Legende", async () => {
    const r = await loadDescendantRings(await scope("admin@example.test"), L.founders.B);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("nachfahren");
    expect(r!.generations).toBe(4);
    expect(r!.capped).toBe(false);
    const first = r!.segments.filter((s) => s.generation === 1);
    expect(new Set(first.map((s) => (s.kind === "person" ? s.personId : "")))).toEqual(new Set(childrenIn(L.founders.B)));
    // Vollkreis ab 9 Uhr, lückenlos bis auf Gruppenlücken.
    expect(first[0].start).toBe(180);
    expect(first[first.length - 1].end).toBeCloseTo(540, 2);
    for (const s of first) {
      expect(s.kind === "person" && /^(Sohn|Tochter|Kind)$/.test(s.term)).toBe(true);
    }
    expect(r!.segments.some((s) => s.generation === 2 && /^Enkel/.test(s.term))).toBe(true);
    // Jede tiefere Fläche liegt im Bogen ihres Elternteils.
    const byKey = new Map(r!.segments.map((s) => [s.key, s]));
    for (const s of r!.segments) {
      if (!s.parentKey) continue;
      const p = byKey.get(s.parentKey)!;
      expect(s.generation).toBe(p.generation + 1);
      expect(s.start).toBeGreaterThanOrEqual(p.start - 0.01);
      expect(s.end).toBeLessThanOrEqual(p.end + 0.01);
    }
    expect(r!.deepest).toBeGreaterThanOrEqual(3);
    expect(r!.count).toBe(new Set(r!.segments.map((s) => (s.kind === "person" ? s.personId : s.key))).size);
    expect(r!.lines).toHaveLength(first.length);
    expect(r!.lines.reduce((s, l) => s + l.count, 0)).toBe(r!.segments.length);
    expect(r!.areas.reduce((s, a) => s + a.count, 0)).toBe(r!.segments.length);
    // Partner der Mitte genannt.
    expect(r!.partners[L.founders.B]?.length).toBeGreaterThan(0);
  });

  it("Adoptivkind zählt mit und ist vermerkt; Stief- und Pflegekinder nicht", async () => {
    const admin = await scope("admin@example.test");
    const [father] = L.adoptiveParents;
    const r = await loadDescendantRings(admin, father, 3);
    const adoptee = r!.segments.find((s) => s.kind === "person" && s.personId === L.adoptee);
    expect(adoptee?.kind === "person" && adoptee.adopted).toBe(true);
    const [fosterFather] = L.fosterParents;
    const f = await loadDescendantRings(admin, fosterFather, 3);
    expect(f!.segments.some((s) => s.kind === "person" && s.personId === L.fosterChild)).toBe(false);
    const step = data.relationships.find((x) => x.type === "PARENT_OF" && x.subtype === "STEP")!;
    const s = await loadDescendantRings(admin, step.fromPersonId, 3);
    expect(s!.segments.some((x) => x.kind === "person" && x.personId === step.toPersonId)).toBe(false);
  });

  it("Bearbeiter: gesperrter Nachkomme nur als „nicht freigegeben“, nichts von ihm und seinen Kindern", async () => {
    const { parent, child, grandchild } = L.descendantHidden;
    const mine = await loadDescendantRings(await scope("editor@example.test"), parent, 7);
    expect(mine).not.toBeNull();
    expect(mine!.segments).toHaveLength(1);
    const [s] = mine!.segments;
    expect(s.kind).toBe("restricted");
    // Neutraler Begriff: das Geschlecht bleibt verborgen.
    expect(s.term).toBe("Kind");
    expect(mine!.restricted).toBe(1);
    expect(mine!.count).toBe(1);
    expect(mine!.deepest).toBe(1);
    const json = JSON.stringify(mine);
    for (const id of [child, grandchild]) expect(json).not.toContain(id);
    for (const id of [child, grandchild]) {
      const p = data.persons.find((x) => x.id === id)!;
      expect(json).not.toContain(p.givenName);
    }
    // Personen der Antwort: genau die Mitte.
    expect(Object.keys(mine!.persons)).toEqual([parent]);

    // Der Administrator sieht beide.
    const all = await loadDescendantRings(await scope("admin@example.test"), parent, 7);
    expect(all!.segments.map((x) => (x.kind === "person" ? x.personId : "?"))).toEqual([child, grandchild]);
    expect(all!.segments[1].term).toBe("Enkelin");
  });

  it("Tiefe: Standard 4, aus der Adresse auf 3…7 begrenzt", async () => {
    const admin = await scope("admin@example.test");
    expect((await loadDescendantRings(admin, L.founders.A, "12"))!.generations).toBe(7);
    expect((await loadDescendantRings(admin, L.founders.A, "1"))!.generations).toBe(3);
    const three = await loadDescendantRings(admin, L.founders.A, 3);
    expect(Math.max(...three!.segments.map((s) => s.generation))).toBeLessThanOrEqual(3);
  });

  it("Obergrenze: weniger Generationen und Hinweis", async () => {
    const admin = await scope("admin@example.test");
    const r = await loadDescendantRings(admin, L.founders.B, 7, 15);
    expect(r!.capped).toBe(true);
    expect(r!.shownGenerations).toBeLessThan(7);
    expect(Math.max(...r!.segments.map((s) => s.generation))).toBe(r!.shownGenerations);
  });

  it("nicht sichtbare oder unbekannte Mitte: null; Startperson mit Kindern", async () => {
    expect(await loadDescendantRings(await scope("nofamily@example.test"), L.founders.A)).toBeNull();
    expect(await loadDescendantRings(await scope("admin@example.test"), "gibt-es-nicht")).toBeNull();
    expect(await loadDescendantRings(await scope("editor@example.test"), L.descendantHidden.child)).toBeNull();
    const viewer = await scope("viewer@example.test");
    const id = await defaultDescendantRingsRootId(viewer);
    expect(id).not.toBeNull();
    expect((await loadDescendantRings(viewer, id!))!.segments.length).toBeGreaterThan(0);
    expect(await defaultDescendantRingsRootId(await scope("nofamily@example.test"))).toBeNull();
  });
});
