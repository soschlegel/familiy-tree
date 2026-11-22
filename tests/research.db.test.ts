/**
 * Dienst-Tests für die Recherche-Ergänzungen (Verwandtschaftsbegriffe,
 * Zeitleisten, Plausibilitätsprüfung, erweiterte Suche) gegen die
 * Mock-Datenbank. Rein lesend; überspringt sich ohne Mock-Datenbank.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import {
  findInconsistencies,
  getFamilyTimeline,
  getDescendants,
  getKinship,
  getPersonTimeline,
  scopeForEmail,
  searchPersons,
} from "@/lib/services";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Recherche-Tests übersprungen: ${skipReason}\n`);

const L = mockData().landmarks;
const byId = new Map(mockData().persons.map((p) => [p.id, p]));

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Recherche-Ergänzungen (Mock-Datenbank)", () => {
  afterAll(async () => {
    if (!skipReason) await prisma.$disconnect();
  });

  describe("getKinship", () => {
    it("Halbgeschwister, Adoption, Ehe und Schwiegereltern", async () => {
      const admin = await scope("admin@example.test");

      const half = (await getKinship(admin, L.halfSiblings[0], L.halfSiblings[1]))!;
      expect(half.blood?.half).toBe(true);
      expect(half.summary).toMatch(/^Halb(bruder|schwester)$/);
      expect(half.path.term).toBe(half.summary);

      const adoptive = (await getKinship(admin, L.adoptee, L.adoptiveParents[0]))!;
      expect(adoptive.summary).toBe("Adoptivvater");

      const spouse = (await getKinship(admin, L.crossMarriedPartnerA, L.crossMarriedIntoA))!;
      expect(spouse.summary).toBe(byId.get(L.crossMarriedIntoA)!.gender === "FEMALE" ? "Ehefrau" : "Ehemann");

      const inLaw = (await getKinship(admin, L.crossMarriedPartnerA, L.inLawOnlyB))!;
      expect(inLaw.summary).toMatch(/^Schwieger(vater|mutter)$/);
      expect(inLaw.path.chain.split(" → ")).toHaveLength(2);

      const ex = (await getKinship(admin, L.divorced.person, L.divorced.firstSpouse))!;
      expect(ex.summary).toMatch(/^geschiedene/);
    });

    it("Nachfahre über mehrere Generationen mit Seite", async () => {
      const admin = await scope("admin@example.test");
      const desc = (await getDescendants(admin, L.founders.A, 3))!;
      const greatGrandchild = desc.entries.find((e) => e.generation === 3)!;
      const down = (await getKinship(admin, L.founders.A, greatGrandchild.person.id))!;
      expect(down.blood).toMatchObject({ generationsUp: 0, generationsDown: 3 });
      expect(down.summary).toMatch(/^Urenkel(in|kind)?$/);

      const up = (await getKinship(admin, greatGrandchild.person.id, L.founders.A))!;
      expect(up.summary).toMatch(/^Urgroßvater (väterlicherseits|mütterlicherseits)$/);

      const back = await getKinship(admin, L.adoptee, L.adoptee);
      expect(back?.summary).toBe("dieselbe Person");
    });

    it("verborgene Personen: kein Ergebnis bzw. Platzhalter ohne Geschlecht", async () => {
      const viewer = await scope("viewer@example.test");
      expect(await getKinship(viewer, L.crossMarriedPartnerA, L.inLawOnlyB)).toBeNull();

      const editor = await scope("editor@example.test");
      // Adoptivkind -> leibliche Mutter (ohne Familie): für den Editor unsichtbar.
      expect(await getKinship(editor, L.adoptee, L.biologicalMotherNoFamily)).toBeNull();
    });
  });

  describe("Zeitleisten", () => {
    it("Person: Heirat und Scheidung in zeitlicher Reihenfolge, mit Alter", async () => {
      const admin = await scope("admin@example.test");
      const t = (await getPersonTimeline(admin, L.divorced.person))!;
      const kinds = t.events.map((e) => e.kind);
      expect(kinds).toContain("marriage");
      expect(kinds).toContain("divorce");
      const dates = t.events.map((e) => e.date);
      expect([...dates].sort()).toEqual(dates);
      const birth = t.events.find((e) => e.kind === "birth" && e.role === "self");
      expect(birth?.age).toBe(0);
    });

    it("Person: verborgene Verwandte liefern keine Lebensdaten", async () => {
      const viewer = await scope("viewer@example.test");
      const t = (await getPersonTimeline(viewer, L.crossMarriedIntoA))!;
      for (const e of t.events) {
        if (e.kind === "birth" || e.kind === "death") {
          expect(e.persons.every((p) => !p.restricted)).toBe(true);
        }
      }
      expect(t.events.some((e) => e.persons.some((p) => p.id === L.inLawOnlyB && (e.kind === "death" || e.kind === "birth")))).toBe(false);
    });

    it("Familie: Zeitraum, Seiten und fremde Familien", async () => {
      const admin = await scope("admin@example.test");
      const t = (await getFamilyTimeline(admin, "mock-family-a", { fromYear: 1950, toYear: 1960, limit: 5 }))!;
      expect(t.family.id).toBe("mock-family-a");
      expect(t.events.length).toBeLessThanOrEqual(5);
      expect(t.total).toBeGreaterThan(5);
      for (const e of t.events) {
        const y = Number(e.date.slice(0, 4));
        expect(y >= 1950 && y <= 1960).toBe(true);
      }

      const viewer = await scope("viewer@example.test");
      expect(await getFamilyTimeline(viewer, "mock-family-b")).toBeNull();
      expect(await getFamilyTimeline(admin, "gibt-es-nicht")).toBeNull();
    });
  });

  describe("findInconsistencies", () => {
    it("findet die über 110-Jährigen ohne Sterbedatum und filtert nach Person", async () => {
      const admin = await scope("admin@example.test");
      const r = await findInconsistencies(admin, { limit: 500 });
      expect(r.total).toBe(r.items.length);
      const over = r.items.filter((i) => i.kind === "lifespanOver110").map((i) => i.persons[0].id);
      // Mindestens eine der als "vermutlich verstorben" angelegten Personen
      // ist laut Daten älter als 110 Jahre.
      expect(L.probablyDeceasedWithoutDeathDate.some((id) => over.includes(id))).toBe(true);

      const one = await findInconsistencies(admin, { personId: over[0] });
      expect(one.items.every((i) => i.persons.some((p) => p.id === over[0]))).toBe(true);
    });

    it("Betrachter sieht nur Meldungen über sichtbare Personen", async () => {
      const viewer = await scope("viewer@example.test");
      const r = await findInconsistencies(viewer, { limit: 500 });
      const visible = new Set(mockData().persons.filter((p) => p.familyKeys.includes("A")).map((p) => p.id));
      for (const i of r.items) for (const p of i.persons) expect(visible.has(p.id)).toBe(true);
    });
  });

  describe("searchPersons (Erweiterungen)", () => {
    it("Geburtsjahr, Ort, Geschlecht, verstorben", async () => {
      const admin = await scope("admin@example.test");
      const year = (p: { birthDate: Date | null }) => p.birthDate?.getUTCFullYear();
      const expected = mockData().persons.filter((p) => {
        const y = year(p);
        return y !== undefined && y >= 1900 && y <= 1930 && p.gender === "FEMALE" && p.deathDate !== null;
      });
      const r = await searchPersons(admin, { bornFrom: 1900, bornTo: 1930, gender: "FEMALE", deceased: true });
      expect(r.total).toBe(expected.length);

      // Ort = Geburts-/Sterbeort, Ort eines eigenen Ereignisses, Heirats-/
      // Scheidungsort oder Ort eines Ereignisses einer eigenen Beziehung.
      const place = "hannover";
      const m = mockData();
      const has = (x: string | null | undefined) => Boolean(x?.toLowerCase().includes(place));
      const relHit = new Set(
        m.relationships
          .filter((r) => has(r.startPlace) || has(r.endPlace) || m.events.some((e) => e.relationshipId === r.id && has(e.place)))
          .flatMap((r) => [r.fromPersonId, r.toPersonId]),
      );
      const atPlace = m.persons.filter(
        (p) =>
          [p.birthPlace, p.deathPlace].some(has) ||
          m.events.some((e) => e.personId === p.id && has(e.place)) ||
          relHit.has(p.id),
      );
      expect((await searchPersons(admin, { place })).total).toBe(atPlace.length);
      expect(atPlace.length).toBeGreaterThan(0);

      const living = await searchPersons(admin, { deceased: false, bornTo: 1850 });
      expect(living.items.every((p) => p.deathDate === null)).toBe(true);
    });
  });
});
