import type { APIRequestContext } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { apiAs, deletePerson, uniq } from "../support/api";

/**
 * Importe verbinden: zwei Importe derselben Familie (je mit eigenen
 * Verwandten), Abgleich, Klassen, gemeinsame Vorschau mit Sichtbarkeits-
 * Hinweis, Zusammenführen, Ergebnis mit Folge-Abgleich. Nur Admin; Bearbeiter
 * sieht die Seite nicht. Erfundene Namen, räumt auf.
 * Mit MERGE_SCREENS=<Ordner> entstehen Bildschirmfotos (1440 und 390 px).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const SN = `Verbinder${tag.replace(/[^a-z]/g, "")}`;
const FAMILIES = [`E2E Verbinden A ${tag}`, `E2E Verbinden B ${tag}`];
const shots = process.env.MERGE_SCREENS;
let groups: string[] = [];

function ged(guid: string, uid: string, persons: string[], fams: string[]) {
  return ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", "1 CHAR UTF-8", "1 SOUR MYHERITAGE", `1 _PROJECT_GUID ${guid}`, ...persons.map((p) => p.replaceAll("@U@", uid)), ...fams.map((f) => f.replaceAll("@U@", uid)), "0 TRLR", ""].join("\r\n");
}
const P = (x: string, given: string, sex: string, birth: string, death: string | null, extra: string[]) =>
  [`0 @${x}@ INDI`, `1 _UID @U@${x}`, `1 NAME ${given} /${SN}/`, `1 SEX ${sex}`, "1 BIRT", `2 DATE ${birth}`, ...(death ? ["1 DEAT", `2 DATE ${death}`] : []), ...extra].join("\r\n");

const fileA = (g: string, u: string) =>
  ged(g, u, [
    P("I1", "Gottlieb", "M", "4 JAN 1820", "9 SEP 1880", ["1 FAMS @F1@"]),
    P("I2", "Hans", "M", "12 MAR 1850", "1 JUN 1910", ["1 FAMC @F1@", "1 FAMS @F2@"]),
    P("I3", "Maria", "F", "3 MAY 1855", "2 FEB 1920", ["1 FAMS @F2@"]),
  ], ["0 @F1@ FAM\r\n1 HUSB @I1@\r\n1 CHIL @I2@", "0 @F2@ FAM\r\n1 HUSB @I2@\r\n1 WIFE @I3@"]);
const fileB = (g: string, u: string) =>
  ged(g, u, [
    P("I7", "Hans", "M", "12 MAR 1850", "1 JUN 1910", ["1 FAMS @F4@"]),
    P("I8", "Maria", "F", "3 MAY 1855", "2 FEB 1920", ["1 FAMS @F4@"]),
    P("I9", "Otto", "M", "1880", null, ["1 FAMC @F4@"]),
  ], ["0 @F4@ FAM\r\n1 HUSB @I7@\r\n1 WIFE @I8@\r\n1 CHIL @I9@"]);

async function importFile(api: APIRequestContext, name: string, text: string, family: string) {
  const res = await api.post("/api/import/gedcom", { multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") } } });
  expect(res.status(), await res.text()).toBe(200);
  const plan = (await res.json()) as { batchId: string; sourceTreeId: string };
  const apply = await api.post(`/api/import/gedcom/${plan.batchId}/apply`, { data: { family: { mode: "new", name: family } } });
  expect(apply.status()).toBe(202);
  await expect.poll(async () => ((await (await api.get(`/api/import/gedcom/${plan.batchId}/apply`)).json()) as { state: string }).state, { timeout: 60_000 }).toBe("done");
  return plan.sourceTreeId;
}

test.beforeAll(async () => {
  const api = await apiAs("admin");
  const id = tag.toUpperCase().replace(/[^A-Z0-9]/g, "");
  groups = [await importFile(api, `e2e-verbinden-a-${tag}.ged`, fileA(`E2E-A-${id}`, `EA${id}`), FAMILIES[0]), await importFile(api, `e2e-verbinden-b-${tag}.ged`, fileB(`E2E-B-${id}`, `EB${id}`), FAMILIES[1])];
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  const res = await api.get(`/api/persons?q=${encodeURIComponent(SN)}&limit=100`);
  for (const p of (await res.json()) as { id: string }[]) await deletePerson(api, p.id);
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  for (const f of families.filter((x) => FAMILIES.includes(x.name))) await api.delete(`/api/families/${f.id}?force=true`);
  await api.dispose();
});

test("Abgleich → Vorschau → Zusammenführen → Folge-Abgleich", async ({ page }) => {
  acceptDialogs(page);
  const api = await apiAs("admin");
  const start = await api.post("/api/connect", { data: { groups } });
  expect(start.status()).toBe(202);
  await api.dispose();

  await page.goto("/research/connect");
  const run = page.getByTestId("connect-run");
  await expect(run).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await expect(page.getByTestId("connect-summary")).toContainText("Familienverb");
  await expect(page.getByTestId("connect-summary")).toContainText("Verbindungspersonen zwischen");
  const pair = page.getByTestId("connect-pair").filter({ hasText: `Hans ${SN}` }).first();
  await expect(pair).toHaveAttribute("data-confidence", "high");
  await expect(pair).toContainText("verbindet");
  await expectNoA11yViolations(page);
  if (shots) {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.screenshot({ path: `${shots}/connect-${w}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByTestId("connect-preview").click();
  const box = page.getByTestId("connect-preview-box");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("connect-visibility")).toContainText("weiteren Familien");
  if (shots) await page.screenshot({ path: `${shots}/connect-preview-1440.png`, fullPage: true });
  await page.getByTestId("connect-apply").click();
  await expect(page.getByTestId("connect-done")).toContainText("gemeinsamer Stammbaum", { timeout: 60_000 });
  await page.getByTestId("connect-followup").click();
  await expect(run).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
});

test.describe("als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });
  test("Seite und Schnittstelle bleiben verschlossen", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/404|403/);
    // Mit loading.tsx streamt Next.js schon (Status 200), bevor notFound() greift — geprüft wird der Inhalt.
    await page.goto("/research/connect");
    await expect(page.getByTestId("connect-start")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Importe verbinden");
    const api = await apiAs("editor");
    expect((await api.get("/api/connect")).status()).toBe(403);
    await api.dispose();
  });
});
