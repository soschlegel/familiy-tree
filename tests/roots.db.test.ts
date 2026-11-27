/**
 * „Wurzeln“ gegen die Mock-Datenbank (lib/services/roots.ts): Rechte
 * (gesperrte Großeltern des Bearbeiters erscheinen nur als „nicht
 * freigegeben“, nichts von ihnen in der Antwort), Stufen Land/Region,
 * Eingabeprüfung. Nur lesend. Überspringt sich, wenn die Mock-Datenbank
 * fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { ROOTS_LABELS } from "@/lib/roots";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { getPersonRoots } from "@/lib/services/roots";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Wurzeln-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

const sum = (xs: { percent: number }[]) => xs.reduce((s, x) => s + x.percent, 0);

describe.skipIf(Boolean(skipReason))("Wurzeln (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Administrator: alles sichtbar, nichts „nicht freigegeben“, Summe 100", async () => {
    const admin = await scope("admin@example.test");
    const r = await getPersonRoots(admin, L.selfEditor);
    expect(r).not.toBeNull();
    expect(r!.generations).toBe(4);
    expect(r!.level).toBe("country");
    expect(r!.parentCount).toBe(2);
    expect(r!.slots).toBe(16);
    expect(r!.slices.some((s) => s.kind === "restricted")).toBe(false);
    expect(r!.slices.find((s) => s.kind === "area")?.label).toBe("Deutschland");
    expect(sum(r!.slices)).toBe(100);
  });

  it("Bearbeiter: Großeltern aus fremder Familie nur als „nicht freigegeben“, nichts von ihnen in der Antwort", async () => {
    const editor = await scope("editor@example.test");
    const admin = await scope("admin@example.test");
    const mine = await getPersonRoots(editor, L.selfEditor, { level: "region" });
    const all = await getPersonRoots(admin, L.selfEditor, { level: "region" });
    const restricted = mine!.slices.find((s) => s.kind === "restricted");
    expect(restricted?.label).toBe(ROOTS_LABELS.restricted);
    // Die Großeltern mütterlicherseits (nur Familie D) tragen zusammen die Hälfte.
    expect(restricted?.share).toBeCloseTo(0.5);
    expect(mine!.filledSlots).toBeLessThan(all!.filledSlots);
    expect(sum(mine!.slices)).toBe(100);
    // Keine Kennungen, keine Gebiete, die nur über gesperrte Vorfahren kämen.
    const json = JSON.stringify(mine);
    expect(json.match(/mock-p-\d+/g) ?? []).toEqual([L.selfEditor]);
    const visibleAreas = new Set(all!.slices.map((s) => s.label));
    for (const s of mine!.slices) {
      if (s.kind === "area") expect(visibleAreas.has(s.label)).toBe(true);
    }
    const onlyHidden = all!.slices.filter((s) => s.kind === "area" && !mine!.slices.some((m) => m.label === s.label));
    expect(onlyHidden.length).toBeGreaterThan(0);
  });

  it("nach Region: Bundesland und Land", async () => {
    const admin = await scope("admin@example.test");
    const r = await getPersonRoots(admin, L.selfEditor, { level: "region", generations: 3 });
    expect(r!.generations).toBe(3);
    const areas = r!.slices.filter((s) => s.kind === "area");
    expect(areas.length).toBeGreaterThan(1);
    for (const s of areas) expect(s.label).toMatch(/, Deutschland$/);
  });

  it("nicht sichtbare Ausgangsperson: null — wie nicht vorhanden", async () => {
    const nofamily = await scope("nofamily@example.test");
    expect(await getPersonRoots(nofamily, L.selfEditor)).toBeNull();
    const admin = await scope("admin@example.test");
    expect(await getPersonRoots(admin, "gibt-es-nicht")).toBeNull();
  });

  it("ungültige Angaben: Validierungsfehler", async () => {
    const admin = await scope("admin@example.test");
    await expect(getPersonRoots(admin, L.selfEditor, { generations: 9 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getPersonRoots(admin, L.selfEditor, { generations: "abc" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getPersonRoots(admin, L.selfEditor, { level: "stadt" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("Stammvater ohne Eltern: parentCount 0, keine Stücke", async () => {
    const admin = await scope("admin@example.test");
    const rels = await prisma.relationship.findMany({ where: { type: "PARENT_OF", subtype: "BIOLOGICAL" }, select: { toPersonId: true } });
    const withParents = new Set(rels.map((r) => r.toPersonId));
    const orphan = data.persons.find((p) => !withParents.has(p.id))!;
    const r = await getPersonRoots(admin, orphan.id);
    expect(r).toMatchObject({ parentCount: 0, slices: [] });
  });
});
