import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow, httpError } from "../support/fixtures";
import { apiAs, deletePerson, IMPORT_TIMEOUT, uniq } from "../support/api";

/**
 * Vorschläge schon beim GEDCOM-Import (/admin/data): Ein zweiter Baum mit
 * denselben Menschen wie ein früherer Import. Die Vorschau zeigt prominent
 * den Zusammenhang, Standard bleibt „Neu anlegen“, der Sammelknopf wählt nur
 * „sichere“ (einzeln abwählbar), die Nachprüfung beim Ausführen meldet eine
 * seit der Vorschau geänderte Person und importiert dann nichts; danach neu
 * entschieden und verknüpft. Auf Telefonbreite, hell und dunkel axe-sauber.
 *
 * Erfundene Namen, eigener Nachname „E2E Vor<tag>“; zum Schluss werden die
 * Personen gelöscht. Ausgeführte Läufe bleiben im Importverlauf (nur Admins).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const SURNAME = `E2E Vor${tag}`;
const guid = (n: number) => `E2E00000-0000-0000-00${String(10 + n)}-${tag.padStart(12, "0").slice(-12).toUpperCase()}`;
const batches: string[] = [];

type P = { x: string; given: string; sex: "M" | "F"; birth: string; death?: string };

function gedcom(treeGuid: string, persons: P[], families: string[][]): string {
  const lines = ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", "1 SOUR MYHERITAGE", "2 NAME MyHeritage Family Tree Builder", `1 _PROJECT_GUID ${treeGuid}`];
  for (const p of persons) {
    lines.push(`0 @${p.x}@ INDI`, `1 _UID ${treeGuid}-${p.x}`, `1 NAME ${p.given} /${SURNAME}/`, `1 SEX ${p.sex}`, "1 BIRT", `2 DATE ${p.birth}`);
    if (p.death) lines.push("1 DEAT", `2 DATE ${p.death}`);
  }
  families.forEach((f, i) => lines.push(`0 @F${i + 1}@ FAM`, ...f));
  lines.push("0 TRLR");
  return lines.join("\n") + "\n";
}

/** Früherer Import: Ludwig ⚭ Martha (genaue Daten). */
const BASE = gedcom(
  guid(1),
  [
    { x: "I1", given: "Ludwig", sex: "M", birth: "3 APR 1871", death: "9 OCT 1931" },
    { x: "I2", given: "Martha", sex: "F", birth: "17 JUN 1874", death: "2 DEC 1940" },
  ],
  [["1 HUSB @I1@", "1 WIFE @I2@"]],
);
/** Neuer Baum: dieselben beiden (gleiche Daten) und ihr Sohn Theodor. */
const OTHER = gedcom(
  guid(2),
  [
    { x: "I5", given: "Ludwig", sex: "M", birth: "3 APR 1871", death: "9 OCT 1931" },
    { x: "I6", given: "Martha", sex: "F", birth: "17 JUN 1874", death: "2 DEC 1940" },
    { x: "I7", given: "Theodor", sex: "M", birth: "1899" },
  ],
  [["1 HUSB @I5@", "1 WIFE @I6@", "1 CHIL @I7@"]],
);

const file = (name: string, content: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(content, "utf8") });

async function preview(page: Page, name: string, content: string) {
  await page.goto("/admin/data");
  await page.getByLabel("GEDCOM-Datei").setInputFiles(file(name, content));
  const response = page.waitForResponse((r) => r.url().endsWith("/api/import/gedcom") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Vorschau der GEDCOM-Datei" }).click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(200);
  batches.push((await res.json()).batchId);
  await expect(page.getByTestId("gedcom-preview")).toBeVisible();
}

async function persons(api: APIRequestContext, given?: string) {
  const res = await api.get(`/api/persons?q=${encodeURIComponent(SURNAME)}&limit=200`);
  expect(res.status()).toBe(200);
  const all = (await res.json()) as { id: string; givenName: string; familyName: string | null }[];
  return all.filter((p) => p.familyName === SURNAME && (!given || p.givenName === given));
}

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of batches) await api.delete(`/api/import/gedcom/${id}`); // nur offene Vorschauen
  for (const p of await persons(api)) await deletePerson(api, p.id);
  await api.dispose();
});

test("früherer Import", async ({ page }) => {
  await preview(page, `e2e-vorschlag-${tag}-a.ged`, BASE);
  await page.getByRole("button", { name: "GEDCOM-Import ausführen" }).click();
  await expect(page.getByTestId("gedcom-result")).toBeVisible({ timeout: IMPORT_TIMEOUT });
});

test("Vorschläge gegen den früheren Import: Standard neu anlegen, Sammelknopf nur sicher, Nachprüfung, verknüpfen", async ({ page, consoleGuard }) => {
  // Die Nachprüfung antwortet absichtlich mit 409 (Konflikt).
  consoleGuard.allow(httpError(409));
  // Telefonbreite und dunkles Farbschema von Anfang an (axe misst sonst mitten
  // im Farbübergang); hell prüft gedcom-import.spec.ts.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await preview(page, `e2e-vorschlag-${tag}-b.ged`, OTHER);

  // Prominent: Zusammenhang mit vorhandenen Daten, aufgeschlüsselt nach Klasse.
  const links = page.getByTestId("gedcom-links");
  await expect(links).toContainText("Dieser Import hängt über 2 Personen mit vorhandenen Daten zusammen");
  await expect(links.getByTestId("gedcom-links-counts")).toContainText("sicher 2");
  await expect(links.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/import-und-export#vorschlaege-personen-die-es-schon-gibt");
  const sure = links.getByTestId("gedcom-links-high");
  await expect(sure).toHaveAttribute("open", "");
  const rows = sure.getByTestId("gedcom-link-row");
  await expect(rows).toHaveCount(2);
  // Standard „Neu anlegen“, auch bei „sicher“; Begründung und Herkunft je Vorschlag.
  for (const given of ["Ludwig", "Martha"]) {
    const row = rows.filter({ hasText: `Aus der Datei: ${given}` });
    await expect(row.getByRole("radio", { name: "Neu anlegen" })).toBeChecked();
    await expect(row).toContainText("Übereinstimmung: Gleicher Name, gleiches Geburtsdatum");
    await expect(row).toContainText("Import ");
  }
  await expect(page.getByTestId("gedcom-what-links")).toContainText("Keine Verknüpfung ausgewählt");

  // Telefonbreite und Barrierefreiheit (dunkel) mit offenem Abschnitt.
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // Sammelknopf: nur „sichere“, danach einzeln sichtbar und abwählbar.
  await links.getByTestId("gedcom-links-choose-sure").click();
  await expect(links.getByTestId("gedcom-links-chosen")).toContainText("2 Verknüpfungen ausgewählt");
  const martha = rows.filter({ hasText: "Aus der Datei: Martha" });
  await expect(martha).toContainText("wird verknüpft");
  await martha.getByRole("radio", { name: "Neu anlegen" }).check();
  await expect(links.getByTestId("gedcom-links-chosen")).toContainText("1 Verknüpfung ausgewählt");
  await expect(page.getByTestId("gedcom-what-links")).toContainText("1 Person der Datei wird mit einer vorhandenen Person verknüpft");

  // Seit der Vorschau geändert: Ludwigs Sterbedatum widerspricht jetzt → Nachprüfung meldet, nichts importiert.
  const api = await apiAs("admin");
  const ludwig = (await persons(api, "Ludwig"))[0];
  expect((await api.patch(`/api/persons/${ludwig.id}`, { data: { deathDate: "1950-01-01" } })).status()).toBe(200);
  const before = (await persons(api)).length;
  await page.getByRole("button", { name: "GEDCOM-Import ausführen" }).click();
  const issues = links.getByTestId("gedcom-link-issues");
  await expect(issues).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(issues).toContainText("es wurde nichts importiert");
  await expect(issues).toContainText("Ludwig");
  await expect(links.getByTestId("gedcom-links-chosen")).toHaveText("Noch keine Verknüpfung ausgewählt.");
  expect((await persons(api)).length).toBe(before);

  // Zurückgesetzt und neu entschieden: verknüpfen klappt.
  expect((await api.patch(`/api/persons/${ludwig.id}`, { data: { deathDate: "1931-10-09" } })).status()).toBe(200);
  await rows.filter({ hasText: "Aus der Datei: Ludwig" }).getByRole("radio", { name: /Mit vorhandener Person verknüpfen: Ludwig/ }).check();
  await page.getByRole("button", { name: "GEDCOM-Import ausführen" }).click();
  const result = page.getByTestId("gedcom-result");
  await expect(result).toBeVisible({ timeout: IMPORT_TIMEOUT });
  await expect(result).toContainText("1 mit vorhandenen Personen verknüpft");

  // Ludwig gibt es einmal (verknüpft, jetzt mit Sohn Theodor), Martha zweimal (bewusst neu angelegt).
  expect(await persons(api, "Ludwig")).toHaveLength(1);
  expect(await persons(api, "Martha")).toHaveLength(2);
  const detail = await (await api.get(`/api/persons/${ludwig.id}`)).json();
  expect(JSON.stringify(detail)).toContain("Theodor");
  await api.dispose();
});
