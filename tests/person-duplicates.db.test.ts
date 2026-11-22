/**
 * Mögliche Dubletten einer einzelnen Person (Hinweis auf der Personenseite)
 * gegen die Testdatenbank: dieselben Paare und Klassen wie die Gesamtliste,
 * Rechte (nur wer BEIDE Einträge bearbeiten darf, erfährt etwas — auch keine
 * Anzahl), „kein Duplikat“, Namensvarianten, Begrenzung, Herkunft. Nur
 * erfundene Namen; räumt auf. Überspringt sich ohne Datenbank.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { createPerson, scopeForEmail } from "@/lib/services";
import { dismissDuplicate, listDuplicateCandidates, listDuplicatesOfPerson, undismissDuplicate } from "@/lib/services/duplicates";
import { mockData } from "./helpers";
import { randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Dubletten-Hinweis-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";
const FAMILY_B = "mock-family-b";

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

describe.skipIf(Boolean(skipReason))("Mögliche Dubletten einer Person (Testdatenbank)", () => {
  const persons: string[] = [];
  const batches: string[] = [];
  let admin: Scope;
  let editor: Scope; // Familie A bearbeiten, Familie B lesen
  let viewer: Scope; // Familie A lesen
  let nofamily: Scope;

  /** Person mit eigenem Familiennamen (kollidiert nicht mit Mock-Daten oder anderen Läufen). */
  async function person(data: Record<string, unknown>, familyIds = [FAMILY_A]) {
    const p = await createPerson(admin, { gender: "FEMALE", ...data, familyIds });
    persons.push(p.id);
    return p;
  }
  const idsOf = async (s: Scope, id: string, limit = 50) => (await listDuplicatesOfPerson(s, id, { limit })).items.map((d) => d.person.id);

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    nofamily = await scope("nofamily@example.test");
  });

  afterAll(async () => {
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: batches } } });
  });

  it("findet die Dubletten der Mock-Daten in beiden Richtungen — dieselbe Bewertung wie die Gesamtliste", async () => {
    const all = await listDuplicateCandidates(admin, { limit: 500 });
    for (const [a, b] of mockData().landmarks.duplicates) {
      const listed = all.items.find((d) => (d.a.id === a && d.b.id === b) || (d.a.id === b && d.b.id === a));
      expect(listed, `${a}/${b} in der Gesamtliste`).toBeTruthy();
      for (const [self, other] of [
        [a, b],
        [b, a],
      ]) {
        const hit = (await listDuplicatesOfPerson(admin, self, { limit: 50 })).items.find((d) => d.person.id === other);
        // „unklar“ nennt der Hinweis nicht (nur die Liste).
        if (listed!.confidence === "low") {
          expect(hit, `${other} bei ${self}`).toBeUndefined();
          continue;
        }
        expect(hit, `${other} bei ${self}`).toBeTruthy();
        expect({ score: hit!.score, confidence: hit!.confidence, reasons: hit!.reasons, conflicts: hit!.conflicts }).toEqual({
          score: listed!.score,
          confidence: listed!.confidence,
          reasons: listed!.reasons,
          conflicts: listed!.conflicts,
        });
        expect(hit!.origin).toEqual(["von Hand erfasst"]);
      }
    }
  });

  it("liefert für jede Person genau die sicheren und wahrscheinlichen Paare der Gesamtliste, an denen sie beteiligt ist", async () => {
    const all = await listDuplicateCandidates(admin, { limit: 500 });
    expect(all.total).toBeLessThanOrEqual(500);
    const expected = new Map<string, string[]>();
    for (const d of all.items) {
      if (d.confidence === "low") continue;
      expected.set(d.a.id, [...(expected.get(d.a.id) ?? []), d.b.id]);
      expected.set(d.b.id, [...(expected.get(d.b.id) ?? []), d.a.id]);
    }
    // Alle Beteiligten und dazu eine Auswahl Unbeteiligter.
    const others = mockData()
      .persons.map((p) => p.id)
      .filter((id) => !expected.has(id))
      .slice(0, 25);
    for (const id of [...expected.keys(), ...others]) {
      const res = await listDuplicatesOfPerson(admin, id, { limit: 50 });
      expect(res.items.map((d) => d.person.id).sort(), id).toEqual([...(expected.get(id) ?? [])].sort());
      expect(res.total).toBe(res.items.length);
    }
  });

  it("Rechte: nur wer beide Einträge bearbeiten darf, sieht den Kandidaten — sonst auch keine Anzahl", async () => {
    const [[a1, a2], [b1, b2], [c1, c2]] = mockData().landmarks.duplicates; // je ein Paar in Familie A, B, C
    // Bearbeiter von A: Paar in A ja; Paar in B (nur lesbar) und C (unsichtbar) nein.
    expect(await idsOf(editor, a1)).toContain(a2);
    expect(await idsOf(editor, a2)).toContain(a1);
    for (const id of [b1, b2, c1, c2]) expect(await listDuplicatesOfPerson(editor, id), id).toEqual({ total: 0, items: [] });
    // Betrachter und Benutzer ohne Familie: nie.
    for (const s of [viewer, nofamily]) {
      for (const id of [a1, a2, b1, b2, c1, c2]) expect(await listDuplicatesOfPerson(s, id), id).toEqual({ total: 0, items: [] });
    }
    // Unbekannte Person: leer, kein Fehler.
    expect(await listDuplicatesOfPerson(admin, "gibt-es-nicht")).toEqual({ total: 0, items: [] });
  });

  it("Rechte über Familiengrenzen: Kandidat in einer nur lesbaren Familie bleibt verborgen", async () => {
    const sn = randomSurname();
    const same = { givenName: "Thekla", familyName: sn, birthDate: "1850-03-12", deathDate: "1920-07-01" };
    const inA = await person(same, [FAMILY_A]);
    const inB = await person(same, [FAMILY_B]);
    const inA2 = await person(same, [FAMILY_A]);
    const none = await person(same, []);
    // Admin sieht alle drei anderen, auch die Person ohne Familie.
    expect((await idsOf(admin, inA.id)).sort()).toEqual([inA2.id, inB.id, none.id].sort());
    // Bearbeiter von A (B nur lesen): nur der Eintrag in A — und die Anzahl zählt die anderen nicht mit.
    const res = await listDuplicatesOfPerson(editor, inA.id, { limit: 50 });
    expect(res.items.map((d) => d.person.id)).toEqual([inA2.id]);
    expect(res.total).toBe(1);
    // Von der nur lesbaren Person aus: nichts.
    expect(await listDuplicatesOfPerson(editor, inB.id)).toEqual({ total: 0, items: [] });
    expect(await listDuplicatesOfPerson(viewer, inA.id)).toEqual({ total: 0, items: [] });
  });

  it("„kein Duplikat“ blendet das Paar aus, Aufheben bringt es zurück", async () => {
    const sn = randomSurname();
    const same = { givenName: "Ottilie", familyName: sn, birthDate: "1861-05-04", deathDate: "1930-02-11" };
    const a = await person(same);
    const b = await person(same);
    const c = await person(same);
    expect((await idsOf(editor, a.id)).sort()).toEqual([b.id, c.id].sort());
    const first = (await listDuplicatesOfPerson(editor, a.id)).items[0];
    expect(first.confidence).toBe("high");

    await dismissDuplicate(editor, b.id, a.id);
    expect(await idsOf(editor, a.id)).toEqual([c.id]);
    expect(await idsOf(editor, b.id)).toEqual([c.id]);
    expect((await listDuplicatesOfPerson(editor, a.id)).total).toBe(1);

    await undismissDuplicate(editor, a.id, b.id);
    expect((await idsOf(editor, a.id)).sort()).toEqual([b.id, c.id].sort());
  });

  it("findet Kandidaten auch über den ersten Vornamen einer Namensvariante", async () => {
    const sn = randomSurname();
    const a = await person({ givenName: "Wilhelmine", familyName: sn, birthDate: "1840-01-09", deathDate: "1899-10-30" });
    const b = await person({ givenName: "Minna", familyName: sn, birthDate: "1840-01-09", deathDate: "1899-10-30" });
    expect(await idsOf(admin, a.id)).toEqual([]);
    await prisma.personName.create({ data: { personId: b.id, givenName: "Wilhelmine", familyName: sn } });
    expect(await idsOf(admin, a.id)).toEqual([b.id]);
    expect(await idsOf(admin, b.id)).toEqual([a.id]);
  });

  it("keine Kandidaten: anderes Geschlecht, direkte Verwandte, anderer Nachname", async () => {
    const sn = randomSurname();
    const base = { givenName: "Leopoldine", familyName: sn, birthDate: "1870-08-08" };
    const a = await person(base);
    await person({ ...base, gender: "MALE" });
    await person({ ...base, familyName: randomSurname() + "x" });
    const mother = await person({ ...base, birthDate: "1870" });
    await prisma.relationship.create({ data: { type: "PARENT_OF", subtype: "BIOLOGICAL", fromPersonId: mother.id, toPersonId: a.id } });
    expect(await listDuplicatesOfPerson(admin, a.id)).toEqual({ total: 0, items: [] });
  });

  /** Paar in der Gesamtliste (beliebige Klasse)? */
  const listedPair = async (s: Scope, x: string, y: string) =>
    (await listDuplicateCandidates(s, { limit: 500 })).items.find((d) => [d.a.id, d.b.id].includes(x) && [d.a.id, d.b.id].includes(y));
  const parentOf = (parent: string, child: string, subtype: "BIOLOGICAL" | "ADOPTIVE" | "STEP" | "FOSTER" = "BIOLOGICAL") =>
    prisma.relationship.create({ data: { type: "PARENT_OF", subtype, fromPersonId: parent, toPersonId: child } });

  it("Vorfahren und Nachkommen über mehrere Generationen sind nie Kandidaten — weder in der Liste noch im Hinweis", async () => {
    const sn = randomSurname();
    // Urgroßvater und Urenkel gleichen Namens; zum Vergleich ein unverbundener Namensvetter.
    const same = { givenName: "Ortwin", familyName: sn, gender: "MALE", birthDate: "1800", birthPlace: "Nirgendhausen" };
    const top = await person(same);
    const g1 = await person({ givenName: "Lambert", familyName: sn, gender: "MALE", birthDate: "1830" });
    const g2 = await person({ givenName: "Eckhard", familyName: sn, gender: "MALE", birthDate: "1860" });
    const bottom = await person(same);
    const stranger = await person(same);
    await parentOf(top.id, g1.id);
    await parentOf(g1.id, g2.id, "ADOPTIVE"); // auch nicht-leibliche Kanten zählen
    await parentOf(g2.id, bottom.id);

    // Kontrolle: der unverbundene Namensvetter ist mit beiden ein Kandidat („wahrscheinlich“).
    expect((await listedPair(admin, top.id, stranger.id))?.confidence).toBe("medium");
    expect((await listedPair(admin, bottom.id, stranger.id))?.confidence).toBe("medium");
    expect(await idsOf(admin, stranger.id)).toEqual(expect.arrayContaining([top.id, bottom.id]));
    // Urgroßvater/Urenkel: in keiner Richtung.
    expect(await listedPair(admin, top.id, bottom.id)).toBeUndefined();
    expect(await idsOf(admin, top.id)).toEqual([stranger.id]);
    expect(await idsOf(admin, bottom.id)).toEqual([stranger.id]);
    // Ebenso für den Bearbeiter der Familie (alle in Familie A).
    expect(await listedPair(editor, top.id, bottom.id)).toBeUndefined();
    expect(await idsOf(editor, top.id)).toEqual([stranger.id]);
  });

  it("auch ohne Lebensdaten beim Vorfahren („unklar“) und über Stief-/Pflegekanten: nicht in der Liste", async () => {
    const sn = randomSurname();
    const top = await person({ givenName: "Hartmut", familyName: sn, gender: "MALE" });
    const mid = await person({ givenName: "Gisbert", familyName: sn, gender: "MALE", birthDate: "1790" });
    const bottom = await person({ givenName: "Hartmut", familyName: sn, gender: "MALE", birthDate: "1820-04-02" });
    const stranger = await person({ givenName: "Hartmut", familyName: sn, gender: "MALE" });
    await parentOf(top.id, mid.id, "STEP");
    await parentOf(mid.id, bottom.id, "FOSTER");
    expect(await listedPair(admin, top.id, bottom.id)).toBeUndefined();
    expect((await listedPair(admin, bottom.id, stranger.id))?.confidence).toBe("low");
  });

  it("Kette über eine unsichtbare Person: geprüft wird nur über sichtbare Personen — Liste und Hinweis gleich", async () => {
    const sn = randomSurname();
    const same = { givenName: "Ruprecht", familyName: sn, gender: "MALE", birthDate: "1810", birthPlace: "Irgendwo am See" };
    const top = await person(same, [FAMILY_A]);
    const hidden = await person({ givenName: "Wigand", familyName: sn, gender: "MALE", birthDate: "1840" }, ["mock-family-c"]);
    const bottom = await person(same, [FAMILY_A]);
    await parentOf(top.id, hidden.id);
    await parentOf(hidden.id, bottom.id);
    // Admin sieht die ganze Kette: kein Kandidat.
    expect(await listedPair(admin, top.id, bottom.id)).toBeUndefined();
    expect(await idsOf(admin, top.id)).toEqual([]);
    // Der Bearbeiter (Familie C unsichtbar) erfährt nichts über die verborgene
    // Abstammung: Für ihn ist es ein gewöhnliches Paar — in Liste und Hinweis.
    expect((await listedPair(editor, top.id, bottom.id))?.confidence).toBe("medium");
    expect(await idsOf(editor, top.id)).toEqual([bottom.id]);
    expect(await idsOf(editor, bottom.id)).toEqual([top.id]);
  });

  it("„unklar“ steht in der Gesamtliste, aber nicht im Hinweis — auch nicht in der Anzahl", async () => {
    const sn = randomSurname();
    const a = await person({ givenName: "Philippine", familyName: sn, birthDate: "1844-02-03" });
    const b = await person({ givenName: "Philippine", familyName: sn });
    const listed = (await listDuplicateCandidates(admin, { limit: 500 })).items.find(
      (d) => [d.a.id, d.b.id].includes(a.id) && [d.a.id, d.b.id].includes(b.id),
    );
    expect(listed?.confidence).toBe("low");
    expect(await listDuplicatesOfPerson(admin, a.id)).toEqual({ total: 0, items: [] });
    expect(await listDuplicatesOfPerson(admin, b.id)).toEqual({ total: 0, items: [] });
  });

  it("begrenzt die Einträge, zählt aber alle; „sicher“ steht vorn", async () => {
    const sn = randomSurname();
    const same = { givenName: "Kunigunde", familyName: sn, birthDate: "1855-11-02", deathDate: "1921-04-17" };
    const a = await person(same);
    const sure = await person(same);
    for (let i = 0; i < 4; i++) await person({ ...same, birthDate: "1855", deathDate: undefined });
    const res = await listDuplicatesOfPerson(admin, a.id);
    expect(res.total).toBe(5);
    expect(res.items).toHaveLength(3);
    expect(res.items[0].person.id).toBe(sure.id);
    expect(res.items[0].confidence).toBe("high");
    expect((await listDuplicatesOfPerson(admin, a.id, { limit: 50 })).items).toHaveLength(5);
  });

  it("Herkunft: Dateiname des Imports nur für Administratoren, sonst „importiert“; ohne Import „von Hand erfasst“", async () => {
    const sn = randomSurname();
    const same = { givenName: "Friederike", familyName: sn, birthDate: "1833-06-21", deathDate: "1901-12-05" };
    const a = await person(same);
    const b = await person(same);
    const batch = await prisma.importBatch.create({
      data: { format: "GEDCOM", fileName: `test-${sn}.ged`, fileSizeBytes: 1, fileSha256: `test-${sn}`, sourceTreeId: `TEST:${sn}`, status: "COMPLETED" },
    });
    batches.push(batch.id);
    await prisma.importLink.create({
      data: { entityType: "PERSON", personId: b.id, sourceTreeId: `TEST:${sn}`, externalKey: "XREF:@I1@", importHash: "x", firstBatchId: batch.id, lastBatchId: batch.id },
    });
    const forAdmin = (await listDuplicatesOfPerson(admin, a.id)).items[0];
    expect(forAdmin.person.id).toBe(b.id);
    expect(forAdmin.origin).toHaveLength(1);
    expect(forAdmin.origin[0]).toMatch(new RegExp(`^„test-${sn}\\.ged“ \\(\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\)$`));
    expect((await listDuplicatesOfPerson(editor, a.id)).items[0].origin).toEqual(["importiert"]);
    expect((await listDuplicatesOfPerson(editor, b.id)).items[0].origin).toEqual(["von Hand erfasst"]);
  });
});
