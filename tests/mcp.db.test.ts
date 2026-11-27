/**
 * Integrationstest des MCP-Servers (mcp/server.ts) über stdio mit dem
 * Client des SDK — gegen die Mock-Datenbank.
 *
 * - Admin: alle lesenden Werkzeuge, Prompts, Ressource.
 * - Betrachter: verborgene Personen bleiben verborgen.
 * - Editor mit MCP_ALLOW_WRITE=true: Schreibwerkzeuge samt Audit-Log,
 *   ungenaue Daten, Quellen und Belege. Legt nur eigene, klar benannte
 *   Testpersonen und -quellen an und räumt sie wieder ab.
 * - Start wie mit `npm run -s mcp:stdio`: Handshake und sauberes stdout.
 * - Nur gegen Mock-/Testdatenbanken; KI-Recht des Benutzers (User.aiAccess)
 *   gilt zusätzlich zu MCP_ALLOW_WRITE und wird bei jedem Aufruf neu geprüft.
 *
 * Überspringt sich ohne Mock-Datenbank.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { prisma } from "@/lib/prisma";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVER = path.join(ROOT, "mcp", "server.ts");

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] MCP-Tests übersprungen: ${skipReason}\n`);

const L = mockData().landmarks;
const TIMEOUT = 60_000;

/** Name der Mock-Datenbank, gegen die dieser Testlauf geht (vitest.config.ts setzt DATABASE_URL). */
const MOCK_DB_NAME = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));

function serverEnv(extra: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...extra })) if (v !== undefined) env[k] = v;
  return env;
}

type Session = {
  client: Client;
  errors: Error[];
  stderr: () => string;
  // Werkzeugergebnisse sind frei geformtes JSON; im Test bewusst untypisiert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; data: any; text: string }>;
};

const sessions: Session[] = [];

async function connect(email: string, allowWrite = false): Promise<Session> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX, SERVER],
    cwd: ROOT,
    env: serverEnv({ MCP_USER_EMAIL: email, MCP_ALLOW_WRITE: allowWrite ? "true" : "false" }),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const client = new Client({ name: "vitest", version: "1.0.0" });
  const errors: Error[] = [];
  client.onerror = (err) => errors.push(err);
  await client.connect(transport);

  const session: Session = {
    client,
    errors,
    stderr: () => stderr,
    call: async (name, args = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
        structuredContent?: unknown;
      };
      const text = r.content[0]?.text ?? "";
      const isError = Boolean(r.isError);
      const data = isError ? null : JSON.parse(text);
      if (!isError) expect(r.structuredContent).toEqual(data);
      return { isError, data, text };
    },
  };
  sessions.push(session);
  return session;
}

/** Alle Objekte mit dieser ID irgendwo im Ergebnis. */
function objectsWithId(value: unknown, id: string, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) value.forEach((v) => objectsWithId(v, id, found));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.id === id) found.push(o);
    Object.values(o).forEach((v) => objectsWithId(v, id, found));
  }
  return found;
}

const READ_TOOLS = [
  "check_consistency",
  "find_data_gaps",
  "find_possible_duplicates",
  "get_ancestors",
  "get_descendants",
  "get_kinship",
  "get_person",
  "get_place",
  "get_source",
  "get_statistics",
  "get_timeline",
  "list_duplicate_candidates",
  "list_events",
  "list_families",
  "list_history_areas",
  "list_history_events",
  "list_places",
  "preview_person_merge",
  "search_persons",
  "search_sources",
  "suggest_place",
];
const WRITE_TOOLS = [
  "add_event",
  "assign_place",
  "add_media",
  "add_name_variant",
  "begin_change_set",
  "cite_source",
  "create_person",
  "create_relationship",
  "create_source",
  "delete_event",
  "delete_relationship",
  "set_person_families",
  "update_event",
  "update_person",
  "update_relationship",
  "link_media",
  "review_duplicate",
  "add_history_event",
  "update_history_event",
  "delete_history_event",
  "set_builtin_history_event_hidden",
];

describe.skipIf(Boolean(skipReason))("MCP-Server (stdio, Mock-Datenbank)", () => {
  const createdPersons: string[] = [];
  const createdSources: string[] = [];
  const createdCitations: string[] = [];

  afterAll(async () => {
    for (const s of sessions) await s.client.close().catch(() => {});
    if (skipReason) return;
    await prisma.source.deleteMany({ where: { id: { in: createdSources } } });
    await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...createdPersons, ...createdSources, ...createdCitations] } },
    });
    await prisma.$disconnect();
  });

  it(
    "Admin: lesende Werkzeuge, Prompts und Ressource",
    async () => {
      const s = await connect("admin@example.test");

      const tools = (await s.client.listTools()).tools;
      expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
      for (const t of tools) {
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(t.outputSchema, t.name).toBeDefined();
      }

      // Suche mit Paginierung
      const page = await s.call("search_persons", { query: "Becker", limit: 5 });
      expect(page.data.persons).toHaveLength(5);
      expect(page.data.total).toBeGreaterThan(5);
      expect(page.data.hasMore).toBe(true);
      expect(page.data.persons[0]).toMatchObject({ id: expect.any(String), name: expect.stringContaining("Becker"), lifespan: expect.any(String) });

      // Suche nach Jahrgang und Ort
      const range = await s.call("search_persons", { born_from: 1900, born_to: 1930, place: "Hannover", limit: 100 });
      expect(range.data.total).toBeGreaterThan(0);
      for (const p of range.data.persons) {
        // Lebensspanne beginnt mit dem Geburtsdatum, ggf. mit Zusatz („um 1905 –“).
        const y = Number(p.lifespan.match(/\d{4}/)![0]);
        expect(y >= 1900 && y <= 1930).toBe(true);
      }

      // Person im Detail
      const person = await s.call("get_person", { person_id: L.crossMarriedIntoA });
      expect(person.data.person.id).toBe(L.crossMarriedIntoA);
      // Herkunft: nur, wer die Person bearbeiten darf (hier Admin); Mock-Personen sind von Hand erfasst.
      expect(person.data.origin).toEqual({ manual: true, imports: [] });
      expect(person.data.families.map((f: { id: string }) => f.id).sort()).toEqual(["mock-family-a", "mock-family-b"]);
      expect(person.data.parents.some((p: { id: string; restricted?: boolean }) => p.id === L.inLawOnlyB && !p.restricted)).toBe(true);
      expect(person.data.partners.some((p: { id: string }) => p.id === L.crossMarriedPartnerA)).toBe(true);
      expect(person.data.media.length).toBeGreaterThan(0);
      expect(person.data.person.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(person.data.person.birthDatePrecision).toBe("DAY");
      expect(person.data.person.birthDateQualifier).toBe("EXACT");
      // Belege kompakt: Quelle, Angabe, Fundstelle.
      expect(person.data.citations.some((c: { sourceId: string; fact: string }) => c.sourceId === L.sources.crossFamily && c.fact === "NAME")).toBe(true);

      // Ungenaue Daten: Genauigkeit, Zusatz und deutscher Text im Ergebnis.
      const about = await s.call("get_person", { person_id: L.impreciseDates.about });
      expect(about.data.person.birthDate).toMatch(/^\d{4}$/);
      expect(about.data.person).toMatchObject({ birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT" });
      expect(about.data.person.birthDateText).toMatch(/^um \d{4}$/);
      expect(about.data.person.lifespan).toMatch(/^um \d{4} –/);
      const before = await s.call("get_person", { person_id: L.impreciseDates.before });
      expect(before.data.person.deathDateText).toMatch(/^vor \d{4}$/);

      // Quellen
      const sources = await s.call("search_sources", { limit: 50 });
      expect(sources.data.total).toBe(mockData().sources.length);
      const church = await s.call("search_sources", { query: "Celle", kind: "CHURCH_BOOK" });
      expect(church.data.sources.map((x: { id: string }) => x.id)).toEqual([L.sources.churchBookA]);
      const src = await s.call("get_source", { source_id: L.sources.crossFamily });
      expect(src.data.hiddenCitationCount).toBe(0);
      expect(src.data.citations.some((c: { relationship?: unknown }) => c.relationship)).toBe(true);
      expect(src.data.citations.some((c: { person?: { id: string } }) => c.person?.id === L.inLawOnlyB)).toBe(true);
      const noSource = await s.call("get_source", { source_id: "gibt-es-nicht" });
      expect(noSource.isError).toBe(true);

      const missing = await s.call("get_person", { person_id: "gibt-es-nicht" });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain("nicht gefunden");

      // Vorfahren / Nachfahren
      const anc = await s.call("get_ancestors", { person_id: L.adoptee, generations: 2 });
      expect(anc.data.generations[0]).toMatchObject({ generation: 1, label: "Eltern" });
      expect(anc.data.generations[0].persons).toHaveLength(3);
      expect(anc.data.generations[0].persons.filter((p: { subtype?: string }) => p.subtype === "ADOPTIVE")).toHaveLength(2);

      const desc = await s.call("get_descendants", { person_id: L.founders.A, generations: 3, limit: 5 });
      expect(desc.data.truncated).toBe(true);
      expect(desc.data.total).toBeGreaterThan(5);

      // Verwandtschaft
      const kin = await s.call("get_kinship", { person_id: L.halfSiblings[0], other_person_id: L.halfSiblings[1] });
      expect(kin.data.summary).toMatch(/^Halb/);
      expect(kin.data.blood.half).toBe(true);
      const inLaw = await s.call("get_kinship", { person_id: L.crossMarriedPartnerA, other_person_id: L.inLawOnlyB });
      expect(inLaw.data.summary).toMatch(/^Schwieger/);

      // Familien und Statistik
      const fams = await s.call("list_families");
      expect(fams.data.families).toHaveLength(4);
      const stats = await s.call("get_statistics");
      expect(stats.data.persons.total).toBe(await prisma.person.count());

      // Lücken (nur angefragte Art), Dubletten, Plausibilität
      const gaps = await s.call("find_data_gaps", { kinds: ["missingBirthDate"], limit: 50 });
      expect(Object.keys(gaps.data.items)).toEqual(["missingBirthDate"]);
      // Ungefähre Geburtsdaten zählen nicht als fehlend.
      expect(gaps.data.items.missingBirthDate.some((p: { id: string }) => p.id === L.impreciseDates.about)).toBe(false);
      const unsourced = await s.call("find_data_gaps", { kinds: ["unsourced"], limit: 200 });
      expect(unsourced.data.counts.unsourced).toBeGreaterThan(0);
      expect(unsourced.data.items.unsourced.some((p: { id: string }) => p.id === L.founders.A)).toBe(false);
      for (const id of L.missingBirthDate) {
        expect(gaps.data.items.missingBirthDate.some((p: { id: string }) => p.id === id)).toBe(true);
      }
      expect(gaps.data.counts.missingParents).toBeGreaterThan(0);

      const dups = await s.call("find_possible_duplicates", { min_score: 0, limit: 100 });
      for (const [a, b] of L.duplicates) {
        expect(
          dups.data.candidates.some(
            (c: { a: { id: string }; b: { id: string } }) =>
              [c.a.id, c.b.id].sort().join() === [a, b].sort().join(),
          ),
        ).toBe(true);
      }

      const cons = await s.call("check_consistency", { limit: 3 });
      expect(cons.data.total).toBeGreaterThan(0);
      expect(cons.data.items.length).toBeLessThanOrEqual(3);
      expect(cons.data.items[0]).toMatchObject({ kind: expect.any(String), message: expect.any(String) });

      // Zeitleisten
      const tl = await s.call("get_timeline", { person_id: L.divorced.person });
      expect(tl.data.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["birth", "marriage", "divorce"]));
      expect(tl.data.events[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ftl = await s.call("get_timeline", { family_id: "mock-family-a", limit: 5 });
      expect(ftl.data.events).toHaveLength(5);
      expect(ftl.data.hasMore).toBe(true);
      const both = await s.call("get_timeline", { person_id: L.adoptee, family_id: "mock-family-a" });
      expect(both.isError).toBe(true);

      // Prompts und Ressource
      const prompts = (await s.client.listPrompts()).prompts.map((p) => p.name).sort();
      expect(prompts).toEqual(["orte_zuordnen", "research_person", "review_data_quality", "review_duplicates"]);
      const prompt = await s.client.getPrompt({ name: "research_person", arguments: { person_id: L.adoptee } });
      expect(JSON.stringify(prompt.messages)).toContain(L.adoptee);
      expect(JSON.stringify(prompt.messages)).toContain("citations");
      const res = await s.client.readResource({ uri: `familytree://person/${L.adoptee}` });
      expect(JSON.parse(String((res.contents[0] as { text: string }).text)).person.id).toBe(L.adoptee);

      expect(s.errors).toEqual([]);
      expect(s.stderr()).toContain("Schreibwerkzeuge aus");
    },
    TIMEOUT,
  );

  it(
    "Betrachter: verborgene Personen bleiben verborgen",
    async () => {
      const s = await connect("viewer@example.test");
      // Betrachter dürfen nichts bearbeiten — get_person nennt ihnen keine Herkunft.
      expect((await s.call("get_person", { person_id: L.selfEditor })).data.origin).toBeUndefined();
      expect((await s.client.listTools()).tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);

      const hiddenIds = [L.inLawOnlyB, ...L.noFamily];
      const results = [
        await s.call("get_person", { person_id: L.crossMarriedIntoA }),
        await s.call("get_ancestors", { person_id: L.crossMarriedIntoA, generations: 4 }),
        await s.call("get_timeline", { person_id: L.crossMarriedIntoA }),
        await s.call("get_kinship", { person_id: L.crossMarriedPartnerA, other_person_id: L.crossMarriedIntoA }),
        await s.call("search_persons", { limit: 100 }),
        await s.call("search_persons", { limit: 100, offset: 100 }),
        await s.call("find_data_gaps", { limit: 200 }),
        await s.call("find_possible_duplicates", { min_score: 0, limit: 100 }),
        await s.call("check_consistency", { limit: 200 }),
        await s.call("get_timeline", { family_id: "mock-family-a", limit: 500 }),
        await s.call("get_source", { source_id: L.sources.crossFamily }),
        await s.call("search_sources", { limit: 100 }),
        await s.call("find_data_gaps", { kinds: ["unsourced"], limit: 200 }),
      ];
      for (const r of results) expect(r.isError).toBe(false);

      // Quelle, die in A und B zitiert wird: sichtbar, der Beleg an der Person
      // nur aus B fehlt (nur gezählt).
      const cross = results[10].data;
      expect(cross.hiddenCitationCount).toBe(1);
      expect(objectsWithId(cross, L.inLawOnlyB)).toEqual([]);
      // Quellen nur aus Familie D und unbelegte fremde Quellen: unsichtbar.
      const visibleSources = results[11].data.sources.map((x: { id: string }) => x.id);
      expect(visibleSources).toContain(L.sources.crossFamily);
      expect(visibleSources).not.toContain(L.sources.onlyFamilyD);
      expect(visibleSources).not.toContain(L.sources.uncited);
      const hiddenSource = await s.call("get_source", { source_id: L.sources.onlyFamilyD });
      expect(hiddenSource.isError).toBe(true);
      expect(hiddenSource.text).toContain("nicht gefunden");

      // Der verborgene Elternteil erscheint nur als Platzhalter ...
      const parent = results[0].data.parents.find((p: { id: string }) => p.id === L.inLawOnlyB);
      expect(parent).toMatchObject({ name: "Nicht freigegeben", restricted: true });
      expect(parent.lifespan).toBeUndefined();
      // ... und nirgends mit Angaben.
      for (const r of results) {
        for (const id of hiddenIds) {
          for (const o of objectsWithId(r.data, id)) {
            expect(o.restricted, `${id} in ${r.text.slice(0, 80)}`).toBe(true);
            expect(o.name).toBe("Nicht freigegeben");
          }
        }
      }
      const hiddenNames = hiddenIds
        .map((id) => mockData().persons.find((p) => p.id === id)!)
        .map((p) => `${p.givenName} ${p.familyName}`);
      const allText = results.map((r) => r.text).join("\n");
      for (const name of hiddenNames) expect(allText).not.toContain(name);

      // Direkter Zugriff: nicht gefunden.
      for (const call of [
        s.call("get_person", { person_id: L.inLawOnlyB }),
        s.call("get_kinship", { person_id: L.crossMarriedPartnerA, other_person_id: L.inLawOnlyB }),
        s.call("get_timeline", { person_id: L.biologicalMotherNoFamily }),
        s.call("get_timeline", { family_id: "mock-family-b" }),
      ]) {
        const r = await call;
        expect(r.isError).toBe(true);
        expect(r.text).toContain("nicht gefunden");
      }

      const fams = await s.call("list_families");
      expect(fams.data.families.map((f: { id: string }) => f.id)).toEqual(["mock-family-a"]);
      expect(s.errors).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "Editor mit MCP_ALLOW_WRITE=true: Schreibwerkzeuge mit Audit",
    async () => {
      const startedAt = new Date();
      const s = await connect("editor@example.test", true);
      const tools = (await s.client.listTools()).tools;
      expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
      expect(tools.find((t) => t.name === "delete_relationship")!.annotations?.destructiveHint).toBe(true);
      expect(tools.find((t) => t.name === "create_person")!.annotations?.readOnlyHint).toBe(false);
      expect(tools.some((t) => t.name === "delete_person")).toBe(false);

      const father = await s.call("create_person", {
        given_name: "MCP-Testvater",
        family_name: "Vitest-MCP",
        gender: "MALE",
        birth_date: "um 1950",
        note: "Angelegt vom MCP-Integrationstest",
        source: "tests/mcp.db.test.ts",
      });
      expect(father.isError).toBe(false);
      createdPersons.push(father.data.person.id);
      expect(father.data.person.familyIds).toEqual(["mock-family-a"]);
      // Ungenaue Daten werden in ihrer Genauigkeit gespeichert, ohne Warnung.
      expect(father.data.person).toMatchObject({
        birthDate: "1950",
        birthDatePrecision: "YEAR",
        birthDateQualifier: "ABOUT",
        birthDateText: "um 1950",
      });
      expect(father.data.warnings).toBeUndefined();
      const stored = await prisma.person.findUnique({ where: { id: father.data.person.id } });
      expect(stored).toMatchObject({ birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT" });
      expect(stored!.birthDate!.toISOString()).toBe("1950-01-01T00:00:00.000Z");
      expect(father.data.person.notes).toMatch(/^\[\d{4}-\d{2}-\d{2}, KI-Recherche\] Angelegt vom MCP-Integrationstest \(Quelle: tests\/mcp\.db\.test\.ts\)$/);

      const child = await s.call("create_person", {
        given_name: "MCP-Testkind",
        family_name: "Vitest-MCP",
        gender: "FEMALE",
        birth_date: "1980-05-06",
      });
      createdPersons.push(child.data.person.id);
      expect(child.data.person.birthDate).toBe("1980-05-06");

      // Unlesbares Datum: deutsche Fehlermeldung
      const garbage = await s.call("update_person", { person_id: child.data.person.id, death_date: "irgendwann" });
      expect(garbage.isError).toBe(true);
      expect(garbage.text).toContain("kein erkennbares Datum");

      // Notiz anhängen statt ersetzen
      const upd = await s.call("update_person", {
        person_id: father.data.person.id,
        birth_place: "Celle",
        append_note: "Geburtsort laut Taufregister",
        source: "KB Celle",
      });
      expect(upd.data.person.birthPlace).toBe("Celle");
      expect(upd.data.person.notes).toContain("Angelegt vom MCP-Integrationstest");
      expect(upd.data.person.notes).toContain("Geburtsort laut Taufregister (Quelle: KB Celle)");
      expect(upd.data.changed).toEqual(["birthPlace", "notes"]);

      const nothing = await s.call("update_person", { person_id: father.data.person.id });
      expect(nothing.isError).toBe(true);

      // Beziehung anlegen, ändern, prüfen, löschen
      const rel = await s.call("create_relationship", {
        type: "PARENT_OF",
        from_person_id: father.data.person.id,
        to_person_id: child.data.person.id,
        start_date: "nach 1979",
      });
      expect(rel.data.relationship.subtype).toBe("BIOLOGICAL");
      expect(rel.data.relationship).toMatchObject({ startDate: "1979", startDateQualifier: "AFTER", startDateText: "nach 1979" });
      const kin = await s.call("get_kinship", { person_id: child.data.person.id, other_person_id: father.data.person.id });
      expect(kin.data.summary).toBe("Vater");

      const relUpd = await s.call("update_relationship", {
        relationship_id: rel.data.relationship.id,
        notes: "Vaterschaft laut Geburtsurkunde",
      });
      expect(relUpd.data.relationship.notes).toBe("Vaterschaft laut Geburtsurkunde");

      const cycle = await s.call("create_relationship", {
        type: "PARENT_OF",
        from_person_id: child.data.person.id,
        to_person_id: father.data.person.id,
      });
      expect(cycle.isError).toBe(true);
      expect(cycle.text).toContain("Zyklus");

      // Quelle anlegen und zitieren
      const src = await s.call("create_source", {
        title: "MCP-Testquelle Kirchenbuch",
        kind: "CHURCH_BOOK",
        repository: "Testarchiv",
        call_number: "T 1",
        date: "um 1950",
      });
      expect(src.isError).toBe(false);
      createdSources.push(src.data.source.id);
      expect(src.data.source).toMatchObject({ kind: "CHURCH_BOOK", dateText: "um 1950", callNumber: "T 1" });
      const cite = await s.call("cite_source", {
        source_id: src.data.source.id,
        person_id: father.data.person.id,
        fact: "BIRTH",
        detail: "Taufen 1950, Nr. 7",
        confidence: "HIGH",
      });
      expect(cite.isError).toBe(false);
      createdCitations.push(cite.data.citation.id);
      const citeRel = await s.call("cite_source", {
        source_id: src.data.source.id,
        relationship_id: rel.data.relationship.id,
        fact: "PARENTAGE",
      });
      createdCitations.push(citeRel.data.citation.id);
      // Angabe passt nicht zur Beziehung / Person nur aus B ist nur lesbar
      const wrongFact = await s.call("cite_source", {
        source_id: src.data.source.id,
        relationship_id: rel.data.relationship.id,
        fact: "BIRTH",
      });
      expect(wrongFact.isError).toBe(true);
      const readOnly = await s.call("cite_source", { source_id: src.data.source.id, person_id: L.inLawOnlyB, fact: "BIRTH" });
      expect(readOnly.isError).toBe(true);
      expect(readOnly.text).toContain("Keine Berechtigung");
      const withCitations = await s.call("get_person", { person_id: father.data.person.id });
      expect(withCitations.data.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: src.data.source.id, fact: "BIRTH", detail: "Taufen 1950, Nr. 7", confidence: "HIGH" }),
          expect.objectContaining({ sourceId: src.data.source.id, fact: "PARENTAGE", relationshipId: rel.data.relationship.id }),
        ]),
      );

      const del = await s.call("delete_relationship", { relationship_id: rel.data.relationship.id });
      expect(del.data.deleted).toBe(true);

      // Familien: B ist für den Editor nur lesbar
      const fam = await s.call("set_person_families", {
        person_id: child.data.person.id,
        family_ids: ["mock-family-a"],
      });
      expect(fam.data.familyIds).toEqual(["mock-family-a"]);
      const forbidden = await s.call("set_person_families", {
        person_id: child.data.person.id,
        family_ids: ["mock-family-a", "mock-family-b"],
      });
      expect(forbidden.isError).toBe(true);
      expect(forbidden.text).toContain("Keine Berechtigung");

      // Validierungsfehler kommen als deutsche Meldung zurück
      const invalid = await s.call("update_person", { person_id: child.data.person.id, death_date: "1970-01-01" });
      expect(invalid.isError).toBe(true);
      expect(invalid.text).toContain("Sterbedatum liegt vor dem Geburtsdatum");

      // Audit-Log
      const entries = await prisma.auditLog.findMany({
        where: {
          userId: "mock-user-editor",
          createdAt: { gte: startedAt },
          entityId: { in: [...createdPersons, rel.data.relationship.id] },
        },
      });
      const has = (entityId: string, action: string) =>
        entries.some((e) => e.entityId === entityId && e.action === action);
      expect(has(father.data.person.id, "CREATE")).toBe(true);
      expect(has(father.data.person.id, "UPDATE")).toBe(true);
      expect(has(child.data.person.id, "UPDATE")).toBe(true);
      expect(has(rel.data.relationship.id, "CREATE")).toBe(true);
      expect(has(rel.data.relationship.id, "UPDATE")).toBe(true);
      expect(has(rel.data.relationship.id, "DELETE")).toBe(true);
      const sourceAudit = await prisma.auditLog.findMany({
        where: { userId: "mock-user-editor", createdAt: { gte: startedAt }, entityId: { in: [...createdSources, ...createdCitations] } },
      });
      expect(sourceAudit.some((e) => e.entityType === "Source" && e.action === "CREATE")).toBe(true);
      expect(sourceAudit.filter((e) => e.entityType === "Citation" && e.action === "CREATE")).toHaveLength(2);
      // Jede Änderung ist dem KI-Kanal zugeordnet (lokaler Modus: ohne Schlüssel).
      for (const e of [...entries, ...sourceAudit]) expect(e).toMatchObject({ channel: "MCP", apiTokenId: null });

      // Sofort aufräumen, damit spätere Tests wieder die reinen Mock-Daten sehen.
      await prisma.source.deleteMany({ where: { id: { in: createdSources } } });
      await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...createdPersons, ...createdSources, ...createdCitations, rel.data.relationship.id] } },
      });
      expect(s.errors).toEqual([]);
      expect(s.stderr()).toContain("Schreibwerkzeuge AKTIV");
    },
    TIMEOUT,
  );

  it(
    "Lebensereignisse, weitere Namen, Orte und Belege an Ereignissen",
    async () => {
      const s = await connect("editor@example.test", true);
      const reader = await connect("viewer@example.test");

      // Lesen: Ereignisse und Namen in get_person, list_events, Suche über Ort und Namensvariante.
      const otto = await s.call("get_person", { person_id: L.genealogy.eventsPerson });
      expect(otto.data.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["BAPTISM", "OCCUPATION", "BURIAL"]));
      expect(otto.data.events.find((e: { id: string }) => e.id === L.genealogy.alternativeBirth)).toMatchObject({ type: "BIRTH", alternative: true });
      const list = await reader.call("list_events", { person_id: L.genealogy.eventsPerson });
      expect(list.isError, list.text).toBe(false);
      expect(list.data.events.length).toBe(otto.data.events.length);
      const range = await s.call("list_events", { person_id: (await prisma.event.findUnique({ where: { id: L.genealogy.rangeEvent } }))!.personId });
      expect(range.data.events.find((e: { id: string }) => e.id === L.genealogy.rangeEvent)).toMatchObject({
        dateQualifier: "BETWEEN",
        dateTo: expect.any(String),
        dateText: expect.stringMatching(/^zwischen \d{4} und \d{4}$/),
      });
      const relEvents = await s.call("list_events", { relationship_id: L.genealogy.marriageWithPlace });
      expect(relEvents.data.events.map((e: { type: string }) => e.type)).toContain("ENGAGEMENT");
      const both = await s.call("list_events", {});
      expect(both.isError).toBe(true);
      const admin = await connect("admin@example.test");
      const variant = await admin.call("search_persons", { query: "Wagener" });
      expect(variant.data.persons.map((p: { id: string }) => p.id)).toContain(L.genealogy.namesPerson);

      const gaps = await s.call("find_data_gaps", { kinds: ["partnershipUnknownStatus"], limit: 5 });
      expect(gaps.data.relationshipGaps.counts.partnershipUnknownStatus).toBeGreaterThanOrEqual(1);
      expect(gaps.data.relationshipGaps.items.partnershipUnknownStatus[0]).toMatchObject({
        relationshipId: expect.any(String),
        persons: expect.any(Array),
      });
      expect(gaps.data.items).toEqual({});

      // Schreiben: Person mit Taufe (Bereich), Beruf, Partnerschaft mit Ort, Verlobung, Name, Beleg.
      const p = await s.call("create_person", { given_name: "MCP-Ereignis", family_name: "Vitest-MCP", birth_date: "1850" });
      createdPersons.push(p.data.person.id);
      const partner = await s.call("create_person", { given_name: "MCP-Partnerin", family_name: "Vitest-MCP" });
      createdPersons.push(partner.data.person.id);
      const pid = p.data.person.id as string;

      const baptism = await s.call("add_event", {
        person_id: pid,
        type: "BAPTISM",
        date: "zwischen 1850 und 1851",
        place: "Celle",
        agency: "St. Marien",
      });
      expect(baptism.isError, baptism.text).toBe(false);
      expect(baptism.data.event).toMatchObject({
        type: "BAPTISM",
        title: "Taufe",
        date: "1850",
        dateQualifier: "BETWEEN",
        dateTo: "1851",
        dateText: "zwischen 1850 und 1851",
        place: "Celle",
        agency: "St. Marien",
      });
      const job = await s.call("add_event", { person_id: pid, type: "OCCUPATION", value: "Müller", date: "ab 1875" });
      expect(job.data.event).toMatchObject({ value: "Müller", dateQualifier: "PERIOD", dateText: "ab 1875" });
      const worded = await s.call("add_event", { person_id: pid, type: "CONFIRMATION", date_phrase: "Palmsonntag, Jahr unbekannt" });
      expect(worded.data.event).toMatchObject({ dateText: "Palmsonntag, Jahr unbekannt" });
      expect(worded.data.event.date).toBeUndefined();

      // Hauptangaben nie als normales Ereignis, eigenes Ereignis braucht eine Bezeichnung.
      const mainBirth = await s.call("add_event", { person_id: pid, type: "BIRTH", date: "1851" });
      expect(mainBirth.isError).toBe(true);
      expect(mainBirth.text).toContain("abweichende Zweitangabe");
      const altBirth = await s.call("add_event", { person_id: pid, type: "BIRTH", date: "1851", is_alternative: true });
      expect(altBirth.data.event).toMatchObject({ type: "BIRTH", alternative: true });
      const noLabel = await s.call("add_event", { person_id: pid, type: "CUSTOM" });
      expect(noLabel.isError).toBe(true);
      const garbage = await s.call("add_event", { person_id: pid, type: "CENSUS", date: "irgendwann" });
      expect(garbage.isError).toBe(true);
      expect(garbage.text).toContain("kein erkennbares Datum");

      const upd = await s.call("update_event", { event_id: job.data.event.id, value: "Müllermeister", place: "Celle" });
      expect(upd.data.event).toMatchObject({ value: "Müllermeister", place: "Celle", dateText: "ab 1875" });
      const nothing = await s.call("update_event", { event_id: job.data.event.id });
      expect(nothing.isError).toBe(true);

      const rel = await s.call("create_relationship", {
        type: "PARTNER_OF",
        subtype: "PARTNER_UNKNOWN",
        from_person_id: pid,
        to_person_id: partner.data.person.id,
        start_date: "um 1874",
        start_place: "Hannover",
      });
      expect(rel.data.relationship).toMatchObject({ subtype: "PARTNER_UNKNOWN", startPlace: "Hannover", startDateText: "um 1874" });
      const married = await s.call("update_relationship", { relationship_id: rel.data.relationship.id, subtype: "MARRIED", start_place: "Celle" });
      expect(married.data.relationship).toMatchObject({ subtype: "MARRIED", startPlace: "Celle" });
      const engaged = await s.call("add_event", { relationship_id: rel.data.relationship.id, type: "ENGAGEMENT", date: "1873" });
      expect(engaged.isError, engaged.text).toBe(false);
      const wrongOwner = await s.call("add_event", { person_id: pid, type: "ENGAGEMENT" });
      expect(wrongOwner.isError).toBe(true);

      const name = await s.call("add_name_variant", { person_id: pid, type: "VARIANT", family_name: "Vitest-MKP", notes: "Kirchenbuch" });
      expect(name.data.name).toMatchObject({ type: "VARIANT", name: "Vitest-MKP", typeLabel: "Schreibvariante" });
      const named = await s.call("search_persons", { query: "Vitest-MKP" });
      expect(named.data.persons.map((x: { id: string }) => x.id)).toEqual([pid]);
      const byPlace = await s.call("search_persons", { query: "MCP-Ereignis", place: "St. Marien" });
      expect(byPlace.data.total).toBe(0);
      const byEventPlace = await s.call("search_persons", { query: "MCP-Ereignis", place: "celle" });
      expect(byEventPlace.data.persons.map((x: { id: string }) => x.id)).toEqual([pid]);

      // Beleg an der Taufe
      const src = await s.call("create_source", { title: "MCP-Testquelle Taufbuch", kind: "CHURCH_BOOK" });
      createdSources.push(src.data.source.id);
      const cite = await s.call("cite_source", { source_id: src.data.source.id, event_id: baptism.data.event.id, detail: "Nr. 4" });
      expect(cite.isError, cite.text).toBe(false);
      expect(cite.data.citation).toMatchObject({ eventId: baptism.data.event.id, fact: "EVENT", personId: pid });
      createdCitations.push(cite.data.citation.id);
      const noFact = await s.call("cite_source", { source_id: src.data.source.id, person_id: pid });
      expect(noFact.isError).toBe(true);

      const full = await s.call("get_person", { person_id: pid });
      expect(full.data.person).toMatchObject({ birthDate: "1850" });
      expect(full.data.events.map((e: { type: string }) => e.type)).toEqual(
        expect.arrayContaining(["BAPTISM", "OCCUPATION", "CONFIRMATION", "BIRTH"]),
      );
      expect(full.data.partners[0]).toMatchObject({ startPlace: "Celle", events: [expect.objectContaining({ type: "ENGAGEMENT" })] });
      expect(full.data.otherNames).toEqual([expect.objectContaining({ name: "Vitest-MKP" })]);
      expect(full.data.citations).toEqual([expect.objectContaining({ eventId: baptism.data.event.id, event: "Taufe" })]);
      const source = await s.call("get_source", { source_id: src.data.source.id });
      expect(source.data.citations[0]).toMatchObject({ fact: "EVENT", eventId: baptism.data.event.id, event: "Taufe" });

      // Zeitleiste enthält die Ereignisse, abweichende Angaben nicht.
      const tl = await s.call("get_timeline", { person_id: pid });
      const kinds = tl.data.events.filter((e: { kind: string }) => e.kind === "event").map((e: { eventType: string }) => e.eventType);
      expect(kinds).toEqual(expect.arrayContaining(["BAPTISM", "OCCUPATION"]));
      expect(kinds).not.toContain("BIRTH");

      // Ereignis vor der Geburt → Plausibilitätsprüfung
      const early = await s.call("add_event", { person_id: pid, type: "CENSUS", date: "1840" });
      const issues = await s.call("check_consistency", { person_id: pid, kinds: ["eventBeforeBirth"] });
      expect(issues.data.items[0]).toMatchObject({ kind: "eventBeforeBirth", eventIds: [early.data.event.id] });

      // Löschen: samt Beleg
      const del = await s.call("delete_event", { event_id: baptism.data.event.id });
      expect(del.data).toEqual({ deleted: true, eventId: baptism.data.event.id });
      expect(await prisma.citation.count({ where: { id: cite.data.citation.id } })).toBe(0);
      const again = await s.call("delete_event", { event_id: baptism.data.event.id });
      expect(again.isError).toBe(true);

      // Betrachter (Familie A, KI lesen): sieht die Ereignisse, kann nichts schreiben.
      const seen = await reader.call("list_events", { person_id: pid });
      expect(seen.data.events.every((e: { canEdit: boolean }) => e.canEdit === false)).toBe(true);
      expect((await reader.client.listTools()).tools.map((t) => t.name)).not.toContain("add_event");

      // Audit
      const audit = await prisma.auditLog.findMany({ where: { entityType: "Event", entityId: { in: [baptism.data.event.id, job.data.event.id] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(["CREATE", "CREATE", "DELETE", "UPDATE"]);
      for (const a of audit) expect(a).toMatchObject({ channel: "MCP", userId: "mock-user-editor" });

      await prisma.source.deleteMany({ where: { id: { in: createdSources } } });
      await prisma.person.deleteMany({ where: { id: { in: createdPersons } } });
      const eventIds = [baptism, job, worded, altBirth, engaged, early].map((r) => r.data.event.id as string);
      await prisma.auditLog.deleteMany({
        where: {
          entityId: {
            in: [...createdPersons, ...createdSources, ...createdCitations, ...eventIds, name.data.name.id, rel.data.relationship.id],
          },
        },
      });
      expect(s.errors).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "Start verweigert ohne, mit unbekanntem, gesperrtem und Benutzer ohne KI-Recht",
    () => {
      const expected: [string | undefined, RegExp][] = [
        [undefined, /MCP_USER_EMAIL ist nicht gesetzt/],
        ["niemand@example.test", /\[USER_UNKNOWN\]/],
        ["blocked@example.test", /gesperrt\. \[USER_BLOCKED\]/],
        ["nofamily@example.test", /kein KI-Zugang freigeschaltet\. \[NO_PERMISSION\]/],
      ];
      for (const [email, message] of expected) {
        const r = spawnSync(process.execPath, [TSX, SERVER], {
          cwd: ROOT,
          env: serverEnv({ MCP_USER_EMAIL: email }) as NodeJS.ProcessEnv,
          input: "",
          encoding: "utf8",
          timeout: 30_000,
        });
        expect(r.status, String(email)).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toMatch(message);
      }
    },
    TIMEOUT,
  );

  it(
    "Start verweigert gegen Datenbanken, die nicht auf _mock oder _test enden",
    () => {
      // Port 1: selbst wenn die Prüfung fehlte, gäbe es dort keine Datenbank.
      for (const name of ["familytree", "familytree_mock_backup", "mock"]) {
        const r = spawnSync(process.execPath, [TSX, SERVER], {
          cwd: ROOT,
          env: serverEnv({
            MCP_USER_EMAIL: "admin@example.test",
            DATABASE_URL: `postgresql://familytree:familytree@127.0.0.1:1/${name}`,
          }) as NodeJS.ProcessEnv,
          input: "",
          encoding: "utf8",
          timeout: 30_000,
        });
        expect(r.status, name).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain(`"${name}"`);
        expect(r.stderr).toContain("_mock oder _test");
        expect(r.stderr).not.toContain("nicht erreichbar");
      }
    },
    TIMEOUT,
  );

  it(
    "KI-Recht „lesen“: keine Schreibwerkzeuge, auch mit MCP_ALLOW_WRITE=true",
    async () => {
      const s = await connect("viewer@example.test", true);
      expect((await s.client.listTools()).tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
      expect(s.stderr()).toContain("Schreibwerkzeuge bleiben aus");
      expect((await s.call("get_statistics")).isError).toBe(false);
      expect(s.errors).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "Rechteänderung während der Sitzung wirkt beim nächsten Aufruf",
    async () => {
      const s = await connect("editor@example.test", true);
      try {
        await prisma.user.update({ where: { id: "mock-user-editor" }, data: { aiAccess: "READ" } });
        const write = await s.call("update_person", { person_id: L.crossMarriedPartnerA, append_note: "darf nicht" });
        expect(write.isError).toBe(true);
        expect(write.text).toContain("[INSUFFICIENT_LEVEL]");
        expect((await s.call("get_statistics")).isError).toBe(false);

        await prisma.user.update({ where: { id: "mock-user-editor" }, data: { aiAccess: "NONE" } });
        const read = await s.call("get_statistics");
        expect(read.isError).toBe(true);
        expect(read.text).toContain("[NO_PERMISSION]");

        await prisma.user.update({ where: { id: "mock-user-editor" }, data: { aiAccess: "WRITE", status: "BLOCKED" } });
        const blocked = await s.call("get_statistics");
        expect(blocked.text).toContain("[USER_BLOCKED]");
      } finally {
        await prisma.user.update({ where: { id: "mock-user-editor" }, data: { aiAccess: "WRITE", status: "ACTIVE" } });
      }
      expect(s.errors).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "Start wie mit npm run mcp:stdio (node scripts/mock.mjs mcp): Handshake und sauberes stdout",
    async () => {
      // Der stdio-Modus ist nicht mehr der Standard in .mcp.json (dort steht
      // der HTTP-Endpunkt), bleibt aber über das npm-Skript startbar.
      const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
      expect(pkg.scripts["mcp:stdio"]).toBe("node scripts/mock.mjs mcp");

      const child = spawn(process.execPath, ["scripts/mock.mjs", "mcp"], {
        cwd: ROOT,
        env: serverEnv({ MCP_USER_EMAIL: "admin@example.test", MCP_ALLOW_WRITE: "false" }) as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += String(c)));
      child.stderr.on("data", (c) => (stderr += String(c)));

      const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + "\n");
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1" } },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_statistics", arguments: {} } });

      const deadline = Date.now() + 45_000;
      while (stdout.split("\n").filter(Boolean).length < 3 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      child.stdin.end();
      const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));

      const lines = stdout.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);
      const messages = lines.map((l) => JSON.parse(l));
      for (const m of messages) expect(m.jsonrpc).toBe("2.0");
      expect(messages[0].result.serverInfo.name).toBe("familytree");
      expect(messages[1].result.tools.map((t: { name: string }) => t.name).sort()).toEqual(READ_TOOLS);
      expect(JSON.parse(messages[2].result.content[0].text).persons.total).toBe(await prisma.person.count());
      // Name der Mock-Datenbank dieses Laufs (vitest.config.ts) — in Worktrees
      // z.B. familytree_<paket>_mock, nicht fest familytree_mock.
      expect(stderr).toContain(MOCK_DB_NAME);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );
});
