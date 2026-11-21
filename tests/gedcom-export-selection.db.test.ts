/**
 * GEDCOM-Export mit Familienauswahl (Dialog auf /admin/data) gegen die
 * Mock-Datenbank: nur Personen der gewählten Familien, Beziehungen nur
 * zwischen ihnen, Quellen/Belege/Ereignisse/Namen/Bilder nur an
 * Exportiertem, keine hängenden Verweise, gültiges GEDCOM 5.5.1 (Rundreise
 * wie `npm run gedcom:check`), Rechte. Überspringt sich ohne Datenbank.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { buildExport } from "@/lib/services/exchange-export";
import { buildGedcomExport, buildGedcomZip } from "@/lib/services/gedcom-export";
import { exportFamilyOverview, parseExportSelection } from "@/lib/services/export-selection";
import { countSelection, selectionFileSuffix, selectionQuery, type ExportSelection } from "@/lib/export-selection";
import { parseGedcom } from "@/lib/gedcom";
import { checkGedcom } from "@/lib/gedcom/cli";
import JSZip from "jszip";

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
if (skipReason) console.warn(`\n[tests] GEDCOM-Auswahl-Tests übersprungen: ${skipReason}\n`);

const A = "mock-family-a";
const B = "mock-family-b";
const C = "mock-family-c";
const D = "mock-family-d";

/** Alle Zeiger (@X@ als Wert) verweisen auf vorhandene Datensätze (wie e2e/write/gedcom-import.spec.ts). */
function danglingPointers(text: string): string[] {
  const defined = new Set<string>();
  const used = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const def = /^0 (@[^@]+@) /.exec(line);
    if (def) defined.add(def[1]);
    const ptr = /^[1-9]\d* \S+ (@[^@#]+@)\s*$/.exec(line);
    if (ptr) used.add(ptr[1]);
  }
  return [...used].filter((x) => !defined.has(x));
}

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

const params = (q: Record<string, string>) => new URLSearchParams(q);

describe.skipIf(Boolean(skipReason))("GEDCOM-Export mit Familienauswahl (Testdatenbank)", () => {
  let admin: Scope;
  let editor: Scope; // A bearbeiten, B lesen
  let viewer: Scope; // A lesen
  let nofamily: Scope;

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    nofamily = await scope("nofamily@example.test");
  });

  /** Erwartete Personen einer Auswahl, direkt aus der Datenbank. */
  async function expectedPersons(sel: ExportSelection, visibleFamilies: string[] | null): Promise<Set<string>> {
    const rows = await prisma.person.findMany({ select: { id: true, families: { select: { familyId: true } } } });
    return new Set(
      rows
        .filter((p) => {
          const fams = p.families.map((f) => f.familyId);
          if (visibleFamilies && !fams.some((f) => visibleFamilies.includes(f))) return false;
          return fams.some((f) => sel.familyIds.includes(f)) || (sel.withoutFamily && fams.length === 0);
        })
        .map((p) => p.id),
    );
  }

  it("Austauschdaten: nur Personen der Auswahl, alles Weitere nur an Exportiertem", async () => {
    for (const sel of [
      { familyIds: [D], withoutFamily: false },
      { familyIds: [A], withoutFamily: false },
      { familyIds: [B, C], withoutFamily: true },
      { familyIds: [], withoutFamily: true },
    ]) {
      const { data, keyByFileName } = await buildExport(admin, sel);
      const ids = new Set(data.persons.map((p) => p.id));
      expect(ids, JSON.stringify(sel)).toEqual(await expectedPersons(sel, null));
      // Beziehungen: genau die zwischen exportierten Personen.
      const rels = await prisma.relationship.findMany({ select: { id: true, fromPersonId: true, toPersonId: true } });
      const relIds = new Set(rels.filter((r) => ids.has(r.fromPersonId) && ids.has(r.toPersonId)).map((r) => r.id));
      expect(new Set(data.relationships.map((r) => r.id))).toEqual(relIds);
      // Belege, Ereignisse, Namen nur an Exportiertem; Quellen nur die zitierten.
      for (const c of data.citations) expect(ids.has(c.personId ?? "") || relIds.has(c.relationshipId ?? "")).toBe(true);
      for (const e of data.events) expect(ids.has(e.personId ?? "") || relIds.has(e.relationshipId ?? "")).toBe(true);
      for (const n of data.personNames) expect(ids.has(n.personId)).toBe(true);
      expect(new Set(data.sources.map((s) => s.id))).toEqual(new Set(data.citations.map((c) => c.sourceId)));
      // Bilder nur an exportierten Personen, Beziehungen, Quellen.
      const used = new Set([
        ...data.persons.flatMap((p) => p.media.map((m) => m.mediaId)),
        ...data.relationships.flatMap((r) => (r.media ?? []).map((m) => m.mediaId)),
        ...data.sources.map((s) => s.mediaId).filter(Boolean),
      ]);
      for (const m of data.media) expect(used.has(m.id)).toBe(true);
      expect(keyByFileName.size).toBe(data.media.length);
    }
  });

  it("eine Person mit mehreren Familien ist dabei, sobald eine davon gewählt ist", async () => {
    const both = await prisma.person.findFirst({
      where: { AND: [{ families: { some: { familyId: A } } }, { families: { some: { familyId: B } } }] },
      select: { id: true },
    });
    expect(both).toBeTruthy();
    for (const fam of [A, B]) {
      const { data } = await buildExport(admin, { familyIds: [fam], withoutFamily: false });
      expect(data.persons.map((p) => p.id)).toContain(both!.id);
    }
    const { data } = await buildExport(admin, { familyIds: [C], withoutFamily: false });
    expect(data.persons.map((p) => p.id)).not.toContain(both!.id);
  });

  it("GEDCOM und ZIP: gültig, Rundreise verlustfrei, keine hängenden Verweise, Personenzahl wie im Dialog", async () => {
    const overview = await exportFamilyOverview(admin);
    for (const sel of [
      { familyIds: [D], withoutFamily: false },
      { familyIds: [A, C], withoutFamily: false },
      { familyIds: [], withoutFamily: true },
    ]) {
      const g = await buildGedcomExport(admin, { selection: sel });
      const parsed = parseGedcom(g.bytes);
      expect(parsed.document.persons).toHaveLength((await expectedPersons(sel, null)).size);
      expect(parsed.document.persons).toHaveLength(countSelection(overview, sel.familyIds, sel.withoutFamily));
      expect(parsed.document.header.majorVersion ?? 5).toBe(5);
      expect(g.text).toMatch(/^0 HEAD[\s\S]*1 GEDC\r?\n2 VERS 5\.5\.1/);
      expect(danglingPointers(g.text), JSON.stringify(sel)).toEqual([]);
      expect(parsed.warnings.filter((w) => w.code === "DANGLING_POINTER")).toEqual([]);
      // Prüfprogramm wie `npm run gedcom:check`: Rundreise ohne Verlust.
      const report = checkGedcom(g.bytes, "auswahl.ged");
      expect(report.roundTrip.equalRecords).toBe(true);
      expect(report.roundTrip.lost).toBe(0);
      expect(report.diagnosticList.filter((d) => d.severity === "error")).toEqual([]);
      expect(g.fileName).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}_auswahl-.*\.ged$/);
    }
    // ZIP: .ged und nur die Bilder der Auswahl, jedes in der .ged verknüpft.
    const z = await buildGedcomZip(admin, { familyIds: [A], withoutFamily: false });
    expect(z.fileName).toMatch(/_auswahl-1-familie\.zip$/);
    const zip = await JSZip.loadAsync(z.buffer);
    const text = await zip.file("stammbaum.ged")!.async("string");
    expect(danglingPointers(text)).toEqual([]);
    for (const f of Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith("media/"))) expect(text).toContain(`FILE ${f.name}`);
    // Bilddateien der Auswahl (die Testumgebung hat keinen Medienordner — daher
    // die Zuordnung statt der Dateien im Archiv): weniger als im Gesamtexport,
    // und jede ist in der .ged verknüpft.
    const part = await buildGedcomExport(admin, { selection: { familyIds: [A], withoutFamily: false } });
    const whole = await buildGedcomExport(admin);
    expect(part.mediaFiles.size).toBeGreaterThan(0);
    expect(part.mediaFiles.size).toBeLessThan(whole.mediaFiles.size);
    for (const name of part.mediaFiles.keys()) expect(part.text).toContain(`FILE media/${name}`);
  });

  it("ohne Auswahl bleibt der Export unverändert (alles Sichtbare, auch unbelegte Quellen)", async () => {
    expect(await parseExportSelection(admin, params({ format: "gedcom" }))).toBeNull();
    const all = await buildGedcomExport(admin);
    expect(all.fileName).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}\.ged$/);
    const allFamilies = await buildGedcomExport(admin, { selection: { familyIds: [A, B, C, D], withoutFamily: true } });
    expect(parseGedcom(allFamilies.bytes).document.persons).toHaveLength(parseGedcom(all.bytes).document.persons.length);
    // Die Auswahl nimmt nur zitierte Quellen mit — die unbelegte Mock-Quelle fehlt dort.
    expect(allFamilies.stats.sources).toBeLessThan(all.stats.sources);
    expect(all.stats.sources).toBe(await prisma.source.count());
  });

  it("Rechte: fremde, unbekannte und „ohne Familie“ abgelehnt — nie mehr als sichtbar", async () => {
    const code = async (s: Scope, q: Record<string, string>) => {
      try {
        await parseExportSelection(s, params(q));
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    // Betrachter von A: B (fremd) und eine erfundene Kennung gleich behandelt.
    expect(await code(viewer, { families: B })).toBe("FORBIDDEN");
    expect(await code(viewer, { families: "gibt-es-nicht" })).toBe("FORBIDDEN");
    expect(await code(viewer, { families: `${A},${C}` })).toBe("FORBIDDEN");
    expect(await code(viewer, { families: A, withoutFamily: "1" })).toBe("FORBIDDEN");
    expect(await code(editor, { withoutFamily: "1" })).toBe("FORBIDDEN");
    expect(await code(nofamily, { families: A })).toBe("FORBIDDEN");
    // Bearbeiter darf die nur lesbare Familie B exportieren (sehen genügt).
    expect(await code(editor, { families: B })).toBe("ok");
    // Administrator: unbekannte Kennung ist ein Eingabefehler; leere Auswahl ebenso.
    expect(await code(admin, { families: "gibt-es-nicht" })).toBe("VALIDATION");
    expect(await code(admin, { families: "" })).toBe("VALIDATION");
    expect(await code(admin, { withoutFamily: "0" })).toBe("VALIDATION");

    // Betrachter: Auswahl A = alles, was er sieht — nie Personen ohne Familie oder aus C/D.
    const sel = (await parseExportSelection(viewer, params({ families: A })))!;
    const { data } = await buildExport(viewer, sel);
    expect(new Set(data.persons.map((p) => p.id))).toEqual(await expectedPersons(sel, [A]));
    const full = await buildExport(viewer);
    expect(data.persons.length).toBe(full.data.persons.length);
  });

  it("Dialog-Übersicht: nur eigene Familien, Zahlen passen zum Export, keine fremden Familien in den Gruppen", async () => {
    const ov = await exportFamilyOverview(editor);
    expect(ov.families.map((f) => f.id).sort()).toEqual([A, B]);
    expect(ov.withoutFamily).toBeNull();
    for (const g of ov.groups) for (const id of g.familyIds) expect([A, B]).toContain(id);
    for (const fams of [[A], [B], [A, B]]) {
      const { data } = await buildExport(editor, { familyIds: fams, withoutFamily: false });
      expect(countSelection(ov, fams, false), fams.join("+")).toBe(data.persons.length);
    }
    const adminOv = await exportFamilyOverview(admin);
    expect(adminOv.withoutFamily).toBe(await prisma.person.count({ where: { families: { none: {} } } }));
    expect(countSelection(adminOv, [A, B, C, D], true)).toBe(await prisma.person.count());
    expect((await exportFamilyOverview(nofamily)).families).toEqual([]);
  });

  it("Dateiname und Suchparameter verraten keine Familiennamen", () => {
    expect(selectionFileSuffix(null)).toBe("");
    expect(selectionFileSuffix({ familyIds: [A], withoutFamily: false })).toBe("_auswahl-1-familie");
    expect(selectionFileSuffix({ familyIds: [A, B], withoutFamily: true })).toBe("_auswahl-2-familien-und-ohne-familie");
    expect(selectionFileSuffix({ familyIds: [], withoutFamily: true })).toBe("_auswahl-ohne-familie");
    expect(selectionQuery({ familyIds: [A, B], withoutFamily: true })).toBe(`&families=${encodeURIComponent(`${A},${B}`)}&withoutFamily=1`);
  });
});
