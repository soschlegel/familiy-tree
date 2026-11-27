/**
 * Ansicht „Ringe“ gegen die Mock-Datenbank (lib/services/ancestor-rings.ts):
 * Plätze und Verwandtschaftsstufen, Rechte (die Großeltern
 * mütterlicherseits des Bearbeiters gehören nur zu Familie D und erscheinen
 * nur als „nicht freigegeben“ — ohne Kennung, ohne irgendetwas von ihnen
 * oder ihren Vorfahren), Tiefe, Färbung nach Land, Startperson. Nur lesend.
 * Überspringt sich, wenn die Mock-Datenbank fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { defaultRingsRootId, loadAncestorRings } from "@/lib/services/ancestor-rings";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Ringe-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Ringe (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Administrator: Eltern und Großeltern auf festen Plätzen, Begriffe, Färbung nach Land", async () => {
    const r = await loadAncestorRings(await scope("admin@example.test"), L.selfEditor);
    expect(r).not.toBeNull();
    expect(r!.generations).toBe(5);
    expect(r!.root.id).toBe(L.selfEditor);
    expect(r!.restricted).toBe(0);
    const slot = (g: number, i: number) => r!.slots.find((s) => s.generation === g && s.index === i);
    const father = slot(1, 0);
    const mother = slot(1, 1);
    expect(father?.kind === "person" && r!.persons[father.personId].gender).toBe("MALE");
    expect(mother?.kind === "person" && r!.persons[mother.personId].gender).toBe("FEMALE");
    expect(father?.term).toBe("Vater");
    expect(slot(2, 3)?.term).toBe("Großmutter mütterlicherseits");
    // Sortiert innen nach außen; jeder Platz höchstens einmal, jeder hat ein Kind.
    const keys = r!.slots.map((s) => `${s.generation}:${s.index}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of r!.slots) {
      if (s.generation > 1) expect(keys).toContain(`${s.generation - 1}:${s.index >> 1}`);
    }
    expect(r!.known).toBe(r!.slots.length);
    // Nach Land: Deutschland mit Zahl der Plätze.
    const de = r!.areas.find((a) => a.label === "Deutschland");
    expect(de?.count).toBeGreaterThan(0);
    expect(r!.areas.reduce((s, a) => s + a.count, 0)).toBe(r!.slots.length);
  });

  it("Bearbeiter: Großeltern aus fremder Familie nur als „nicht freigegeben“, nichts von ihnen in der Antwort", async () => {
    const all = await loadAncestorRings(await scope("admin@example.test"), L.selfEditor, 7);
    const mine = await loadAncestorRings(await scope("editor@example.test"), L.selfEditor, 7);
    expect(mine!.generations).toBe(7);
    const restricted = mine!.slots.filter((s) => s.kind === "restricted");
    expect(restricted.map((s) => `${s.generation}:${s.index}`)).toEqual(["2:2", "2:3"]);
    expect(mine!.restricted).toBe(2);
    // Neutraler Begriff: Geschlecht einer gesperrten Person bleibt verborgen.
    expect(restricted.every((s) => s.term === "Großelternteil mütterlicherseits")).toBe(true);
    // Hinter den gesperrten Plätzen nichts.
    expect(mine!.slots.some((s) => s.generation > 2 && slotSideIndex(s.generation, s.index) >= 2)).toBe(false);

    // Keine Kennung und keine Lebensdaten der gesperrten Vorfahren und ihrer Ahnen.
    const hidden = all!.slots.filter((s) => s.generation >= 2 && slotSideIndex(s.generation, s.index) >= 2);
    expect(hidden.length).toBeGreaterThan(0);
    const json = JSON.stringify(mine);
    for (const s of hidden) {
      if (s.kind !== "person") continue;
      expect(json).not.toContain(`"${s.personId}"`);
      const p = all!.persons[s.personId];
      const fullName = `${p.givenName} ${p.familyName ?? ""}`.trim();
      const shown = Object.values(mine!.persons).map((q) => `${q.givenName} ${q.familyName ?? ""}`.trim());
      expect(shown).not.toContain(fullName);
    }
    // Personen der Antwort: genau die Ausgangsperson und die sichtbaren Plätze.
    const ids = new Set([L.selfEditor, ...mine!.slots.flatMap((s) => (s.kind === "person" ? [s.personId] : []))]);
    expect(new Set(Object.keys(mine!.persons))).toEqual(ids);
  });

  it("Tiefe: aus der Adresse auf 3…7 begrenzt", async () => {
    const admin = await scope("admin@example.test");
    expect((await loadAncestorRings(admin, L.selfEditor, "12"))!.generations).toBe(7);
    expect((await loadAncestorRings(admin, L.selfEditor, "1"))!.generations).toBe(3);
    const three = await loadAncestorRings(admin, L.selfEditor, 3);
    expect(Math.max(...three!.slots.map((s) => s.generation))).toBeLessThanOrEqual(3);
  });

  it("nicht sichtbare oder unbekannte Ausgangsperson: null", async () => {
    expect(await loadAncestorRings(await scope("nofamily@example.test"), L.selfEditor)).toBeNull();
    expect(await loadAncestorRings(await scope("admin@example.test"), "gibt-es-nicht")).toBeNull();
  });

  it("Startperson: sichtbar und mit Eltern; ohne Freigabe keine", async () => {
    const viewer = await scope("viewer@example.test");
    const id = await defaultRingsRootId(viewer);
    expect(id).not.toBeNull();
    const r = await loadAncestorRings(viewer, id!);
    expect(r!.slots.length).toBeGreaterThan(0);
    expect(await defaultRingsRootId(await scope("nofamily@example.test"))).toBeNull();
  });
});

/** Großeltern-Viertel (0 VV, 1 VM, 2 MV, 3 MM) eines Platzes ab Generation 2. */
function slotSideIndex(generation: number, index: number): number {
  return index >> (generation - 2);
}
