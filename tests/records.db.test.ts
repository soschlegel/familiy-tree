/**
 * Seite „Rekorde“ gegen die Mock-Datenbank (lib/services/records.ts):
 * Administrator gegenüber eingeschränkten Benutzern, Familienfilter (nur
 * eigene Familien) und dass die Antwort nur sichtbare Personen nennt. Nur
 * lesend; überspringt sich ohne Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { RecordsResult } from "@/lib/records";
import { canViewPerson, type Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { getFamilyRecords } from "@/lib/services/records";
import { getFamilyStatistics } from "@/lib/services/statistics";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Rekorde-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const FAMILY_A = "mock-family-a";
const FAMILY_D = "mock-family-d";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

/** Alle genannten Personen (Kennungen) aller Karten. */
function namedIds(r: RecordsResult): Set<string> {
  const ids = new Set<string>();
  for (const card of Object.values(r.cards)) {
    for (const place of card.places) {
      for (const e of place.entries) for (const part of e.parts) for (const p of part.persons) ids.add(p.id);
    }
  }
  return ids;
}

describe.skipIf(Boolean(skipReason))("Rekorde (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Personenzahl wie die Statistik; eingeschränkte Benutzer sehen weniger", async () => {
    const [admin, editor, viewer] = await Promise.all([
      scope("admin@example.test"),
      scope("editor@example.test"),
      scope("viewer@example.test"),
    ]);
    for (const s of [admin, editor, viewer]) {
      const [rec, stats] = await Promise.all([getFamilyRecords(s), getFamilyStatistics(s)]);
      expect(rec.persons).toBe(stats.totals.persons);
      expect(rec.families).toEqual(stats.families);
    }
    const a = await getFamilyRecords(admin);
    const v = await getFamilyRecords(viewer);
    expect(v.persons).toBeLessThan(a.persons);
    // Die Mock-Daten füllen die wichtigsten Karten.
    for (const key of ["oldestDeceased", "youngest", "earliest", "mostChildren", "mostDescendants", "longestLine"] as const) {
      expect(a.cards[key].places.length, key).toBeGreaterThan(0);
    }
  });

  it("nur sichtbare Personen werden genannt — auch als Kind, Partner oder Endpunkt einer Linie", async () => {
    for (const email of ["viewer@example.test", "editor@example.test"]) {
      const s = await scope(email);
      const r = await getFamilyRecords(s);
      const visible = new Set(
        (await prisma.person.findMany({ select: { id: true, families: { select: { familyId: true } } } }))
          .filter((p) => canViewPerson(s, p.families.map((f) => f.familyId)))
          .map((p) => p.id),
      );
      const named = namedIds(r);
      expect(named.size).toBeGreaterThan(0);
      for (const id of named) expect(visible.has(id), `${email}: ${id}`).toBe(true);
      expect(JSON.stringify(r)).not.toContain(FAMILY_D);
    }
  });

  it("Familienfilter: Admin mit Familie A = Betrachter von Familie A; fremde Familie gilt als „Alle“", async () => {
    const [admin, viewer, editor] = await Promise.all([
      scope("admin@example.test"),
      scope("viewer@example.test"),
      scope("editor@example.test"),
    ]);
    const now = new Date(Date.UTC(2026, 10, 27));
    const filtered = await getFamilyRecords(admin, { familyId: FAMILY_A, now });
    const viewerAll = await getFamilyRecords(viewer, { now });
    expect(filtered.familyId).toBe(FAMILY_A);
    expect(filtered.persons).toBe(viewerAll.persons);
    expect(filtered.cards).toEqual(viewerAll.cards);
    expect(filtered.givenNames).toEqual(viewerAll.givenNames);
    const inA = new Set(data.persons.filter((p) => p.familyKeys.includes("A")).map((p) => p.id));
    for (const id of namedIds(filtered)) expect(inA.has(id)).toBe(true);

    const foreign = await getFamilyRecords(editor, { familyId: FAMILY_D, now });
    expect(foreign.familyId).toBeNull();
    expect(foreign.cards).toEqual((await getFamilyRecords(editor, { now })).cards);
  });

  it("ohne Familie: nichts", async () => {
    const nofamily = await scope("nofamily@example.test");
    const r = await getFamilyRecords(nofamily, { familyId: FAMILY_A });
    expect(r.persons).toBe(0);
    expect(r.families).toEqual([]);
    expect(namedIds(r).size).toBe(0);
  });
});
