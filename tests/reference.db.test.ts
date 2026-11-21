/**
 * Bezugsperson gegen die Testdatenbank: „Das bin ich“ setzen (nur sichtbare
 * Personen), Auflösung aus Adresse/Cookie/eigener Person, keine
 * Durchsickerung über gesperrte Personen, und dass „ich“ beim Zusammenführen
 * (einzeln und gesammelt) auf die bleibende Person wandert. Legt eigene,
 * erfundene Personen und einen eigenen Benutzer an und räumt auf.
 * Überspringt sich ohne Datenbank.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import {
  bulkMerge,
  createPerson,
  createRelationship,
  deletePerson,
  loadGraph,
  mergePersons,
  scopeForEmail,
  ServiceError,
} from "@/lib/services";
import { referenceView, resolveReference, setSelfPerson } from "@/lib/services/reference";
import { mockData } from "./helpers";

async function dbReady(): Promise<string | null> {
  try {
    const admin = await Promise.race([
      prisma.user.findUnique({ where: { id: "mock-user-admin" } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung")), 5000)),
    ]);
    return admin ? null : "Testdatenbank ist leer — bitte `npm run mock:setup` ausführen.";
  } catch (err) {
    return `Testdatenbank nicht erreichbar (${(err as Error).message.split("\n").pop()}).`;
  }
}
const skipReason = await dbReady();
if (skipReason) console.warn(`\n[tests] Bezugsperson-Tests übersprungen: ${skipReason}\n`);

const FAMILY_A = "mock-family-a";
const FAMILY_D = "mock-family-d";

describe.skipIf(Boolean(skipReason))("Bezugsperson (Testdatenbank)", () => {
  const tag = randomUUID().slice(0, 8);
  const email = `bezug-${tag}@example.test`;
  let admin: Scope;
  let viewer: Scope;
  const created: string[] = [];

  const person = async (givenName: string, familyIds: string[], extra: Record<string, unknown> = {}) => {
    const p = await createPerson(admin, { givenName, familyName: `Bezugprobe${tag}`, familyIds, ...extra });
    created.push(p.id);
    return p.id;
  };

  beforeAll(async () => {
    admin = (await scopeForEmail("admin@example.test"))!;
    const user = await prisma.user.create({
      data: { email, name: "Bezug Probe", role: "VIEWER", status: "ACTIVE", families: { create: { familyId: FAMILY_A, role: "VIEWER" } } },
    });
    viewer = (await scopeForEmail(email))!;
    expect(viewer.userId).toBe(user.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const left = await prisma.person.findMany({ where: { id: { in: created } }, select: { id: true } });
    for (const p of left) await deletePerson(admin, p.id, { force: true });
  });

  it("„Das bin ich“: nur sichtbare Personen; gesperrte sind „nicht gefunden“", async () => {
    const own = await person("Eigen", [FAMILY_A]);
    const hidden = await person("Fremd", [FAMILY_D]);

    await expect(setSelfPerson(viewer, hidden)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === "NOT_FOUND",
    );
    await setSelfPerson(viewer, own);
    expect((await prisma.user.findUnique({ where: { email } }))?.personId).toBe(own);

    // Auflösung: Adresse vor Cookie vor eigener Person; Gesperrtes fällt still weg.
    expect(await resolveReference(viewer, {})).toMatchObject({ id: own, source: "self", selfId: own });
    expect(await resolveReference(viewer, { param: hidden })).toMatchObject({ id: own, source: "self" });
    expect(await resolveReference(viewer, { cookie: hidden })).toMatchObject({ id: own, source: "self" });
    expect(await resolveReference(viewer, { param: "gibt-es-nicht" })).toMatchObject({ id: own });

    const other = mockData().landmarks.founders.A;
    expect(await resolveReference(viewer, { param: other })).toMatchObject({ id: other, source: "param" });
    expect(await resolveReference(viewer, { cookie: other })).toMatchObject({ id: other, source: "cookie" });
    // „ich“ übergeht ein gemerktes Cookie.
    expect(await resolveReference(viewer, { param: "ich", cookie: other })).toMatchObject({ id: own, source: "self" });

    // Verliert der Benutzer die Sicht auf seine Person, gilt sie als nicht gesetzt.
    await prisma.personFamily.deleteMany({ where: { personId: own } });
    await prisma.personFamily.create({ data: { personId: own, familyId: FAMILY_D } });
    expect(await resolveReference(viewer, {})).toEqual({ id: null, source: null, selfId: null });
    await prisma.personFamily.deleteMany({ where: { personId: own } });
    await prisma.personFamily.create({ data: { personId: own, familyId: FAMILY_A } });

    await setSelfPerson(viewer, null);
    expect((await prisma.user.findUnique({ where: { email } }))?.personId).toBeNull();
  });

  it("keine Durchsickerung: kein Weg und keine Angabe über gesperrte Personen", async () => {
    // Großvater (A) → Vater (nur D, für den Betrachter gesperrt) → Enkel (A).
    const grandpa = await person("Opa", [FAMILY_A], { gender: "MALE" });
    const father = await person("Vater", [FAMILY_D], { gender: "MALE" });
    const child = await person("Enkel", [FAMILY_A], { gender: "MALE" });
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: grandpa, toPersonId: father });
    await createRelationship(admin, { type: "PARENT_OF", fromPersonId: father, toPersonId: child });

    // Admin sieht alles: Enkel, Linie über den Vater.
    const adminGraph = await loadGraph(admin);
    const asAdmin = referenceView(adminGraph, { id: child, source: "param", selfId: null })!;
    expect(asAdmin.relatives[grandpa]).toEqual({ term: "Großvater väterlicherseits", lines: ["FF"] });
    expect(asAdmin.relatives[father]?.term).toBe("Vater");
    expect(asAdmin.grandparents.FF?.id).toBe(grandpa);

    // Betrachter: der Vater ist gesperrt — der Großvater bleibt ohne Angabe,
    // keine Linie, keine Großeltern in der Legende, nichts über den Vater.
    const viewerGraph = await loadGraph(viewer);
    const asViewer = referenceView(viewerGraph, { id: child, source: "param", selfId: null })!;
    expect(asViewer.relatives[grandpa]).toBeUndefined();
    expect(asViewer.relatives[father]).toBeUndefined();
    expect(Object.values(asViewer.grandparents).every((g) => g === null)).toBe(true);
    for (const id of Object.keys(asViewer.relatives)) {
      expect(viewerGraph.persons.get(id)?.visible).toBe(true);
    }
    // Eine gesperrte Person ist nie Bezugsperson.
    expect(referenceView(viewerGraph, { id: father, source: "param", selfId: null })).toBeNull();
  });

  it("Mock-Daten: für den Betrachter nur sichtbare Personen, keine aus fremden Familien", async () => {
    const lm = mockData().landmarks;
    const graph = await loadGraph(viewer);
    const view = referenceView(graph, { id: lm.crossMarriedPartnerA, source: "param", selfId: null })!;
    expect(view.relatives[lm.crossMarriedIntoA]?.term).toMatch(/^Ehe(frau|mann)$/);
    expect(view.relatives[lm.inLawOnlyB]).toBeUndefined();
    const hidden = [...graph.persons.values()].filter((p) => !p.visible).map((p) => p.id);
    expect(hidden.length).toBeGreaterThan(0);
    for (const id of hidden) expect(view.relatives[id]).toBeUndefined();

    // Admin sieht den Elternteil aus Familie B als Schwiegerelternteil.
    const full = referenceView(await loadGraph(admin), { id: lm.crossMarriedPartnerA, source: "param", selfId: null })!;
    expect(full.relatives[lm.inLawOnlyB]?.term).toMatch(/^Schwieger/);
  });

  it("Zusammenführen: „ich“ wandert auf die bleibende Person (einzeln und gesammelt); Löschen hebt auf", async () => {
    const twin = { gender: "FEMALE", birthDate: "1901-02-03", deathDate: "1970-04-05" };
    const keep = await person("Zwilling", [FAMILY_A], twin);
    const gone = await person("Zwilling", [FAMILY_A], twin);
    await setSelfPerson(viewer, gone);
    await mergePersons(admin, { keepId: keep, mergeId: gone });
    expect((await prisma.user.findUnique({ where: { email } }))?.personId).toBe(keep);

    // Gesammelt (bulkMerge): wählt die bleibende Person selbst.
    const a = await person("Doppel", [FAMILY_A], twin);
    const b = await person("Doppel", [FAMILY_A], twin);
    await setSelfPerson(viewer, b);
    const result = await bulkMerge(admin, { pairs: [{ a, b }] });
    expect(result.merged).toHaveLength(1);
    const survivor = result.merged[0].keepId;
    expect((await prisma.user.findUnique({ where: { email } }))?.personId).toBe(survivor);

    // Person gelöscht: der Benutzer bleibt, nur ohne eigene Person.
    await deletePerson(admin, survivor, { force: true });
    expect((await prisma.user.findUnique({ where: { email } }))?.personId).toBeNull();
  });
});
