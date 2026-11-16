/**
 * Dienst-Tests für Quellen, Belege und ungenaue Daten gegen die
 * Mock-Datenbank. Schreibende Tests legen eigene Quellen/Personen an und
 * räumen sie (samt Audit-Einträgen) wieder ab. Überspringt sich ohne
 * Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import {
  createCitation,
  createPerson,
  createSource,
  deleteCitation,
  deleteSource,
  findDataGaps,
  getPersonDetail,
  getPersonTimeline,
  getSource,
  listSources,
  scopeForEmail,
  ServiceError,
  updateCitation,
  updatePerson,
  updateSource,
} from "@/lib/services";
import { mockData } from "./helpers";

async function mockDbReady(): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    if (!admin) return "Mock-Datenbank ist leer — bitte `npm run mock:setup` ausführen.";
    if ((await prisma.source.count()) === 0) return "Mock-Datenbank ohne Quellen — bitte `npm run db:mock` ausführen.";
    return null;
  } catch (err) {
    const detail = (err as Error).message.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    return `Mock-Datenbank nicht erreichbar (${detail}).`;
  }
}

const skipReason = await mockDbReady();
if (skipReason) console.warn(`\n[tests] Quellen-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const personById = new Map(data.persons.map((p) => [p.id, p]));
const relById = new Map(data.relationships.map((r) => [r.id, r]));

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof ServiceError && err.code === code);
}

/** Erwartete Sichtbarkeit nach Familien — unabhängig vom Dienst nachgerechnet. */
function visibleSourceIds(familyKey: "A" | "B" | "C" | "D"): string[] {
  const inFamily = (personId: string) => personById.get(personId)?.familyKeys.includes(familyKey) ?? false;
  const ids = new Set<string>();
  for (const c of data.citations) {
    const visible = c.personId
      ? inFamily(c.personId)
      : inFamily(relById.get(c.relationshipId!)!.fromPersonId) || inFamily(relById.get(c.relationshipId!)!.toPersonId);
    if (visible) ids.add(c.sourceId);
  }
  return [...ids].sort();
}

/** So erschiene eine Person mit Namen im serialisierten Ergebnis. */
const nameOf = (id: string) => {
  const p = personById.get(id)!;
  return `"givenName":"${p.givenName}","familyName":"${p.familyName}"`;
};

describe.skipIf(Boolean(skipReason))("Quellen und Belege (Mock-Datenbank)", () => {
  const createdSources: string[] = [];
  const createdPersons: string[] = [];
  const startedAt = new Date();

  afterAll(async () => {
    if (skipReason) return;
    await prisma.source.deleteMany({ where: { id: { in: createdSources } } });
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        userId: { in: ["mock-user-admin", "mock-user-editor", "mock-user-viewer"] },
        entityType: { in: ["Source", "Citation", "Person"] },
      },
    });
    await prisma.$disconnect();
  });

  describe("Sichtbarkeit", () => {
    it("Liste: Admin alles, sonst nur Quellen mit sichtbarem Beleg", async () => {
      const admin = await listSources(await scope("admin@example.test"));
      expect(admin.total).toBe(data.sources.length);

      const viewer = await listSources(await scope("viewer@example.test"));
      expect(viewer.items.map((s) => s.id).sort()).toEqual(visibleSourceIds("A"));
      expect(viewer.items.map((s) => s.id)).not.toContain(L.sources.onlyFamilyD);
      expect(viewer.items.map((s) => s.id)).not.toContain(L.sources.uncited);

      const none = await listSources(await scope("nofamily@example.test"));
      expect(none.total).toBe(0);
    });

    it("Belegzahl zählt nur sichtbare Belege", async () => {
      const viewer = await listSources(await scope("viewer@example.test"), { q: "Heiratsregister" });
      const cross = viewer.items.find((s) => s.id === L.sources.crossFamily)!;
      const all = data.citations.filter((c) => c.sourceId === L.sources.crossFamily).length;
      expect(cross.citationCount).toBe(all - 1);
    });

    it("Familienübergreifende Quelle: Betrachter A sieht keine Namen aus Familie B", async () => {
      const viewer = (await getSource(await scope("viewer@example.test"), L.sources.crossFamily))!;
      expect(viewer).not.toBeNull();
      expect(viewer.hiddenCitationCount).toBe(1);
      expect(viewer.canEdit).toBe(false);
      expect(viewer.canDelete).toBe(false);
      const json = JSON.stringify(viewer);
      expect(json).not.toContain(L.inLawOnlyB);
      expect(json).not.toContain(nameOf(L.inLawOnlyB));
      // Die Ehe (A-Person mit A+B-Person) ist sichtbar, mit beiden Namen.
      const marriage = viewer.citations.find((c) => c.target.kind === "relationship")!;
      expect(marriage.fact).toBe("PARTNERSHIP");
      expect(json).toContain(nameOf(L.crossMarriedPartnerA));
    });

    it("Bearbeiter (A bearbeiten, B lesen): sieht alles, darf ändern, aber nicht löschen", async () => {
      const editor = (await getSource(await scope("editor@example.test"), L.sources.crossFamily))!;
      expect(editor.hiddenCitationCount).toBe(0);
      expect(editor.canEdit).toBe(true);
      expect(editor.canDelete).toBe(false);
      const onB = editor.citations.find((c) => c.target.kind === "person" && c.target.person.id === L.inLawOnlyB)!;
      expect(onB.canEdit).toBe(false);
      await expectServiceError(deleteSource(await scope("editor@example.test"), L.sources.crossFamily), "FORBIDDEN");
    });

    it("Unsichtbare Quellen gelten als nicht vorhanden", async () => {
      const viewer = await scope("viewer@example.test");
      expect(await getSource(viewer, L.sources.onlyFamilyD)).toBeNull();
      expect(await getSource(viewer, L.sources.uncited)).toBeNull();
      expect(await getSource(await scope("editor@example.test"), L.sources.uncited)).toBeNull();
      expect(await getSource(await scope("admin@example.test"), L.sources.uncited)).not.toBeNull();
      await expectServiceError(updateSource(viewer, L.sources.onlyFamilyD, { title: "x" }), "NOT_FOUND");
    });

    it("Personenseite: Belege der Person und ihrer Ehe, Bezug ohne fremde Namen", async () => {
      const viewer = await scope("viewer@example.test");
      const detail = (await getPersonDetail(viewer, L.crossMarriedIntoA))!;
      const facts = detail.citations.map((c) => `${c.source.id}:${c.fact}`);
      expect(facts).toContain(`${L.sources.crossFamily}:NAME`);
      expect(facts).toContain(`${L.sources.crossFamily}:PARTNERSHIP`);
      // Der Elternteil nur aus B hat einen Beleg — der erscheint hier nicht.
      expect(JSON.stringify(detail.citations)).not.toContain(nameOf(L.inLawOnlyB));
      expect(detail.citations.every((c) => c.canEdit === false)).toBe(true);

      const editorDetail = (await getPersonDetail(await scope("editor@example.test"), L.founders.A))!;
      const marriage = editorDetail.citations.find((c) => c.relationshipId === L.citedMarriage)!;
      expect(marriage.relationship?.role).toBe("partner");
      expect(marriage.canEdit).toBe(true);
    });
  });

  describe("Mutationen", () => {
    it("Quelle anlegen: erst nur für Ersteller sichtbar, mit Beleg auch für die Familie", async () => {
      const editor = await scope("editor@example.test");
      const viewer = await scope("viewer@example.test");
      await expectServiceError(createSource(viewer, { title: "X" }), "FORBIDDEN");
      await expectServiceError(createSource(editor, { title: "" }), "VALIDATION");

      const src = await createSource(editor, { title: "Vitest-Quelle", kind: "GRAVESTONE", date: "um 1900" });
      createdSources.push(src.id);
      expect(src).toMatchObject({ kind: "GRAVESTONE", datePrecision: "YEAR", dateQualifier: "ABOUT" });
      expect(await getSource(viewer, src.id)).toBeNull();
      expect((await getSource(editor, src.id))!.canDelete).toBe(true);

      const person = await createPerson(editor, { givenName: "Belegt", familyName: "Vitest", birthDate: "vor 1900" });
      createdPersons.push(person.id);
      expect(person).toMatchObject({ birthDatePrecision: "YEAR", birthDateQualifier: "BEFORE" });

      const citation = await createCitation(editor, { sourceId: src.id, personId: person.id, fact: "BIRTH", detail: "Grab 7" });
      expect(citation.canEdit).toBe(true);
      expect((await getSource(viewer, src.id))!.citations.map((c) => c.id)).toEqual([citation.id]);

      // Regeln: Angabe passend zum Bezug, Rechte am Bezug.
      await expectServiceError(
        createCitation(editor, { sourceId: src.id, personId: person.id, fact: "PARTNERSHIP" }),
        "VALIDATION",
      );
      await expectServiceError(
        createCitation(editor, { sourceId: src.id, relationshipId: L.citedMarriage, fact: "BIRTH" }),
        "VALIDATION",
      );
      await expectServiceError(createCitation(editor, { sourceId: src.id, personId: L.inLawOnlyB, fact: "BIRTH" }), "FORBIDDEN");
      const onlyC = data.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "C")!;
      await expectServiceError(createCitation(editor, { sourceId: src.id, personId: onlyC.id, fact: "BIRTH" }), "NOT_FOUND");
      await expectServiceError(createCitation(editor, { sourceId: L.sources.onlyFamilyD, personId: person.id, fact: "BIRTH" }), "NOT_FOUND");
      await expectServiceError(createCitation(viewer, { sourceId: src.id, personId: person.id, fact: "DEATH" }), "FORBIDDEN");

      const updated = await updateCitation(editor, citation.id, { confidence: "LOW", detail: "Grab 8" });
      expect(updated).toMatchObject({ confidence: "LOW", detail: "Grab 8" });
      await expectServiceError(updateCitation(viewer, citation.id, { confidence: "HIGH" }), "FORBIDDEN");
      await expectServiceError(updateCitation(editor, citation.id, { fact: "PARENTAGE" }), "VALIDATION");

      // Lücke „ohne Beleg“: Geburt belegt, Tod nicht.
      await updatePerson(editor, person.id, { deathDate: "1950" });
      const gaps = await findDataGaps(editor, { limit: 1000 });
      expect(gaps.items.unsourced.find((i) => i.person.id === person.id)?.detail).toBe("ohne Beleg: Tod");

      await deleteCitation(editor, citation.id);
      expect((await getSource(viewer, src.id))).toBeNull();

      const removed = await deleteSource(editor, src.id);
      expect(removed.ok).toBe(true);

      const audit = await prisma.auditLog.findMany({
        where: { userId: "mock-user-editor", createdAt: { gte: startedAt }, entityId: { in: [src.id, citation.id] } },
      });
      const has = (type: string, action: string) => audit.some((a) => a.entityType === type && a.action === action);
      expect(has("Source", "CREATE")).toBe(true);
      expect(has("Source", "DELETE")).toBe(true);
      expect(has("Citation", "CREATE")).toBe(true);
      expect(has("Citation", "UPDATE")).toBe(true);
      expect(has("Citation", "DELETE")).toBe(true);
    });
  });

  describe("Ungenaue Daten in den Diensten", () => {
    it("ungefähres Geburtsdatum ist keine Datenlücke; Zeitleiste zeigt den Text", async () => {
      const admin = await scope("admin@example.test");
      const gaps = await findDataGaps(admin, { limit: 1000 });
      expect(gaps.items.missingBirthDate.map((i) => i.person.id)).not.toContain(L.impreciseDates.about);

      const t = (await getPersonTimeline(admin, L.impreciseDates.about))!;
      const birth = t.events.find((e) => e.kind === "birth" && e.role === "self")!;
      expect(birth.dateText).toMatch(/^um \d{4}$/);
      expect(birth.datePrecision).toBe("YEAR");
      expect(t.missing.some((m) => m.startsWith("genaues Geburtsdatum"))).toBe(true);
      // Alter bei späteren Ereignissen ist nur ungefähr.
      expect(t.events.filter((e) => e.age != null && e.role !== "self").every((e) => e.ageApproximate)).toBe(true);
    });

    it("Stammvater A ist belegt und erscheint nicht unter „ohne Beleg“", async () => {
      const gaps = await findDataGaps(await scope("admin@example.test"), { limit: 1000 });
      const ids = gaps.items.unsourced.map((i) => i.person.id);
      expect(ids).not.toContain(L.founders.A);
      expect(gaps.counts.unsourced).toBeGreaterThan(50);
    });
  });
});
