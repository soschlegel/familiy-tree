/**
 * GEDCOM-Export „Ab einer Person“ (Dialog auf /admin/data) gegen die
 * Mock-Datenbank: genau die erwarteten Personen, Beziehungen nur zwischen
 * ihnen, keine hängenden Verweise, gültiges GEDCOM 5.5.1 (Rundreise wie
 * `npm run gedcom:check`), eingeschränkter Benutzer (gesperrte Vorfahren
 * beenden die Linie), ZIP nur mit Bildern Exportierter, Rechte der Anfrage.
 * Überspringt sich ohne Datenbank.
 */
import { describe, expect, it, beforeAll } from "vitest";
import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import type { Scope } from "@/lib/scope";
import { scopeForEmail } from "@/lib/services";
import { buildExport } from "@/lib/services/exchange-export";
import { buildGedcomExport, buildGedcomZip } from "@/lib/services/gedcom-export";
import { exportLineageCount, parseExportRequest } from "@/lib/services/export-selection";
import { isPersonSelection, personSelectionParams, type PersonExportSelection } from "@/lib/export-selection";
import { DEFAULT_LINEAGE_OPTIONS, type LineageOptions } from "@/lib/export-lineage";
import { parseGedcom } from "@/lib/gedcom";
import { checkGedcom } from "@/lib/gedcom/cli";
import { generateMockData } from "../prisma/mock-data";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] GEDCOM-Export „Ab einer Person“ übersprungen: ${skipReason}\n`);

const L = generateMockData().landmarks;

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

async function select(s: Scope, personId: string, opts: Partial<LineageOptions> = {}): Promise<PersonExportSelection> {
  const sel = await parseExportRequest(s, new URLSearchParams(personSelectionParams(personId, { ...DEFAULT_LINEAGE_OPTIONS, ...opts })));
  if (!isPersonSelection(sel)) throw new Error("keine Personenauswahl");
  return sel;
}

describe.skipIf(Boolean(skipReason))("GEDCOM-Export „Ab einer Person“ (Testdatenbank)", () => {
  let admin: Scope;
  let editor: Scope; // A bearbeiten, B lesen
  let viewer: Scope; // A lesen
  let rels: { type: string; subtype: string; fromPersonId: string; toPersonId: string; id: string }[];
  let familiesOf: Map<string, string[]>;

  beforeAll(async () => {
    admin = await scope("admin@example.test");
    editor = await scope("editor@example.test");
    viewer = await scope("viewer@example.test");
    rels = await prisma.relationship.findMany({ select: { id: true, type: true, subtype: true, fromPersonId: true, toPersonId: true } });
    familiesOf = new Map();
    for (const m of await prisma.personFamily.findMany({ select: { personId: true, familyId: true } })) {
      familiesOf.set(m.personId, [...(familiesOf.get(m.personId) ?? []), m.familyId]);
    }
  });

  /** Unabhängig gerechnet: leibliche Vorfahren über sichtbare Personen. */
  function bioAncestors(start: string, visible: (id: string) => boolean): Set<string> {
    const out = new Set([start]);
    const todo = [start];
    while (todo.length) {
      const id = todo.pop()!;
      for (const r of rels) {
        if (r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.toPersonId === id && visible(r.fromPersonId) && !out.has(r.fromPersonId)) {
          out.add(r.fromPersonId);
          todo.push(r.fromPersonId);
        }
      }
    }
    return out;
  }

  const seesFamilies = (fams: string[]) => (id: string) => (familiesOf.get(id) ?? []).some((f) => fams.includes(f));

  it("nur Vorfahren: genau Person und leibliche Vorfahren (Administrator)", async () => {
    const sel = await select(admin, L.selfEditor);
    const expected = bioAncestors(L.selfEditor, () => true);
    expect(new Set(sel.personIds)).toEqual(expected);
    expect(sel.counts.total).toBe(expected.size);
    expect(sel.counts.ancestors).toBeGreaterThanOrEqual(6); // alle vier Großeltern und Eltern
  });

  it("GEDCOM je Kästchen: genau die Personen der Auswahl, Beziehungen nur zwischen ihnen, gültig ohne offene Zeiger", async () => {
    for (const opts of [
      {},
      { partners: true },
      { siblings: true },
      { siblings: true, siblingFamilies: true },
      { descendants: true, partners: true },
      { allParents: true },
      { partners: true, siblings: true, siblingFamilies: true, descendants: true, allParents: true },
      { generations: 2 },
    ] as Partial<LineageOptions>[]) {
      const sel = await select(admin, L.selfEditor, opts);
      const ids = new Set(sel.personIds);
      const { data } = await buildExport(admin, sel);
      expect(new Set(data.persons.map((p) => p.id)), JSON.stringify(opts)).toEqual(ids);
      const relIds = new Set(rels.filter((r) => ids.has(r.fromPersonId) && ids.has(r.toPersonId)).map((r) => r.id));
      expect(new Set(data.relationships.map((r) => r.id))).toEqual(relIds);
      for (const c of data.citations) expect(ids.has(c.personId ?? "") || relIds.has(c.relationshipId ?? "")).toBe(true);
      for (const e of data.events) expect(ids.has(e.personId ?? "") || relIds.has(e.relationshipId ?? "")).toBe(true);
      expect(new Set(data.sources.map((s) => s.id))).toEqual(new Set(data.citations.map((c) => c.sourceId)));

      const g = await buildGedcomExport(admin, { selection: sel });
      const parsed = parseGedcom(g.bytes);
      expect(parsed.document.persons).toHaveLength(ids.size);
      expect(danglingPointers(g.text), JSON.stringify(opts)).toEqual([]);
      expect(parsed.warnings.filter((w) => w.code === "DANGLING_POINTER")).toEqual([]);
      // Keine verwaiste Familie: jede FAM hat mindestens zwei Mitglieder.
      for (const f of parsed.document.families) expect(f.partners.length + f.children.length, f.id).toBeGreaterThanOrEqual(2);
      const report = checkGedcom(g.bytes, "person.ged");
      expect(report.roundTrip.equalRecords).toBe(true);
      expect(report.roundTrip.lost).toBe(0);
      expect(report.diagnosticList.filter((d) => d.severity === "error")).toEqual([]);
      expect(g.fileName).toMatch(new RegExp(`^stammbaum_\\d{4}-\\d{2}-\\d{2}_auswahl-ab-person-${ids.size}-personen\\.ged$`));
      // Zahl im Dialog = Personen in der Datei.
      expect((await exportLineageCount(admin, new URLSearchParams(personSelectionParams(L.selfEditor, { ...DEFAULT_LINEAGE_OPTIONS, ...opts })))).total).toBe(ids.size);
    }
  });

  it("Kästchen erweitern die Menge, „nur Vorfahren“ ist in jeder enthalten", async () => {
    const base = new Set((await select(admin, L.selfEditor)).personIds);
    const all = await select(admin, L.selfEditor, { partners: true, siblings: true, siblingFamilies: true, descendants: true, allParents: true });
    for (const id of base) expect(all.personIds).toContain(id);
    expect(all.personIds.length).toBeGreaterThan(base.size);
    // Ohne „Geschwister“ wirkt „Partner und Kinder der Geschwister“ nicht.
    expect((await select(admin, L.selfEditor, { siblingFamilies: true })).personIds.length).toBe(base.size);
  });

  it("eingeschränkter Benutzer: nur Sichtbares, gesperrte Vorfahren beenden die Linie", async () => {
    const visible = seesFamilies(["mock-family-a", "mock-family-b"]);
    const sel = await select(editor, L.selfEditor);
    expect(new Set(sel.personIds)).toEqual(bioAncestors(L.selfEditor, visible));
    const adminSel = await select(admin, L.selfEditor);
    expect(sel.personIds.length).toBeLessThan(adminSel.personIds.length);
    for (const id of sel.personIds) expect(visible(id)).toBe(true);

    // Tante nur in D (gesperrt), Cousine nur in B (sichtbar): für den
    // Bearbeiter nur über die Gesperrte erreichbar — sie fehlt.
    const wide = { siblings: true, siblingFamilies: true, partners: true };
    const adminWide = await select(admin, L.selfEditor, wide);
    expect(adminWide.personIds).toContain(L.kinshipHidden.cousin);
    const editorWide = await select(editor, L.selfEditor, wide);
    expect(editorWide.personIds).not.toContain(L.kinshipHidden.aunt);
    expect(editorWide.personIds).not.toContain(L.kinshipHidden.cousin);
    for (const id of editorWide.personIds) expect(visible(id)).toBe(true);

    const g = await buildGedcomExport(editor, { selection: editorWide });
    expect(parseGedcom(g.bytes).document.persons).toHaveLength(editorWide.personIds.length);
    expect(danglingPointers(g.text)).toEqual([]);
  });

  it("ZIP: nur Bilder exportierter Datensätze, jedes in der .ged verknüpft", async () => {
    const sel = await select(admin, L.selfEditor, { partners: true, siblings: true, descendants: true });
    const z = await buildGedcomZip(admin, sel);
    expect(z.fileName).toMatch(/_auswahl-ab-person-\d+-personen\.zip$/);
    const zip = await JSZip.loadAsync(z.buffer);
    const text = await zip.file("stammbaum.ged")!.async("string");
    expect(danglingPointers(text)).toEqual([]);
    for (const f of Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith("media/"))) expect(text).toContain(`FILE ${f.name}`);

    const { data } = await buildExport(admin, sel);
    const used = new Set([
      ...data.persons.flatMap((p) => p.media.map((m) => m.mediaId)),
      ...data.relationships.flatMap((r) => (r.media ?? []).map((m) => m.mediaId)),
      ...data.sources.flatMap((s) => [s.mediaId, ...(s.media ?? []).map((m) => m.mediaId)]).filter(Boolean),
      ...data.events.flatMap((e) => (e.media ?? []).map((m) => m.mediaId)),
      ...data.citations.flatMap((c) => (c.media ?? []).map((m) => m.mediaId)),
    ]);
    for (const m of data.media) expect(used.has(m.id)).toBe(true);
    const part = await buildGedcomExport(admin, { selection: sel });
    const whole = await buildGedcomExport(admin);
    expect(part.mediaFiles.size).toBeLessThan(whole.mediaFiles.size);
    for (const name of part.mediaFiles.keys()) expect(part.text).toContain(`FILE media/${name}`);
  });

  it("Rechte und Eingaben: gesperrt wie unbekannt (404), Mischungen und falsche Zahlen abgelehnt", async () => {
    const code = async (s: Scope, q: string) => {
      try {
        await parseExportRequest(s, new URLSearchParams(q));
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    const onlyD = [...familiesOf].find(([, f]) => f.length === 1 && f[0] === "mock-family-d")![0];
    expect(await code(viewer, `person=${onlyD}`)).toBe("NOT_FOUND");
    expect(await code(viewer, "person=gibt-es-nicht")).toBe("NOT_FOUND");
    expect(await code(admin, "person=gibt-es-nicht")).toBe("NOT_FOUND");
    expect(await code(admin, "person=")).toBe("VALIDATION");
    expect(await code(admin, `person=${L.selfEditor}&families=mock-family-a`)).toBe("VALIDATION");
    expect(await code(admin, `person=${L.selfEditor}&generations=0`)).toBe("VALIDATION");
    expect(await code(viewer, `person=${L.selfEditor}`)).toBe("ok");
    // Nur Zahlen, keine Kennungen.
    const counts = await exportLineageCount(viewer, new URLSearchParams(`person=${L.selfEditor}&partners=1`));
    expect(Object.keys(counts).sort()).toEqual(["ancestors", "descendants", "partners", "person", "siblingFamilies", "siblings", "total"]);
  });
});
