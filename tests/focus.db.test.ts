/**
 * Fokus-Ausschnitt gegen die Mock-Datenbank: Sichtbarkeit und Rückfall auf
 * die Startperson. Nur lesend. Überspringt sich, wenn die Mock-Datenbank
 * fehlt (siehe services.db.test.ts).
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { loadFocusTree, loadTree, scopeForEmail } from "@/lib/services";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Fokus-Tests übersprungen: ${skipReason}\n`);

const L = mockData().landmarks;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("loadFocusTree (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("liefert nur den Ausschnitt, nicht den ganzen Graphen", async () => {
    const admin = await scope("admin@example.test");
    const full = await loadTree(admin);
    const { tree, notFound, counts } = await loadFocusTree(admin, { focusId: L.divorced.person });
    expect(notFound).toBe(false);
    expect(tree?.focusId).toBe(L.divorced.person);
    expect(tree!.persons.length).toBeLessThan(full.persons.length / 3);
    expect(counts.visible + counts.hidden).toBe(full.persons.length);
    expect(counts.relationships).toBe(full.relationships.length);
  });

  it("maskiert fremde Personen im Ausschnitt wie im Gesamtbaum", async () => {
    const viewer = await scope("viewer@example.test");
    const { tree } = await loadFocusTree(viewer, { focusId: L.crossMarriedIntoA });
    const inLaw = tree!.persons.find((p) => p.id === L.inLawOnlyB);
    expect(inLaw?.restricted).toBe(true);
    expect(inLaw?.givenName).toBe("Nicht freigegeben");
    expect(inLaw?.birthDate).toBeNull();
    for (const p of tree!.persons) {
      if (p.restricted) expect(p.familyIds ?? []).toEqual([]);
    }
  });

  it("lässt gesperrte und unbekannte Personen nicht in den Fokus", async () => {
    const viewer = await scope("viewer@example.test");
    for (const id of [L.inLawOnlyB, L.biologicalMotherNoFamily, "gibt-es-nicht"]) {
      const result = await loadFocusTree(viewer, { focusId: id });
      expect(result.notFound, id).toBe(true);
      expect(result.tree).toBeNull();
    }
    // Mit Rückfall (gemerkte Person) gibt es stattdessen die Startperson.
    const fallback = await loadFocusTree(viewer, { focusId: L.inLawOnlyB, fallback: true });
    expect(fallback.notFound).toBe(false);
    expect(fallback.tree).not.toBeNull();
    const start = fallback.tree!.persons.find((p) => p.id === fallback.tree!.focusId);
    expect(start?.restricted).toBe(false);
  });

  it("liefert ohne Familienzugriff keinen Ausschnitt", async () => {
    const none = await scope("nofamily@example.test");
    const result = await loadFocusTree(none);
    expect(result.tree).toBeNull();
    expect(result.counts.visible).toBe(0);
  });
});
