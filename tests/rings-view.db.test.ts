/**
 * Wahl der Ausgangsperson und Rechte der Ansicht „Ringe“ — gemeinsam für
 * die Stammbaum-Seite und die Druckansicht (lib/services/rings-view.ts).
 * Gegen die Mock-Datenbank, nur lesend. Die Druckansicht zeigt dasselbe wie
 * die Ringe: eine gesperrte angefragte Person ergibt „nicht gefunden“ (wie
 * eine fehlende), gesperrte Vorfahren bzw. Nachkommen erscheinen nur als
 * „nicht freigegeben“ ohne Angaben.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { loadAncestorRings } from "@/lib/services/ancestor-rings";
import { loadRingsView } from "@/lib/services/rings-view";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Ringe-Ansicht-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const hiddenForEditor = data.persons.find((p) => p.familyKeys.length > 0 && p.familyKeys.every((k) => k === "D"))!;

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Ringe: Ausgangsperson und Rechte (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("angefragte sichtbare Person: genau die Daten des Dienstes", async () => {
    const s = await scope("editor@example.test");
    const view = await loadRingsView(s, { direction: "vorfahren", generations: 5, requested: L.selfEditor, candidates: [] });
    expect(view.notFound).toBe(false);
    expect(view.data).toEqual(await loadAncestorRings(s, L.selfEditor, 5));
  });

  it("angefragte gesperrte oder unbekannte Person: „nicht gefunden“, keine Daten, kein Ausweichen", async () => {
    const s = await scope("editor@example.test");
    for (const id of [hiddenForEditor.id, "gibt-es-nicht"]) {
      for (const direction of ["vorfahren", "nachfahren"] as const) {
        const view = await loadRingsView(s, { direction, generations: 4, requested: id, candidates: [L.selfEditor] });
        expect(view).toEqual({ data: null, notFound: true });
      }
    }
  });

  it("ohne Anfrage: erster sichtbarer Kandidat, gesperrte werden übersprungen", async () => {
    const s = await scope("editor@example.test");
    const view = await loadRingsView(s, { direction: "vorfahren", generations: 3, requested: null, candidates: [hiddenForEditor.id, null, L.selfEditor] });
    expect(view.notFound).toBe(false);
    expect(view.data?.root.id).toBe(L.selfEditor);
  });

  it("ohne Anfrage und ohne Kandidaten: Startperson", async () => {
    const view = await loadRingsView(await scope("viewer@example.test"), { direction: "nachfahren", generations: 4, requested: null, candidates: [] });
    expect(view.notFound).toBe(false);
    expect(view.data?.direction).toBe("nachfahren");
  });

  it("eingeschränkter Benutzer: gesperrte Vorfahren ohne Kennung und ohne Namen", async () => {
    const s = await scope("editor@example.test");
    const view = await loadRingsView(s, { direction: "vorfahren", generations: 7, requested: L.selfEditor, candidates: [] });
    const json = JSON.stringify(view.data);
    const restricted = view.data!.direction === "vorfahren" ? view.data!.slots.filter((x) => x.kind === "restricted") : [];
    expect(restricted.length).toBeGreaterThan(0);
    for (const slot of restricted) expect(Object.keys(slot).sort()).toEqual(["generation", "index", "kind", "term"]);
    const forbidden = data.persons.filter((p) => p.familyKeys.length > 0 && p.familyKeys.every((k) => k === "D"));
    for (const p of forbidden) expect(json).not.toContain(`"${p.id}"`);
  });
});
