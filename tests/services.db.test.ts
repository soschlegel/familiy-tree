/**
 * Dienst-Tests gegen die Mock-Datenbank (npm run mock:setup).
 *
 * Lesende Tests verlassen sich auf die deterministischen Mock-Daten
 * (prisma/mock-data.ts). Schreibende Tests legen eigene Personen an und
 * räumen sie am Ende wieder ab — die Mock-Daten bleiben unverändert.
 *
 * Ist die Mock-Datenbank nicht erreichbar oder nicht befüllt, wird die ganze
 * Datei mit einem Hinweis übersprungen.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import {
  createPerson,
  createRelationship,
  deletePerson,
  findDataGaps,
  findPossibleDuplicates,
  findRelationshipPath,
  getAncestors,
  getDescendants,
  getPersonDetail,
  getStatistics,
  loadTree,
  scopeForEmail,
  searchPersons,
  ServiceError,
  setPersonFamilies,
  updatePerson,
  updateRelationship,
} from "@/lib/services";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) {
  console.warn(`\n[tests] Dienst-Tests übersprungen: ${skipReason}\n`);
}

const L = mockData().landmarks;
const FAMILY_A = "mock-family-a";
const FAMILY_B = "mock-family-b";
const FAMILY_C = "mock-family-c";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (err: unknown) => err instanceof ServiceError && err.code === code,
  );
}

describe.skipIf(Boolean(skipReason))("Dienste (Mock-Datenbank)", () => {
  const created: string[] = [];
  const startedAt = new Date();

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: created } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ["mock-user-admin", "mock-user-editor"] }, createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  });

  describe("Sichtbarkeit", () => {
    it("blockierte und unbekannte Benutzer bekommen keinen Scope", async () => {
      expect(await scopeForEmail("blocked@example.test")).toBeNull();
      expect(await scopeForEmail("niemand@example.test")).toBeNull();
    });

    it("loadTree maskiert Personen außerhalb der eigenen Familien", async () => {
      const tree = await loadTree(await scope("viewer@example.test"));
      const byId = new Map(tree.persons.map((p) => [p.id, p]));

      const cross = byId.get(L.crossMarriedIntoA)!;
      expect(cross.restricted).toBe(false);
      expect(cross.familyIds).toEqual([FAMILY_A]);

      const inLaw = byId.get(L.inLawOnlyB)!;
      expect(inLaw.restricted).toBe(true);
      expect(inLaw.givenName).toBe("Nicht freigegeben");
      expect(inLaw.birthDate).toBeNull();

      for (const id of L.noFamily) expect(byId.get(id)?.restricted).toBe(true);
    });

    it("Benutzer ohne Familie sieht nur Platzhalter", async () => {
      const s = await scope("nofamily@example.test");
      const tree = await loadTree(s);
      expect(tree.persons.every((p) => p.restricted)).toBe(true);
      expect((await searchPersons(s)).total).toBe(0);
    });

    it("getPersonDetail maskiert Verwandte und blendet fremde Familien aus", async () => {
      const viewer = await scope("viewer@example.test");
      const detail = (await getPersonDetail(viewer, L.crossMarriedIntoA))!;
      expect(detail).not.toBeNull();
      expect(detail.canEdit).toBe(false);
      expect(detail.families.map((f) => f.id)).toEqual([FAMILY_A]);

      const inLaw = detail.parents.find((r) => r.other.id === L.inLawOnlyB)!;
      expect(inLaw.other.restricted).toBe(true);
      expect(inLaw.other.givenName).toBe("Nicht freigegeben");
      expect(detail.partners.some((r) => r.other.id === L.crossMarriedPartnerA && !r.other.restricted)).toBe(true);

      // Unsichtbare Person = nicht vorhanden.
      expect(await getPersonDetail(viewer, L.inLawOnlyB)).toBeNull();
      expect(await getPersonDetail(viewer, "gibt-es-nicht")).toBeNull();
    });

    it("getPersonDetail gruppiert Geschwister (halb/voll)", async () => {
      const admin = await scope("admin@example.test");
      const detail = (await getPersonDetail(admin, L.halfSiblings[0]))!;
      const half = detail.siblings.find((s) => s.person.id === L.halfSiblings[1]);
      expect(half?.kind).toBe("half");
      expect(detail.parents.some((p) => p.subtype === "STEP")).toBe(true);
    });
  });

  describe("searchPersons", () => {
    it("paginiert und zählt", async () => {
      const admin = await scope("admin@example.test");
      const all = await searchPersons(admin, { q: "Becker" });
      expect(all.total).toBeGreaterThan(5);
      const page = await searchPersons(admin, { q: "Becker", limit: 3, offset: 2 });
      expect(page.total).toBe(all.total);
      expect(page.items.map((p) => p.id)).toEqual(all.items.slice(2, 5).map((p) => p.id));
    });

    it("sucht nach mehreren Wörtern und filtert nach Familie", async () => {
      const admin = await scope("admin@example.test");
      const p = mockData().persons.find((x) => x.id === L.crossMarriedIntoA)!;
      const r = await searchPersons(admin, { q: `${p.givenName} ${p.familyName}` });
      expect(r.items.some((x) => x.id === p.id)).toBe(true);

      const viewer = await scope("viewer@example.test");
      expect((await searchPersons(viewer, { familyId: FAMILY_B })).total).toBe(0);
      const inA = await searchPersons(viewer, { familyId: FAMILY_A });
      expect(inA.total).toBe(mockData().persons.filter((x) => x.familyKeys.includes("A")).length);
    });
  });

  describe("Recherche", () => {
    it("getAncestors: Adoptivkind mit drei Elternteilen, leibliche Mutter maskiert für Editor", async () => {
      const admin = await getAncestors(await scope("admin@example.test"), L.adoptee, 2);
      const parents = admin!.entries.filter((e) => e.generation === 1);
      expect(parents).toHaveLength(3);
      expect(parents.filter((e) => e.subtype === "ADOPTIVE")).toHaveLength(2);

      const editor = await getAncestors(await scope("editor@example.test"), L.adoptee, 1);
      const bio = editor!.entries.find((e) => e.person.id === L.biologicalMotherNoFamily)!;
      expect(bio.person.restricted).toBe(true);
    });

    it("getDescendants vom Stammvater A", async () => {
      const r = await getDescendants(await scope("admin@example.test"), L.founders.A, 10);
      expect(r!.entries.length).toBeGreaterThan(10);
      expect(Math.max(...r!.entries.map((e) => e.generation))).toBeGreaterThanOrEqual(4);
    });

    it("findRelationshipPath verbindet Familien, liefert null für Unsichtbare", async () => {
      const admin = await scope("admin@example.test");
      const path = await findRelationshipPath(admin, L.founders.A, L.founders.B);
      expect(path?.found).toBe(true);
      expect(path!.steps[0].person.id).toBe(L.founders.A);
      expect(path!.steps.at(-1)!.person.id).toBe(L.founders.B);

      const viewer = await scope("viewer@example.test");
      expect(await findRelationshipPath(viewer, L.crossMarriedPartnerA, L.inLawOnlyB)).toBeNull();
      // Weg zur sichtbaren Partnerin läuft direkt.
      const direct = await findRelationshipPath(viewer, L.crossMarriedPartnerA, L.crossMarriedIntoA);
      expect(direct?.length).toBe(1);
    });

    it("getStatistics zählt nur Sichtbares", async () => {
      const admin = await getStatistics(await scope("admin@example.test"));
      expect(admin.persons.total).toBe(mockData().persons.length);
      expect(admin.persons.withoutFamily).toBe(L.noFamily.length);

      const viewer = await getStatistics(await scope("viewer@example.test"));
      expect(viewer.persons.total).toBe(mockData().persons.filter((p) => p.familyKeys.includes("A")).length);
      expect(viewer.persons.withoutFamily).toBe(0);
      expect(viewer.families.map((f) => f.id)).toEqual([FAMILY_A]);
    });

    it("findDataGaps findet die eingebauten Lücken", async () => {
      const gaps = await findDataGaps(await scope("admin@example.test"), { limit: 500 });
      const ids = (k: keyof typeof gaps.items) => gaps.items[k].map((i) => i.person.id);
      for (const id of L.missingBirthDate) expect(ids("missingBirthDate")).toContain(id);
      for (const id of L.probablyDeceasedWithoutDeathDate) {
        expect(ids("probablyDeceasedWithoutDeathDate")).toContain(id);
      }
      expect(ids("withoutFamily").sort()).toEqual([...L.noFamily].sort());

      const viewerGaps = await findDataGaps(await scope("viewer@example.test"));
      expect(viewerGaps.counts.withoutFamily).toBe(0);
    });

    it("findPossibleDuplicates meldet die eingebauten Dubletten", async () => {
      const dups = await findPossibleDuplicates(await scope("admin@example.test"));
      for (const [a, b] of L.duplicates) {
        const [x, y] = [a, b].sort();
        expect(dups.some((d) => d.a.id === x && d.b.id === y), `${a}/${b}`).toBe(true);
      }
    });
  });

  describe("Mutationen", () => {
    it("Editor legt Person in Familie A an; Betrachter darf nicht", async () => {
      const editor = await scope("editor@example.test");
      const p = await createPerson(editor, { givenName: "Testkind", familyName: "Vitest", birthDate: "2001-02-03" });
      created.push(p.id);
      expect(p.familyIds).toEqual([FAMILY_A]);

      await expectServiceError(createPerson(await scope("viewer@example.test"), { givenName: "X" }), "FORBIDDEN");
      await expectServiceError(createPerson(editor, { givenName: "X", familyIds: [FAMILY_B] }), "FORBIDDEN");
      await expectServiceError(
        createPerson(editor, { givenName: "X", birthDate: "2000-01-01", deathDate: "1990-01-01" }),
        "VALIDATION",
      );
    });

    it("updatePerson prüft Datumsregeln gegen den gespeicherten Stand", async () => {
      const editor = await scope("editor@example.test");
      const p = await createPerson(editor, { givenName: "Datum", familyName: "Vitest", birthDate: "1950-01-01" });
      created.push(p.id);
      await expectServiceError(updatePerson(editor, p.id, { deathDate: "1940-01-01" }), "VALIDATION");
      const ok = await updatePerson(editor, p.id, { deathDate: "2010-05-05" });
      expect(ok.deathDate?.startsWith("2010-05-05")).toBe(true);
      expect(ok.birthDate?.startsWith("1950-01-01")).toBe(true);

      // Person nur in Familie B: Editor sieht sie (VIEWER), darf sie nicht ändern.
      const onlyB = mockData().persons.find((x) => x.familyKeys.length === 1 && x.familyKeys[0] === "B")!;
      await expectServiceError(updatePerson(editor, onlyB.id, { notes: "x" }), "FORBIDDEN");
      // Person nur in Familie C: unsichtbar -> NOT_FOUND.
      const onlyC = mockData().persons.find((x) => x.familyKeys.length === 1 && x.familyKeys[0] === "C")!;
      await expectServiceError(updatePerson(editor, onlyC.id, { notes: "x" }), "NOT_FOUND");
    });

    it("Beziehungsregeln: Elternlimit, Art, Zyklen, Rechte", async () => {
      const admin = await scope("admin@example.test");
      const editor = await scope("editor@example.test");
      const mk = async (givenName: string, birthDate: string) => {
        const p = await createPerson(editor, { givenName, familyName: "Vitest", birthDate });
        created.push(p.id);
        return p.id;
      };
      const mother = await mk("Mutter", "1960-01-01");
      const father = await mk("Vater", "1958-01-01");
      const adoptive = await mk("Adoptivvater", "1955-01-01");
      const child = await mk("Kind", "1990-01-01");

      await createRelationship(editor, { type: "PARENT_OF", fromPersonId: mother, toPersonId: child });
      await createRelationship(editor, { type: "PARENT_OF", fromPersonId: father, toPersonId: child, subtype: "BIOLOGICAL" });
      // Dritter leiblicher Elternteil: Konflikt.
      await expectServiceError(
        createRelationship(editor, { type: "PARENT_OF", fromPersonId: adoptive, toPersonId: child }),
        "CONFLICT",
      );
      // Als Adoptivvater erlaubt.
      const adoption = await createRelationship(editor, {
        type: "PARENT_OF",
        subtype: "ADOPTIVE",
        fromPersonId: adoptive,
        toPersonId: child,
        startDate: "1992-06-01",
      });
      // ... aber nicht nachträglich auf leiblich umstellbar.
      await expectServiceError(updateRelationship(editor, adoption.id, { subtype: "BIOLOGICAL" }), "CONFLICT");
      // Art passt nicht zum Typ.
      await expectServiceError(updateRelationship(editor, adoption.id, { subtype: "MARRIED" }), "VALIDATION");

      await expectServiceError(
        createRelationship(editor, { type: "PARENT_OF", subtype: "MARRIED", fromPersonId: mother, toPersonId: child }),
        "VALIDATION",
      );
      // Zyklus.
      await expectServiceError(
        createRelationship(editor, { type: "PARENT_OF", fromPersonId: child, toPersonId: mother }),
        "CONFLICT",
      );
      // Partnerschaft wird kanonisch gespeichert, Dublette in Gegenrichtung erkannt.
      const marriage = await createRelationship(editor, {
        type: "PARTNER_OF",
        fromPersonId: mother,
        toPersonId: father,
        startDate: "1985-05-05",
        endDate: "1980-01-01",
      }).catch((e) => e);
      expect(marriage).toBeInstanceOf(ServiceError);
      const ok = await createRelationship(editor, { type: "PARTNER_OF", fromPersonId: mother, toPersonId: father });
      expect(ok.subtype).toBe("MARRIED");
      expect(ok.fromPersonId < ok.toPersonId).toBe(true);
      await expectServiceError(
        createRelationship(editor, { type: "PARTNER_OF", fromPersonId: father, toPersonId: mother }),
        "CONFLICT",
      );
      // Ende vor Beginn beim Ändern.
      await expectServiceError(
        updateRelationship(editor, ok.id, { subtype: "DIVORCED", startDate: "1990-01-01", endDate: "1985-01-01" }),
        "VALIDATION",
      );

      // Betrachter darf keine Beziehungen anlegen.
      await expectServiceError(
        createRelationship(await scope("viewer@example.test"), { type: "PARTNER_OF", fromPersonId: adoptive, toPersonId: mother }),
        "FORBIDDEN",
      );
      // Unbekannte Person.
      await expectServiceError(
        createRelationship(admin, { type: "PARENT_OF", fromPersonId: mother, toPersonId: "gibt-es-nicht" }),
        "NOT_FOUND",
      );

      // Löschen mit Beziehungen nur mit force.
      await expectServiceError(deletePerson(editor, adoptive), "CONFLICT");
      const del = await deletePerson(editor, adoptive, { force: true });
      expect(del.relationCount).toBe(1);
    });

    it("setPersonFamilies erhält fremde Familien und schützt nur lesbare", async () => {
      const editor = await scope("editor@example.test");
      const aAndC = mockData().persons.find(
        (p) => p.familyKeys.includes("A") && p.familyKeys.includes("C") && !p.familyKeys.includes("B"),
      )!;
      const r = await setPersonFamilies(editor, aAndC.id, [FAMILY_A]);
      expect(r.familyIds).toEqual([FAMILY_A]);
      const stored = await prisma.personFamily.findMany({ where: { personId: aAndC.id } });
      expect(stored.map((f) => f.familyId).sort()).toEqual([FAMILY_A, FAMILY_C]);

      // B ist für den Editor nur lesbar: weglassen = entfernen = verboten.
      await expectServiceError(setPersonFamilies(editor, L.crossMarriedIntoA, [FAMILY_A]), "FORBIDDEN");
    });

    it("setPersonFamilies: Bearbeiter können sich nicht selbst aussperren, Administratoren dürfen „ohne Familie“", async () => {
      const editor = await scope("editor@example.test"); // A bearbeiten, B lesen
      const admin = await scope("admin@example.test");
      const onlyA = await createPerson(admin, { givenName: "Aussperren", familyName: "Testfall", familyIds: [FAMILY_A] });
      const aAndB = await createPerson(admin, { givenName: "Aussperren", familyName: "Testfall B", familyIds: [FAMILY_A, FAMILY_B] });
      try {
        // Letzte Familie abwählen: abgelehnt, Zuordnung unverändert.
        await expectServiceError(setPersonFamilies(editor, onlyA.id, []), "VALIDATION");
        expect((await prisma.personFamily.findMany({ where: { personId: onlyA.id } })).map((f) => f.familyId)).toEqual([FAMILY_A]);
        // A abwählen, B (nur lesbar) bliebe: auch abgelehnt — danach dürfte er nicht mehr bearbeiten.
        await expectServiceError(setPersonFamilies(editor, aAndB.id, [FAMILY_B]), "VALIDATION");
        // Administrator: „ohne Familie“ bleibt möglich, und er sieht die Person weiter.
        expect((await setPersonFamilies(admin, onlyA.id, [])).familyIds).toEqual([]);
        expect(await getPersonDetail(admin, onlyA.id)).not.toBeNull();
      } finally {
        await prisma.person.deleteMany({ where: { id: { in: [onlyA.id, aAndB.id] } } });
      }
    });
  });
});
