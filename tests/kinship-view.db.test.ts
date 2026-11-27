/**
 * „Wie sind wir verwandt?“ gegen die Mock-Datenbank (loadKinshipPage):
 * Rechte der Auswahl, streng wie der Baum nur über sichtbare Personen
 * (gleich der Personenseite), keine Verbindung, dieselbe Person, eigene
 * Person. Rein
 * lesend; überspringt sich ohne Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { loadReferenceFor, scopeForEmail } from "@/lib/services";
import { loadKinshipPage, type KinshipFound } from "@/lib/services/kinship-view";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const d = mockData();
const L = d.landmarks;
const byId = new Map(d.persons.map((p) => [p.id, p]));

const skipReason = await mockDbSkipReason({
  check: async () => Boolean(await prisma.person.findUnique({ where: { id: L.kinshipHidden.cousin }, select: { id: true } })),
  missing: "ohne die Cousine über gesperrte Personen",
});
if (skipReason) console.warn(`\n[tests] Verwandtschafts-Seite übersprungen: ${skipReason}\n`);

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Wie sind wir verwandt? (Mock-Datenbank)", () => {
  afterAll(async () => {
    if (!skipReason) await prisma.$disconnect();
  });

  it("Bearbeiter: Cousine nur über gesperrte Personen — streng wie der Baum keine Verbindung", async () => {
    const editor = await scope("editor@example.test");
    const page = await loadKinshipPage(editor, L.selfEditor, L.kinshipHidden.cousin);
    expect(page.self?.id).toBe(L.selfEditor);
    expect(page.result?.status).toBe("none");

    // Dasselbe wie Baumkarte und Personenseite: dort ebenfalls kein Begriff.
    const ref = await loadReferenceFor(editor, { param: L.selfEditor }, L.kinshipHidden.cousin);
    expect(ref.view?.relatives[L.kinshipHidden.cousin]?.term ?? null).toBeNull();

    // Nichts über die gesperrten Personen: weder Kennung noch Name.
    const grandparents = d.relationships
      .filter((rel) => rel.type === "PARENT_OF" && rel.toPersonId === L.kinshipHidden.aunt)
      .map((rel) => rel.fromPersonId);
    const json = JSON.stringify(page);
    for (const id of [L.kinshipHidden.aunt, ...grandparents]) {
      expect(json).not.toContain(id);
      expect(json).not.toContain(byId.get(id)!.givenName);
    }
  });

  it("Administrator sieht die Verbindung über dieselben Personen mit Namen", async () => {
    const admin = await scope("admin@example.test");
    const r = (await loadKinshipPage(admin, L.selfEditor, L.kinshipHidden.cousin)).result as KinshipFound;
    expect(r.status).toBe("found");
    expect(r.kind).toBe("blood");
    expect(r.bForA).toMatch(/^Cousine 1\. Grades mütterlicherseits$/);
    expect(r.connections[0].lineB[0].card).toMatchObject({ id: L.kinshipHidden.aunt });
    expect(r.aForB).toMatch(/mütterlicherseits$/);
  });

  it("Seite und Personenseite stimmen für die eigene Person mit den sichtbaren unter den ersten 80 Personen überein", async () => {
    const editor = await scope("editor@example.test");
    const ref = await loadReferenceFor(editor, { param: L.selfEditor }, L.selfEditor);
    const graphIds = d.persons.map((p) => p.id);
    let compared = 0;
    for (const id of graphIds.slice(0, 80)) {
      if (id === L.selfEditor) continue;
      const page = await loadKinshipPage(editor, id, L.selfEditor);
      if (page.a.state !== "ok") continue; // nicht sichtbar
      const view = (await loadReferenceFor(editor, { param: L.selfEditor }, id)).view;
      const expected = view?.relatives[id]?.term ?? null;
      const got = page.result?.status === "found" ? page.result.aForB : null;
      expect(got, id).toBe(expected);
      compared++;
    }
    expect(ref.view?.id).toBe(L.selfEditor);
    expect(compared).toBeGreaterThan(20);
  });

  it("Betrachter: nicht sichtbare Auswahl gilt als nicht gefunden", async () => {
    const viewer = await scope("viewer@example.test");
    const page = await loadKinshipPage(viewer, L.crossMarriedPartnerA, L.inLawOnlyB);
    expect(page.a.state).toBe("ok");
    expect(page.b).toEqual({ state: "notFound" });
    expect(page.result).toBeNull();
    expect(JSON.stringify(page)).not.toContain(byId.get(L.inLawOnlyB)!.givenName);

    const unknown = await loadKinshipPage(viewer, "gibt-es-nicht", "a b");
    expect([unknown.a.state, unknown.b.state]).toEqual(["notFound", "notFound"]);
    expect((await loadKinshipPage(viewer, undefined, undefined)).a).toEqual({ state: "empty" });
  });

  it("angeheiratet, keine Verbindung und dieselbe Person", async () => {
    const admin = await scope("admin@example.test");
    const inLaw = (await loadKinshipPage(admin, L.crossMarriedPartnerA, L.inLawOnlyB)).result as KinshipFound;
    expect(inLaw.kind).toBe("inLaw");
    expect(inLaw.bForA).toMatch(/^Schwieger(vater|mutter)$/);
    expect(inLaw.path.some((s) => s.link?.relation === "partner")).toBe(true);

    const isolated = d.landmarks.noFamily.find((id) => !d.relationships.some((r) => r.fromPersonId === id || r.toPersonId === id))!;
    const none = (await loadKinshipPage(admin, L.founders.A, isolated)).result;
    expect(none?.status).toBe("none");

    const same = (await loadKinshipPage(admin, L.founders.A, L.founders.A)).result;
    expect(same?.status).toBe("same");
  });
});
