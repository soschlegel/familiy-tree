/**
 * „Lebenslauf“ gegen die Mock-Datenbank (lib/services/biography.ts): Text zu
 * einer reich erfassten Person und Datenschutz für einen eingeschränkten
 * Benutzer (Betrachter nur der Familie A) — kein Name und keine Kennung
 * einer nicht sichtbaren Person im Ergebnis. Nur lesend. Überspringt sich,
 * wenn die Mock-Datenbank fehlt.
 */
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Scope } from "@/lib/scope";
import { getPersonDetail, scopeForEmail } from "@/lib/services";
import { getPersonBiography } from "@/lib/services/biography";
import { mockDbSkipReason } from "./db-ready";
import { mockData } from "./helpers";

const skipReason = await mockDbSkipReason();
if (skipReason) console.warn(`\n[tests] Lebenslauf-Tests übersprungen: ${skipReason}\n`);

const data = mockData();
const L = data.landmarks;
const byId = new Map(data.persons.map((p) => [p.id, p]));
const fullName = (id: string) => [byId.get(id)!.givenName, byId.get(id)!.familyName].filter(Boolean).join(" ");

async function scope(email: string): Promise<Scope> {
  const s = await scopeForEmail(email);
  if (!s) throw new Error(`Kein Scope für ${email}`);
  return s;
}

async function bioOf(s: Scope, id: string) {
  const detail = await getPersonDetail(s, id);
  if (!detail) return undefined;
  return getPersonBiography(detail, new Date(Date.UTC(2026, 10, 27)));
}

describe.skipIf(Boolean(skipReason))("Lebenslauf (Mock-Datenbank)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Stammvater A: Name mit Rufname, Taufe, Ehe mit Link, Tod, Beerdigung, Todesursache", async () => {
    const admin = await scope("admin@example.test");
    const bio = (await bioOf(admin, L.founders.A))!;
    expect(bio).toBeTruthy();
    expect(bio.text).toMatch(new RegExp(`^${fullName(L.founders.A)}, genannt „Hein“, wurde `));
    expect(bio.text).toContain("getauft");
    expect(bio.text).toContain("Als Todesursache ist „Lungenentzündung“ vermerkt.");
    expect(bio.text).toMatch(/ starb .*beerdigt\./s);
    // Partner und Kinder als Links auf sichtbare Personen.
    const links = bio.paragraphs.flat().filter((s) => s.personId);
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) expect(l.text).toBe(l.text.trim());
    // Kopiertext = Absatztexte ohne Links.
    expect(bio.paragraphs.map((p) => p.map((s) => s.text).join("")).join("\n\n")).toBe(bio.text);
  });

  it("eingeschränkter Benutzer: weder Namen noch Kennungen nicht sichtbarer Personen", async () => {
    const viewer = await scope("viewer@example.test");
    const visible = data.persons.filter((p) => p.familyKeys.includes("A"));
    const hidden = data.persons.filter((p) => !p.familyKeys.includes("A"));
    const visibleNames = new Set(visible.map((p) => fullName(p.id)));
    // Nur Namen, die keine sichtbare Person ebenfalls trägt.
    const forbiddenNames = [...new Set(hidden.map((p) => fullName(p.id)))].filter((n) => !visibleNames.has(n));
    const hiddenIds = new Set(hidden.map((p) => p.id));
    let checked = 0;
    for (const p of visible) {
      const bio = await bioOf(viewer, p.id);
      expect(bio, p.id).not.toBeUndefined();
      if (!bio) continue;
      checked++;
      const json = JSON.stringify(bio);
      for (const name of forbiddenNames) expect(json, `${p.id}: ${name}`).not.toContain(name);
      for (const seg of bio.paragraphs.flat()) if (seg.personId) expect(hiddenIds.has(seg.personId), `${p.id} → ${seg.personId}`).toBe(false);
      expect(json).not.toContain("Nicht freigegeben");
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("nicht sichtbare Eltern: weder genannt noch für die Geschwisterstellung gezählt", async () => {
    // Eine für den Betrachter sichtbare Person, deren Eltern beide gesperrt sind.
    const parentsOf = (id: string) =>
      data.relationships.filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.toPersonId === id).map((r) => r.fromPersonId);
    const target = data.persons.find(
      (p) =>
        p.familyKeys.includes("A") &&
        p.birthDate &&
        parentsOf(p.id).length === 2 &&
        parentsOf(p.id).every((id) => !byId.get(id)!.familyKeys.includes("A")),
    );
    expect(target, "Mock-Daten: sichtbare Person mit gesperrten Eltern").toBeTruthy();
    const admin = (await bioOf(await scope("admin@example.test"), target!.id))!;
    const viewer = (await bioOf(await scope("viewer@example.test"), target!.id))!;
    for (const parent of parentsOf(target!.id)) {
      expect(admin.text).toContain(fullName(parent));
      expect(viewer.text).not.toContain(fullName(parent));
    }
    expect(viewer.text).not.toMatch(/ von (zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|\d+) Kindern/);
    expect(viewer.text).not.toMatch(/(Sohn|Tochter|Kind) von/);
  });

  it("nicht sichtbare Person: kein Lebenslauf (wie die Seite: nicht vorhanden)", async () => {
    const viewer = await scope("viewer@example.test");
    const hidden = data.persons.find((p) => !p.familyKeys.includes("A"))!;
    expect(await bioOf(viewer, hidden.id)).toBeUndefined();
  });
});
