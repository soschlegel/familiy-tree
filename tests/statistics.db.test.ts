/**
 * Seite „Statistik“ gegen die Mock-Datenbank (lib/services/statistics.ts):
 * Administrator gegenüber eingeschränkten Benutzern, Familienfilter (nur
 * eigene Familien), Stufe Land/Region und dass die Antwort keine Kennungen
 * und nichts aus gesperrten Familien enthält. Nur lesend; überspringt sich
 * ohne Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { getStatistics, scopeForEmail } from "@/lib/services";
import { getFamilyStatistics } from "@/lib/services/statistics";
import { surnameForCount } from "@/lib/statistics";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Statistik-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const FAMILY_A = "mock-family-a";
const FAMILY_D = "mock-family-d";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Statistik (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Zahlen passen zu getStatistics; eingeschränkte Benutzer sehen weniger", async () => {
    const [admin, editor, viewer] = await Promise.all([
      scope("admin@example.test"),
      scope("editor@example.test"),
      scope("viewer@example.test"),
    ]);
    for (const s of [admin, editor, viewer]) {
      const [mine, research] = await Promise.all([getFamilyStatistics(s), getStatistics(s)]);
      expect(mine.totals.persons).toBe(research.persons.total);
      expect(mine.totals.partnerships).toBe(research.relationships.partnerships);
      expect(mine.totals.parentChild).toBe(research.relationships.parentChild);
      expect(mine.gender.slices.reduce((a, x) => a + x.value, 0)).toBe(mine.totals.persons);
      expect(mine.birthPlaces.slices.reduce((a, x) => a + x.percent, 0)).toBe(100);
    }
    const a = await getFamilyStatistics(admin);
    const e = await getFamilyStatistics(editor);
    const v = await getFamilyStatistics(viewer);
    expect(v.totals.persons).toBeLessThan(e.totals.persons);
    expect(e.totals.persons).toBeLessThan(a.totals.persons);
    expect(v.children.parents).toBeLessThan(a.children.parents);
    expect(v.families.map((f) => f.id)).toEqual([FAMILY_A]);
  });

  it("nichts aus gesperrten Familien: keine Kennungen, keine Namen nur von gesperrten Personen", async () => {
    const viewer = await scope("viewer@example.test");
    const v = await getFamilyStatistics(viewer);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/mock-p-\d+/);
    expect(json).not.toContain(FAMILY_D);

    const visibleSurnames = new Set(
      data.persons.filter((p) => p.familyKeys.includes("A")).map((p) => surnameForCount(p)?.toLocaleLowerCase("de")),
    );
    for (const bar of v.surnames.bars) expect(visibleSurnames.has(bar.label.toLocaleLowerCase("de"))).toBe(true);
  });

  it("Familienfilter: Admin mit Familie A = Betrachter von Familie A; fremde Familie gilt als „Alle“", async () => {
    const [admin, viewer, editor] = await Promise.all([
      scope("admin@example.test"),
      scope("viewer@example.test"),
      scope("editor@example.test"),
    ]);
    const filtered = await getFamilyStatistics(admin, { familyId: FAMILY_A });
    const viewerAll = await getFamilyStatistics(viewer);
    expect(filtered.familyId).toBe(FAMILY_A);
    expect(filtered.totals).toEqual(viewerAll.totals);
    expect(filtered.surnames).toEqual(viewerAll.surnames);
    expect(filtered.children).toEqual(viewerAll.children);

    const foreign = await getFamilyStatistics(editor, { familyId: FAMILY_D });
    expect(foreign.familyId).toBeNull();
    expect(foreign.totals).toEqual((await getFamilyStatistics(editor)).totals);
    expect(foreign.families.map((f) => f.id)).not.toContain(FAMILY_D);
  });

  it("Stufe Region; unbekannte Stufe gilt als Land", async () => {
    const admin = await scope("admin@example.test");
    const region = await getFamilyStatistics(admin, { level: "region" });
    expect(region.birthPlaces.level).toBe("region");
    expect(region.birthPlaces.slices.some((s) => s.kind === "area" && /, Deutschland$/.test(s.label))).toBe(true);
    const odd = await getFamilyStatistics(admin, { level: "stadt" });
    expect(odd.birthPlaces.level).toBe("country");
    expect(odd.birthPlaces.slices.some((s) => s.label === "Deutschland")).toBe(true);
  });

  it("ohne Familie: nichts", async () => {
    const nofamily = await scope("nofamily@example.test");
    const r = await getFamilyStatistics(nofamily, { familyId: FAMILY_A });
    expect(r.totals.persons).toBe(0);
    expect(r.families).toEqual([]);
    expect(r.familyId).toBeNull();
    expect(r.birthPlaces.slices).toEqual([]);
  });
});
