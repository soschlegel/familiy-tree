/**
 * Forschungs-Fortschritt gegen die Mock-Datenbank
 * (lib/services/research-progress.ts): Ausgangsperson aus Adresse bzw.
 * „Das bin ich“, Zählung je Generation wie die Ringe, Rechte (die
 * Großeltern mütterlicherseits des Bearbeiters gehören nur zu Familie D und
 * zählen für ihn nur als „nicht freigegeben“ — ohne Kennung, Namen oder
 * Daten von ihnen oder ihren Vorfahren), Tiefe, Vorschläge nur zu sichtbaren
 * Personen. Nur lesend. Überspringt sich, wenn die Mock-Datenbank fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { loadAncestorRings } from "@/lib/services/ancestor-rings";
import { getResearchProgress } from "@/lib/services/research-progress";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Fortschritt-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const NOW = new Date(Date.UTC(2026, 10, 27));

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Forschungs-Fortschritt (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Administrator ohne eigene Person: keine Ausgangsperson, mit Adresse die gewählte", async () => {
    const admin = await scope("admin@example.test");
    const none = await getResearchProgress(admin, { now: NOW });
    expect(none.root).toBeNull();
    expect(none.progress).toBeNull();
    expect(none.generations).toBe(6);

    const r = await getResearchProgress(admin, { person: L.selfEditor, generations: "7", now: NOW });
    expect(r.root).toMatchObject({ id: L.selfEditor, source: "param", isSelf: false });
    expect(r.generations).toBe(7);
    const p = r.progress!;
    expect(p.byGeneration).toHaveLength(7);
    expect(p.byGeneration[0]).toMatchObject({ generation: 1, label: "Eltern", places: 2, found: 2, restricted: 0 });
    expect(p.byGeneration[1]).toMatchObject({ places: 4, found: 4 });
    for (const g of p.byGeneration) expect(g.found + g.restricted + g.missing).toBe(g.places);
    expect(p.total.places).toBe(2 ** 8 - 2);

    // Dieselben Plätze wie in der Ansicht „Ringe“ (gleiche Platzvergabe).
    const rings = await loadAncestorRings(admin, L.selfEditor, 7);
    expect(p.total.found).toBe(rings!.slots.filter((s) => s.kind === "person").length);

    // Jede Linie mit Großelternteil; Vorschläge verweisen nur auf gezeigte Personen.
    expect(p.lines.every((l) => l.grandparent?.kind === "person")).toBe(true);
    expect(p.suggestions.length).toBeGreaterThan(0);
    const shown = new Set([L.selfEditor, ...rings!.slots.flatMap((s) => (s.kind === "person" ? [s.personId] : []))]);
    for (const s of p.suggestions) expect(shown.has(s.personId), s.personId).toBe(true);
  });

  it("Tiefe aus der Adresse auf 4…10 begrenzt", async () => {
    const admin = await scope("admin@example.test");
    expect((await getResearchProgress(admin, { person: L.selfEditor, generations: "2" })).generations).toBe(4);
    expect((await getResearchProgress(admin, { person: L.selfEditor, generations: "99" })).progress!.byGeneration).toHaveLength(10);
  });

  it("Bearbeiter: eigene Person als Ausgangsperson, gesperrte Großeltern nur als „nicht freigegeben“", async () => {
    const editor = await scope("editor@example.test");
    const mine = await getResearchProgress(editor, { now: NOW });
    expect(mine.root).toMatchObject({ id: L.selfEditor, isSelf: true, source: "self" });
    expect(mine.hasSelf).toBe(true);
    const p = mine.progress!;
    expect(p.byGeneration[1]).toMatchObject({ found: 2, restricted: 2, missing: 0 });
    // Hinter den gesperrten Großeltern: alles „nicht freigegeben“ (die mütterliche Hälfte).
    for (const g of p.byGeneration.slice(1)) expect(g.restricted).toBe(g.places / 2);
    expect(p.lines.filter((l) => l.grandparent?.kind === "restricted").map((l) => l.line)).toEqual(["MF", "MM"]);

    // Nichts von den gesperrten Vorfahren: weder Kennung noch Name.
    const all = await loadAncestorRings(await scope("admin@example.test"), L.selfEditor, 6);
    const hidden = all!.slots.filter((s) => s.kind === "person" && s.generation >= 2 && s.index >> (s.generation - 2) >= 2);
    expect(hidden.length).toBeGreaterThan(0);
    const json = JSON.stringify(mine);
    for (const s of hidden) {
      if (s.kind !== "person") continue;
      expect(json).not.toContain(`"${s.personId}"`);
      const q = all!.persons[s.personId];
      expect(json).not.toContain(`${q.givenName} ${q.familyName ?? ""}`.trim());
    }
    // Die Mutter hat (gesperrte) Eltern — kein Vorschlag „Eltern fehlen“ für sie.
    const motherSlot = all!.slots.find((s) => s.generation === 1 && s.index === 1);
    const motherId = motherSlot?.kind === "person" ? motherSlot.personId : "";
    expect(p.suggestions.some((s) => s.personId === motherId && s.kind === "missingParents")).toBe(false);
  });

  it("nicht sichtbare oder unbekannte Person in der Adresse: „nicht gefunden“, zurück zur eigenen Person", async () => {
    const editor = await scope("editor@example.test");
    const all = await loadAncestorRings(await scope("admin@example.test"), L.selfEditor, 3);
    const hiddenGrandparent = all!.slots.find((s) => s.generation === 2 && s.index === 3);
    const hiddenId = hiddenGrandparent?.kind === "person" ? hiddenGrandparent.personId : "x";
    for (const person of [hiddenId, "gibt-es-nicht"]) {
      const r = await getResearchProgress(editor, { person });
      expect(r.notFound).toBe(true);
      expect(r.root?.id).toBe(L.selfEditor);
      expect(JSON.stringify(r)).not.toContain(hiddenId);
    }
    // Ohne Familie: nichts sichtbar, keine Ausgangsperson.
    const nofamily = await getResearchProgress(await scope("nofamily@example.test"), { person: L.selfEditor });
    expect(nofamily.root).toBeNull();
    expect(nofamily.notFound).toBe(true);
  });
});
