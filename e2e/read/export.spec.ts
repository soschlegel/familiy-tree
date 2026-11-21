import { readFile } from "node:fs/promises";

import JSZip from "jszip";
import type { Page } from "@playwright/test";

import { test, expect, authFile } from "../support/fixtures";
import { L, mock, visibleFor } from "../support/mock";

/** Export über die Daten-Seite (Download wie im Browser). */

type ExchangeFile = {
  version: number;
  persons: Record<string, unknown>[];
  relationships: Record<string, unknown>[];
  media: { id: string; fileName: string }[];
  sources: { id: string; title: string; mediaId: string | null }[];
  citations: {
    id: string;
    sourceId: string;
    personId: string | null;
    relationshipId: string | null;
    eventId?: string | null;
    fact: string;
  }[];
  events: Record<string, unknown>[];
  personNames: Record<string, unknown>[];
};

async function download(page: Page, linkName: string) {
  await page.goto("/admin/data");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: linkName }).click(),
  ]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), body: await readFile(path!) };
}

test.describe("als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("JSON enthält alles einschließlich Genauigkeit, Quellen und Belegen", async ({ page }) => {
    const { name, body } = await download(page, "Nur JSON");
    expect(name).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(body.toString("utf8")) as ExchangeFile;

    // Version 3: Lebensereignisse, weitere Namen, Orte an Beziehungen, Bereiche und Wortlaute.
    expect(data.version).toBe(4);
    expect(data.persons).toHaveLength(mock.persons.length);
    expect(data.relationships).toHaveLength(mock.relationships.length);
    expect(data.sources).toHaveLength(mock.sources.length);
    expect(data.citations).toHaveLength(mock.citations.length);
    expect(data.media).toHaveLength(mock.images.length);
    expect(data.events).toHaveLength(mock.events.length);
    expect(data.personNames).toHaveLength(mock.personNames.length);

    // Neue Felder: Ereignis mit Bereich, Wortlaut ohne Datum, abweichende Geburt,
    // Ereignis an einer Beziehung, Heiratsort, Ehestand unbekannt, weitere Namen.
    const G = L.genealogy;
    expect(data.events.find((e) => e.id === G.rangeEvent)).toMatchObject({ dateQualifier: "BETWEEN", dateTo: expect.any(String) });
    expect(data.events.find((e) => e.id === G.phraseEvent)).toMatchObject({ date: null, datePhrase: expect.any(String) });
    expect(data.events.find((e) => e.id === G.alternativeBirth)).toMatchObject({ type: "BIRTH", isAlternative: true });
    expect(data.events.find((e) => e.id === G.relationshipEvent)).toMatchObject({ relationshipId: G.marriageWithPlace, personId: null });
    expect(data.relationships.find((r) => r.id === G.marriageWithPlace)!.startPlace).toBeTruthy();
    for (const id of G.unknownStatus) expect(data.relationships.find((r) => r.id === id)).toMatchObject({ subtype: "PARTNER_UNKNOWN" });
    expect(data.personNames.find((n) => n.personId === G.namesPerson)).toMatchObject({ type: "VARIANT" });

    // Genauigkeit und Zusatz je Datum.
    const about = data.persons.find((p) => p.id === L.impreciseDates.about)!;
    expect(about).toMatchObject({ birthDatePrecision: "YEAR", birthDateQualifier: "ABOUT" });
    const before = data.persons.find((p) => p.id === L.impreciseDates.before)!;
    expect(before).toMatchObject({ deathDatePrecision: "YEAR", deathDateQualifier: "BEFORE" });
    const month = data.persons.find((p) => p.id === L.impreciseDates.monthOnly)!;
    expect(month).toMatchObject({ birthDatePrecision: "MONTH", birthDateQualifier: "EXACT" });
    const marriage = data.relationships.find((r) => r.id === L.citedMarriage)!;
    expect(marriage).toMatchObject({ startDatePrecision: "YEAR" });
    for (const r of data.relationships) {
      expect(Object.keys(r)).toEqual(expect.arrayContaining(["startDatePrecision", "startDateQualifier", "endDatePrecision", "endDateQualifier"]));
    }
    const churchBook = data.sources.find((s) => s.id === L.sources.churchBookA)!;
    expect(churchBook).toMatchObject({ datePrecision: "YEAR", dateQualifier: "BEFORE" });

    // Belege an Personen und an Beziehungen.
    expect(data.citations.some((c) => c.relationshipId === L.citedMarriage && c.fact === "PARTNERSHIP")).toBe(true);
    expect(data.citations.some((c) => c.personId === L.founders.A && c.fact === "BIRTH")).toBe(true);
    // Der Scan der familienübergreifenden Quelle zeigt auf ein exportiertes Bild.
    const cross = data.sources.find((s) => s.id === L.sources.crossFamily)!;
    expect(cross.mediaId).toBeTruthy();
    expect(data.media.map((m) => m.id)).toContain(cross.mediaId);
  });

  test("ZIP enthält das JSON und die Bilddateien", async ({ page }) => {
    const { name, body } = await download(page, "ZIP mit Bildern");
    expect(name).toMatch(/^stammbaum_\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(body);
    const json = JSON.parse(await zip.file("stammbaum.json")!.async("string")) as ExchangeFile;
    expect(json.persons).toHaveLength(mock.persons.length);
    expect(json.citations).toHaveLength(mock.citations.length);
    expect(zip.file("HINWEIS.txt"), "keine fehlenden Bilder").toBeNull();
    for (const m of json.media) {
      const file = zip.file(`media/${m.fileName}`);
      expect(file, m.fileName).not.toBeNull();
      const bytes = await file!.async("uint8array");
      // WebP: „RIFF“ … „WEBP“
      expect(Buffer.from(bytes.slice(8, 12)).toString("ascii"), m.fileName).toBe("WEBP");
    }
  });
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("Export enthält nur Familie A", async ({ page }) => {
    const { body } = await download(page, "Nur JSON");
    const data = JSON.parse(body.toString("utf8")) as ExchangeFile;
    const visible = new Set(visibleFor(["A"]).map((p) => p.id));
    expect(data.persons).toHaveLength(visible.size);
    for (const p of data.persons) expect(visible.has(p.id as string), String(p.id)).toBe(true);
    for (const r of data.relationships) {
      expect(visible.has(r.fromPersonId as string) && visible.has(r.toPersonId as string)).toBe(true);
    }
    for (const c of data.citations) {
      if (c.personId) expect(visible.has(c.personId)).toBe(true);
    }
    const ids = data.sources.map((s) => s.id);
    expect(ids).toContain(L.sources.crossFamily);
    expect(ids).not.toContain(L.sources.onlyFamilyD);
    expect(ids).not.toContain(L.sources.uncited);
    // Der Beleg für die Person nur aus B fehlt.
    expect(data.citations.some((c) => c.personId === L.inLawOnlyB)).toBe(false);
  });
});
