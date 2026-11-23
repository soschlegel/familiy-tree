/**
 * Folgedubletten nach einem Zusammenführen und „Erst die Eltern, dann dieses
 * Paar“ gegen die Testdatenbank:
 * - Eltern × Eltern, Partner × Partner, Kinder × Kinder der bleibenden Person
 *   mit genau den Klassen der Dublettenliste; gleichnamige Geschwister
 *   „unklar“; Rechte; „kein Duplikat“.
 * - Gemeinsam zusammenführen nur über die normale Vorschau und nur „sicher“ —
 *   ein „wahrscheinliches“ Paar geht nie mit.
 * - Eltern zuerst: eine Transaktion, nur die vorgeschlagenen Paare, bei jedem
 *   Hindernis bleibt alles, wie es war.
 * Nur erfundene Namen; räumt auf. Überspringt sich ohne Datenbank.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { bulkMerge, createPerson, createRelationship, mergePersons, previewBulkMerge, previewPersonMerge, scopeForEmail, ServiceError } from "@/lib/services";
import { dismissDuplicate } from "@/lib/services/duplicates";
import { listFollowUpDuplicates } from "@/lib/services/merge-followups";
import { randomSurname } from "./merge-fixtures";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Folgedubletten-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a"; // Bearbeiter: bearbeiten
const FAMILY_B = "mock-family-b"; // Bearbeiter: lesen

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe(code);
    return err as ServiceError;
  }
  throw new Error(`erwartet: ${code}`);
}

describe.skipIf(Boolean(skipReason))("Folgedubletten und Eltern zuerst (Testdatenbank)", () => {
  const persons: string[] = [];
  const startedAt = new Date();
  let admin: Scope;
  let editor: Scope;
  let viewer: Scope;

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
  });

  afterAll(async () => {
    if (skipReason) return;
    await prisma.person.deleteMany({ where: { id: { in: persons } } });
    await prisma.personRedirect.deleteMany({ where: { fromId: { in: persons } } });
    await prisma.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, personIds: { hasSome: persons } } });
    await prisma.$disconnect();
  });

  async function person(data: Record<string, unknown>, familyIds = [FAMILY_A]) {
    const p = await createPerson(admin, { ...data, familyIds });
    persons.push(p.id);
    return p.id;
  }
  const parentOf = (from: string, to: string) => createRelationship(admin, { type: "PARENT_OF", fromPersonId: from, toPersonId: to });
  const partnerOf = (a: string, b: string) => createRelationship(admin, { type: "PARTNER_OF", subtype: "MARRIED", fromPersonId: a, toPersonId: b });
  const exists = async (id: string) => Boolean(await prisma.person.findUnique({ where: { id }, select: { id: true } }));
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const byPair = async (s: Scope, ids: string[]) => new Map((await listFollowUpDuplicates(s, ids)).items.map((i) => [key(i.a.id, i.b.id), i]));

  it("nach dem Zusammenführen: Eltern, Partner und Kinder der bleibenden Person mit den Klassen der Liste", async () => {
    const sn = randomSurname();
    const lotte = { givenName: "Lotte", familyName: sn, gender: "FEMALE", birthDate: "1830-05-01" };
    const k = await person(lotte);
    const x = await person(lotte);
    // Je Eintrag ein eigener Vater (gleiche tagesgenaue Daten), Partner, Kinder
    const f1 = await person({ givenName: "Konrad", familyName: sn, gender: "MALE", birthDate: "1800-01-02" });
    const f2 = await person({ givenName: "Konrad", familyName: sn, gender: "MALE", birthDate: "1800-01-02" });
    const p1 = await person({ givenName: "Emil", familyName: "Tarvik", gender: "MALE", birthDate: "1828-03-03" });
    const p2 = await person({ givenName: "Emil", familyName: "Tarvik", gender: "MALE", birthDate: "1828-03-03" });
    // Kinder: „Ida“ nur mit Jahr (wahrscheinlich), „Paul“ dreifach (gleichnamige Geschwister → unklar), „Rosa“ nur einmal
    const ida1 = await person({ givenName: "Ida", familyName: "Tarvik", gender: "FEMALE", birthDate: "1855" });
    const ida2 = await person({ givenName: "Ida", familyName: "Tarvik", gender: "FEMALE", birthDate: "1855" });
    const paul1 = await person({ givenName: "Paul", familyName: "Tarvik", gender: "MALE", birthDate: "1857-02-02" });
    const paul2 = await person({ givenName: "Paul", familyName: "Tarvik", gender: "MALE", birthDate: "1857-02-02" });
    const paul3 = await person({ givenName: "Paul", familyName: "Tarvik", gender: "MALE", birthDate: "1857-02-02" });
    const rosa = await person({ givenName: "Rosa", familyName: "Tarvik", gender: "FEMALE", birthDate: "1859" });
    await parentOf(f1, k);
    await parentOf(f2, x);
    await partnerOf(k, p1);
    await partnerOf(x, p2);
    for (const c of [ida1, paul1, rosa]) await parentOf(k, c);
    for (const c of [ida2, paul2, paul3]) await parentOf(x, c);

    // Vorher hängt an jedem Eintrag nur einer: keine Folgedubletten.
    expect((await listFollowUpDuplicates(admin, [k])).items).toEqual([]);
    await mergePersons(admin, { keepId: k, mergeId: x });

    const res = await listFollowUpDuplicates(admin, [k]);
    const pairs = new Map(res.items.map((i) => [key(i.a.id, i.b.id), i]));
    expect([...pairs.keys()].sort()).toEqual([key(f1, f2), key(p1, p2), key(ida1, ida2), key(paul1, paul2), key(paul1, paul3), key(paul2, paul3)].sort());
    expect(pairs.get(key(f1, f2))).toMatchObject({ confidence: "high", via: { id: k, relation: "parents" } });
    expect(pairs.get(key(f1, f2))!.reasons).toContain("dasselbe Kind eingetragen");
    expect(pairs.get(key(f1, f2))!.sentence).toMatch(/^Gleicher Name, gleiches Geburtsdatum \(02\.01\.1800\), dasselbe Kind eingetragen\.$/);
    expect(pairs.get(key(p1, p2))).toMatchObject({ confidence: "high", via: { relation: "partners" } });
    expect(pairs.get(key(ida1, ida2))).toMatchObject({ confidence: "medium", via: { relation: "children" } });
    for (const pk of [key(paul1, paul2), key(paul1, paul3), key(paul2, paul3)]) {
      expect(pairs.get(pk)!.confidence).toBe("low");
      expect(pairs.get(pk)!.conflicts.join()).toContain("mehrere Verwandte");
    }
    expect(res.sure).toBe(2);
    // „sicher“ zuerst
    expect(res.items.slice(0, 2).every((i) => i.confidence === "high")).toBe(true);

    // Rechte: Der Bearbeiter von A sieht dasselbe, der Betrachter nichts.
    expect([...(await byPair(editor, [k])).keys()].sort()).toEqual([...pairs.keys()].sort());
    expect((await listFollowUpDuplicates(viewer, [k])).items).toEqual([]);
    // Unbekannte Person: nichts; ohne Kennung: Eingabefehler
    expect((await listFollowUpDuplicates(admin, ["gibt-es-nicht"])).items).toEqual([]);
    await expectCode(listFollowUpDuplicates(admin, []), "VALIDATION");
    await expectCode(listFollowUpDuplicates(admin, "k"), "VALIDATION");

    // „Kein Duplikat“ blendet das Paar aus.
    await dismissDuplicate(admin, p1, p2);
    expect((await byPair(admin, [k])).has(key(p1, p2))).toBe(false);

    // Gemeinsam nur über die Vorschau und nur „sicher“: das wahrscheinliche Paar geht nie mit.
    const preview = await previewBulkMerge(admin, { pairs: [{ a: f1, b: f2 }, { a: ida1, b: ida2 }] });
    expect(preview.pairs.map((p) => p.status)).toEqual(["ready"]);
    expect(preview.skipped).toEqual([{ a: ida1, b: ida2, reason: expect.stringContaining("sicher") }]);
    const done = await bulkMerge(admin, { pairs: [{ a: f1, b: f2 }, { a: ida1, b: ida2 }] });
    expect(done.merged).toHaveLength(1);
    expect(done.skipped).toHaveLength(1);
    expect(await exists(ida1)).toBe(true);
    expect(await exists(ida2)).toBe(true);
    // Danach neu gesucht (auch beim eben zusammengeführten Vater): der Vater ist nicht mehr dabei.
    const after = await byPair(admin, [k, done.merged[0].keepId]);
    expect(after.has(key(f1, f2))).toBe(false);
    expect(after.has(key(ida1, ida2))).toBe(true);
  });

  it("nur Paare, die der Benutzer zusammenführen dürfte; Verwandte in gerader Linie und Verbundene nie", async () => {
    const sn = randomSurname();
    const k = await person({ givenName: "Minna", familyName: sn, gender: "FEMALE", birthDate: "1840-06-06" });
    // Zwei gleiche Partner — einer davon in Familie B (für den Bearbeiter nur lesbar)
    const p1 = await person({ givenName: "Franz", familyName: sn, gender: "MALE", birthDate: "1838-01-01" });
    const p2 = await person({ givenName: "Franz", familyName: sn, gender: "MALE", birthDate: "1838-01-01" }, [FAMILY_B]);
    await partnerOf(k, p1);
    await partnerOf(k, p2);
    // Zwei gleichnamige Kinder, die miteinander verbunden sind (Erfassungsfehler): kein Paar
    const c1 = await person({ givenName: "Hugo", familyName: sn, gender: "MALE" });
    const c2 = await person({ givenName: "Hugo", familyName: sn, gender: "MALE" });
    await parentOf(k, c1);
    await parentOf(k, c2);
    await parentOf(c1, c2);
    // Verschiedenes Geschlecht bzw. anderer Vorname: kein Paar
    const d1 = await person({ givenName: "Toni", familyName: sn, gender: "MALE", birthDate: "1861" });
    const d2 = await person({ givenName: "Toni", familyName: sn, gender: "FEMALE", birthDate: "1861" });
    await parentOf(k, d1);
    await parentOf(k, d2);

    const adminPairs = await byPair(admin, [k]);
    expect([...adminPairs.keys()]).toEqual([key(p1, p2)]);
    expect((await listFollowUpDuplicates(editor, [k])).items).toEqual([]);
  });

  it("Eltern zuerst: Vorschlag der Sperre, ein Schritt, beide Zusammenführungen im Audit und als Umleitung", async () => {
    const sn = randomSurname();
    const father = await person({ givenName: "Konrad", familyName: sn, gender: "MALE", birthDate: "1800" });
    const m1 = await person({ givenName: "Regina", familyName: sn, gender: "FEMALE", birthDate: "1802-02-02" });
    const m2 = await person({ givenName: "Regina", familyName: sn, gender: "FEMALE", birthDate: "1802-02-02" });
    const k = await person({ givenName: "Lotte", familyName: sn, gender: "FEMALE", birthDate: "1830-05-01" });
    const x = await person({ givenName: "Lotte", familyName: sn, gender: "FEMALE", birthDate: "1830-05-01" });
    for (const [par, ch] of [[father, k], [m1, k], [father, x], [m2, x]]) await parentOf(par, ch);

    const preview = await previewPersonMerge(editor, k, x);
    expect(preview.canMerge).toBe(false);
    expect(preview.blockers).toHaveLength(1);
    expect(preview.blockers[0]).toMatchObject({ code: "BIO_PARENTS", resolvable: true, suggestPairs: [[m1, m2]] });
    const parentPreview = await previewPersonMerge(editor, m1, m2);
    expect(parentPreview.canMerge).toBe(true);

    // Ohne die Angabe bleibt es bei der Sperre.
    await expectCode(mergePersons(editor, { keepId: k, mergeId: x, expectedToken: preview.token }), "CONFLICT");
    // Andere Paare als die vorgeschlagenen (auch umgedreht) nimmt der Server nicht.
    await expectCode(mergePersons(editor, { keepId: k, mergeId: x, parentsFirst: [{ keepId: m2, mergeId: m1 }] }), "CONFLICT");
    await expectCode(mergePersons(editor, { keepId: k, mergeId: x, parentsFirst: [{ keepId: father, mergeId: m2 }] }), "CONFLICT");
    await expectCode(mergePersons(editor, { keepId: k, mergeId: x, parentsFirst: [{ keepId: m1, mergeId: m2 }, { keepId: m1, mergeId: m2 }] }), "CONFLICT");
    // Veralteter Stand eines Elternpaars: nichts geschieht — auch das Elternpaar bleibt getrennt.
    await expectCode(mergePersons(editor, { keepId: k, mergeId: x, expectedToken: preview.token, parentsFirst: [{ keepId: m1, mergeId: m2, expectedToken: "veraltet" }] }), "CONFLICT");
    for (const id of [k, x, m1, m2]) expect(await exists(id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "MERGE", entityId: { in: [k, m1] } } })).toBe(0);

    const result = await mergePersons(editor, {
      keepId: k,
      mergeId: x,
      expectedToken: preview.token,
      parentsFirst: [{ keepId: m1, mergeId: m2, expectedToken: parentPreview.token }],
    });
    expect(result).toMatchObject({ keepId: k, mergedId: x, alreadyMerged: false });
    expect(result.parentMerges).toEqual([{ keepId: m1, mergedId: m2, name: `Regina ${sn}` }]);
    expect(await exists(x)).toBe(false);
    expect(await exists(m2)).toBe(false);
    const parents = await prisma.relationship.findMany({ where: { toPersonId: k, type: "PARENT_OF" }, select: { fromPersonId: true } });
    expect(parents.map((p) => p.fromPersonId).sort()).toEqual([father, m1].sort());
    expect(await prisma.auditLog.count({ where: { action: "MERGE", entityId: m1, diff: { path: ["mergeId"], equals: m2 } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "MERGE", entityId: k, diff: { path: ["mergeId"], equals: x } } })).toBe(1);
    expect((await prisma.personRedirect.findMany({ where: { fromId: { in: [x, m2] } }, orderBy: { toId: "asc" } })).map((r) => `${r.fromId}→${r.toId}`).sort()).toEqual(
      [`${x}→${k}`, `${m2}→${m1}`].sort(),
    );
    // Danach keine Folgedubletten mehr bei den Eltern.
    expect((await listFollowUpDuplicates(editor, [k, m1])).items).toEqual([]);
    // Doppeltes Absenden liefert das gespeicherte Ergebnis.
    const again = await mergePersons(editor, { keepId: k, mergeId: x, parentsFirst: [{ keepId: m1, mergeId: m2 }] });
    expect(again.alreadyMerged).toBe(true);
  });

  it("Eltern zuerst geht nicht, wenn danach noch etwas im Weg steht oder Rechte fehlen — dann ändert sich nichts", async () => {
    // (1) Zwei verschiedene Väter und eine doppelte Mutter: Die Mutter allein hebt die Sperre nicht auf.
    const sn = randomSurname();
    const f1 = await person({ givenName: "Konrad", familyName: sn, gender: "MALE", birthDate: "1800" });
    const f2 = await person({ givenName: "Albert", familyName: sn, gender: "MALE", birthDate: "1801" });
    const m1 = await person({ givenName: "Regina", familyName: sn, gender: "FEMALE", birthDate: "1802-02-02" });
    const m2 = await person({ givenName: "Regina", familyName: sn, gender: "FEMALE", birthDate: "1802-02-02" });
    const k = await person({ givenName: "Lotte", familyName: sn, gender: "FEMALE", birthDate: "1830-05-01" });
    const x = await person({ givenName: "Lotte", familyName: sn, gender: "FEMALE", birthDate: "1830-05-01" });
    for (const [par, ch] of [[f1, k], [m1, k], [f2, x], [m2, x]]) await parentOf(par, ch);
    const preview = await previewPersonMerge(admin, k, x);
    expect(preview.blockers[0]).toMatchObject({ code: "BIO_PARENTS", resolvable: false, suggestPairs: [[m1, m2]] });
    await expectCode(mergePersons(admin, { keepId: k, mergeId: x, parentsFirst: [{ keepId: m1, mergeId: m2 }] }), "CONFLICT");
    for (const id of [k, x, m1, m2]) expect(await exists(id)).toBe(true);

    // (2) Die doppelte Mutter des anderen Eintrags liegt in einer Familie, die der Bearbeiter nur lesen darf.
    const sn2 = randomSurname();
    const father = await person({ givenName: "Konrad", familyName: sn2, gender: "MALE", birthDate: "1800" });
    const n1 = await person({ givenName: "Regina", familyName: sn2, gender: "FEMALE", birthDate: "1802-02-02" });
    const n2 = await person({ givenName: "Regina", familyName: sn2, gender: "FEMALE", birthDate: "1802-02-02" }, [FAMILY_B]);
    const k2 = await person({ givenName: "Lotte", familyName: sn2, gender: "FEMALE", birthDate: "1830-05-01" });
    const x2 = await person({ givenName: "Lotte", familyName: sn2, gender: "FEMALE", birthDate: "1830-05-01" });
    for (const [par, ch] of [[father, k2], [n1, k2], [father, x2], [n2, x2]]) await parentOf(par, ch);
    const p2 = await previewPersonMerge(editor, k2, x2);
    expect(p2.blockers[0]).toMatchObject({ code: "BIO_PARENTS", resolvable: true });
    await expectCode(mergePersons(editor, { keepId: k2, mergeId: x2, parentsFirst: [{ keepId: n1, mergeId: n2 }] }), "FORBIDDEN");
    for (const id of [k2, x2, n1, n2]) expect(await exists(id)).toBe(true);
    expect(await prisma.personRedirect.count({ where: { fromId: { in: [x2, n2] } } })).toBe(0);

    // (3) Schwacher Treffer bei den Vätern (nur der erste Vorname gleich — eher Brüder):
    //     Die Sperre nennt das Paar zum Prüfen, aber nie den Weg in einem Schritt.
    const sn3 = randomSurname();
    const v1 = await person({ givenName: "Johann Karl", familyName: sn3, gender: "MALE", birthDate: "1800" });
    const v2 = await person({ givenName: "Johann Peter", familyName: sn3, gender: "MALE", birthDate: "1801" });
    const k3 = await person({ givenName: "Lotte", familyName: sn3, gender: "FEMALE", birthDate: "1830-05-01" });
    const x3 = await person({ givenName: "Lotte", familyName: sn3, gender: "FEMALE", birthDate: "1830-05-01" });
    const o1 = await person({ givenName: "Regina", familyName: sn3, gender: "FEMALE", birthDate: "1802-02-02" });
    const o2 = await person({ givenName: "Regina", familyName: sn3, gender: "FEMALE", birthDate: "1802-02-02" });
    for (const [par, ch] of [[v1, k3], [o1, k3], [v2, x3], [o2, x3]]) await parentOf(par, ch);
    const p3 = await previewPersonMerge(admin, k3, x3);
    expect(p3.blockers[0]).toMatchObject({ code: "BIO_PARENTS", resolvable: false });
    expect(p3.blockers[0].suggestPairs).toHaveLength(2);
    await expectCode(mergePersons(admin, { keepId: k3, mergeId: x3, parentsFirst: [{ keepId: o1, mergeId: o2 }, { keepId: v1, mergeId: v2 }] }), "CONFLICT");
    for (const id of [k3, x3, v1, v2, o1, o2]) expect(await exists(id)).toBe(true);
  });
});
