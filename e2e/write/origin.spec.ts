import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow, waitForTree } from "../support/fixtures";
import { apiAs, deletePerson, uniq } from "../support/api";

/**
 * Herkunft mit echten Importen: zwei Importe derselben Familie, eine Person
 * daraus zusammengeführt (Verbindungsperson). Geprüft: Buchstaben und Farben
 * je Import (stabil über Seiten hinweg), Chips und Ring im Baum, Legende,
 * Block „Herkunft“ der Personenseite samt „zusammengeführt am …“, Übersicht
 * auf „Importe verbinden“, Umbenennen in der Importverwaltung. Nur Admin
 * (die importierten Personen liegen in eigenen Familien). Erfundene Namen,
 * räumt auf. Mit ORIGIN_SCREENS=<Ordner> entstehen Bildschirmfotos.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const SN = `Herkunftler${tag.replace(/[^a-z]/g, "")}`;
const FAMILIES = [`E2E Herkunft A ${tag}`, `E2E Herkunft B ${tag}`];
const NAME = `E2E Stammbaum ${tag}`;
const shots = process.env.ORIGIN_SCREENS;
let trees: string[] = [];
let hans = "";
let letters: string[] = [];

const P = (x: string, given: string, sex: string, birth: string, extra: string[]) =>
  [`0 @${x}@ INDI`, `1 _UID @U@${x}`, `1 NAME ${given} /${SN}/`, `1 SEX ${sex}`, "1 BIRT", `2 DATE ${birth}`, ...extra].join("\r\n");
const ged = (guid: string, uid: string, body: string[]) =>
  ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", "1 CHAR UTF-8", "1 SOUR MYHERITAGE", `1 _PROJECT_GUID ${guid}`, ...body.map((b) => b.replaceAll("@U@", uid)), "0 TRLR", ""].join("\r\n");
const fileA = (g: string, u: string) =>
  ged(g, u, [
    P("I1", "Gottlieb", "M", "4 JAN 1820", ["1 FAMS @F1@"]),
    P("I2", "Hans", "M", "12 MAR 1850", ["1 FAMC @F1@", "1 OCCU Schmied"]),
    "0 @F1@ FAM\r\n1 HUSB @I1@\r\n1 CHIL @I2@",
  ]);
const fileB = (g: string, u: string) =>
  ged(g, u, [
    P("I7", "Hans", "M", "12 MAR 1850", ["1 FAMS @F4@"]),
    P("I9", "Otto", "M", "1880", ["1 FAMC @F4@"]),
    "0 @F4@ FAM\r\n1 HUSB @I7@\r\n1 CHIL @I9@",
  ]);

async function importFile(api: APIRequestContext, name: string, text: string, family: string) {
  const res = await api.post("/api/import/gedcom", { multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") } } });
  expect(res.status(), await res.text()).toBe(200);
  const plan = (await res.json()) as { batchId: string; sourceTreeId: string };
  const apply = await api.post(`/api/import/gedcom/${plan.batchId}/apply`, { data: { family: { mode: "new", name: family } } });
  expect(apply.status()).toBe(202);
  await expect.poll(async () => ((await (await api.get(`/api/import/gedcom/${plan.batchId}/apply`)).json()) as { state: string }).state, { timeout: 60_000 }).toBe("done");
  return plan.sourceTreeId;
}

type Source = { sourceTreeId: string; letter: string; color: string; displayName: string | null };
const sources = async (api: APIRequestContext) => (await (await api.get("/api/import/sources")).json()) as Source[];
const card = (page: Page, id: string) => page.locator(`[data-testid="tree-person"][data-person-id="${id}"]`);

test.beforeAll(async () => {
  const api = await apiAs("admin");
  const id = tag.toUpperCase().replace(/[^A-Z0-9]/g, "");
  trees = [
    await importFile(api, `e2e-herkunft-a-${tag}.ged`, fileA(`E2E-HA-${id}`, `HA${id}`), FAMILIES[0]),
    await importFile(api, `e2e-herkunft-b-${tag}.ged`, fileB(`E2E-HB-${id}`, `HB${id}`), FAMILIES[1]),
  ];
  // Beide „Hans“ zusammenführen → eine Person aus zwei Importen.
  const found = (await (await api.get(`/api/persons?q=${encodeURIComponent(`Hans ${SN}`)}&limit=10`)).json()) as { id: string }[];
  expect(found).toHaveLength(2);
  const merged = await api.post("/api/persons/merge", { data: { keepId: found[0].id, mergeId: found[1].id } });
  expect(merged.status(), await merged.text()).toBe(200);
  hans = found[0].id;
  const all = await sources(api);
  letters = trees.map((t) => all.find((s) => s.sourceTreeId === t)!.letter);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const t of trees) await api.patch("/api/import/sources", { data: { sourceTreeId: t, displayName: "" } });
  const res = await api.get(`/api/persons?q=${encodeURIComponent(SN)}&limit=100`);
  for (const p of (await res.json()) as { id: string }[]) await deletePerson(api, p.id);
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  for (const f of families.filter((x) => FAMILIES.includes(x.name))) await api.delete(`/api/families/${f.id}?force=true`);
  await api.dispose();
});

test("Importverwaltung: Import umbenennen — Buchstabe und Farbe bleiben", async ({ page }) => {
  const api = await apiAs("admin");
  const before = await sources(api);
  expect(letters[0]).not.toBe(letters[1]);
  expect(letters.join("")).not.toContain("H");

  await page.goto("/admin/data");
  const row = page.locator(`[data-testid="import-source"][data-origin="${letters[0]}"]`);
  await expect(row.getByTestId("import-source-label")).toContainText("Import vom");
  await expect(row).toContainText(`e2e-herkunft-a-${tag}.ged`);
  await row.getByTestId("import-source-rename").click();
  await row.getByTestId("import-source-name").fill(NAME);
  await row.getByTestId("import-source-save").click();
  await expect(row.getByTestId("import-source-label")).toHaveText(NAME);
  await expect(page.getByTestId("import-sources").getByRole("status")).toContainText(`Import ${letters[0]} heißt jetzt „${NAME}“`);
  await expectNoA11yViolations(page);

  const after = await sources(api);
  const pick = (list: Source[]) => trees.map((t) => list.find((s) => s.sourceTreeId === t)!).map((s) => [s.letter, s.color]);
  expect(pick(after)).toEqual(pick(before));
  expect(after.find((s) => s.sourceTreeId === trees[0])!.displayName).toBe(NAME);
  await api.dispose();
});

test("Stammbaum: Chips mit Buchstaben, Verbindungsperson mit Ring, Legende hebt hervor", async ({ page }) => {
  await page.goto(`/tree?focus=${hans}&herkunft=1`);
  await waitForTree(page);
  const c = card(page, hans);
  await expect(c).toHaveAttribute("data-origin", [...letters].sort().join(" "));
  await expect(c).toHaveAttribute("data-connecting", "true");
  await expect(c.getByTestId("tree-connecting-ring")).toBeVisible();
  await expect(c.getByTestId("origin-chip")).toHaveCount(2);
  await expect(c.locator(`[data-testid="origin-chip"][data-origin="${letters[0]}"]`)).toHaveAttribute("title", `Import ${letters[0]}: ${NAME}`);
  await expect(c.getByTestId("tree-person-main")).toContainText("(Verbindungsperson)");
  // Vater (nur Import A) und Sohn (nur Import B) tragen je einen Chip, keinen Ring.
  const single = page.locator('[data-testid="tree-person"][data-origin]:not([data-connecting])');
  await expect(single).toHaveCount(2);
  await expect(single.getByTestId("tree-connecting-ring")).toHaveCount(0);

  const legend = page.getByTestId("tree-origin-legend");
  await expect(legend.getByTestId("origin-legend-item")).toHaveCount(2);
  const itemA = legend.locator(`[data-testid="origin-legend-item"][data-origin="${letters[0]}"]`);
  await expect(itemA).toContainText(NAME);
  await expect(itemA).toContainText("2 Personen");
  await expect(legend.getByTestId("origin-legend-connecting")).toContainText("(1)");
  await expectNoA11yViolations(page);
  if (shots) await page.screenshot({ path: `${shots}/baum-herkunft-1280.png` });

  // Hervorheben: Personen ohne diesen Import treten zurück.
  await itemA.click();
  await expect(itemA).toHaveAttribute("aria-pressed", "true");
  const dimmed = page.locator(`[data-testid="tree-person"][data-origin="${letters[1]}"] [data-testid="tree-person-main"]`);
  await expect(dimmed).toHaveClass(/opacity-25/);
  await expect(c.getByTestId("tree-person-main")).toHaveClass(/opacity-100/);
  if (shots) await page.screenshot({ path: `${shots}/baum-herkunft-hervorgehoben-1280.png` });
  await itemA.click();
  await expect(dimmed).toHaveClass(/opacity-100/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tree?focus=${hans}&herkunft=1`);
  await waitForTree(page);
  await expect(card(page, hans).getByTestId("origin-chip")).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  if (shots) {
    await page.screenshot({ path: `${shots}/baum-herkunft-390.png` });
    await page.getByRole("button", { name: "Legende" }).click();
    await expect(page.getByTestId("tree-origin-legend")).toBeVisible();
    await page.screenshot({ path: `${shots}/baum-herkunft-legende-390.png` });
  }
});

test("Personenseite: Importe, „zusammengeführt am … aus 2 Einträgen“, Chips an den Einträgen", async ({ page }) => {
  await page.goto(`/people/${hans}`);
  const block = page.getByTestId("person-origin");
  await expect(block.getByTestId("person-origin-import")).toHaveCount(2);
  await expect(block.locator(`[data-testid="person-origin-import"][data-origin="${letters[0]}"]`)).toContainText(NAME);
  await expect(block.locator(`[data-testid="person-origin-import"][data-origin="${letters[1]}"]`)).toContainText("durch Zusammenführen dazugekommen");
  await expect(block.getByTestId("person-origin-merged")).toHaveText(/^Zusammengeführt am \d{2}\.\d{2}\.\d{4} aus 2 Einträgen\.$/);
  await expect(block.getByTestId("person-origin-note")).toContainText("keine Herkunft je Angabe");
  // Beruf kam mit Import A, die Beziehungen aus je einem Import.
  const occupation = page.getByTestId("event-row").filter({ hasText: "Schmied" });
  await expect(occupation.getByTestId("origin-chips")).toHaveAttribute("data-origins", letters[0]);
  const rels = page.getByTestId("relation-row");
  await expect(rels.filter({ hasText: "Gottlieb" }).getByTestId("origin-chips")).toHaveAttribute("data-origins", letters[0]);
  await expect(rels.filter({ hasText: "Otto" }).getByTestId("origin-chips")).toHaveAttribute("data-origins", letters[1]);
  await expectNoA11yViolations(page);
  if (shots) await page.screenshot({ path: `${shots}/person-herkunft-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test("Übersicht auf „Importe verbinden“: Kreise, Kante mit Zahl, dieselben Angaben als Tabelle", async ({ page }) => {
  await page.goto("/research/connect");
  const box = page.getByTestId("origin-overview");
  const graph = box.getByTestId("origin-overview-graph");
  await expect(graph).toBeVisible();
  await expect(graph.locator(`[data-testid="origin-node"][data-origin="${letters[0]}"]`)).toHaveAttribute("data-persons", "2");
  await expect(graph.locator(`[data-testid="origin-node"][data-origin="${letters[1]}"]`)).toHaveAttribute("data-persons", "2");
  const edge = [...letters].sort().join("-");
  await expect(graph.locator(`[data-testid="origin-edge"][data-edge="${edge}"]`)).toHaveAttribute("data-persons", "1");
  // Nur die Tabellenzeile — der Chip darin trägt dasselbe data-origin.
  const nodeRow = box.getByTestId("origin-overview-nodes").locator(`tr[data-origin="${letters[0]}"]`);
  await expect(nodeRow).toContainText(NAME);
  await expect(nodeRow).toContainText("2 Personen");
  await expect(box.getByTestId("origin-overview-edges").locator(`tr[data-edge="${edge}"]`)).toContainText("1 Person");
  // Derselbe Name auch in der Auswahl der Importe.
  await expect(page.getByText(`Import ${letters[0]} · ${NAME}`).first()).toBeVisible();
  await expectNoA11yViolations(page);
  if (shots) await page.screenshot({ path: `${shots}/uebersicht-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  if (shots) await page.screenshot({ path: `${shots}/uebersicht-390.png`, fullPage: true });
});

test.describe("als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });
  test("Umbenennen und Liste der Importe bleiben Administratoren vorbehalten", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/403/);
    await page.goto("/tree");
    expect((await page.request.get("/api/import/sources")).status()).toBe(403);
    expect((await page.request.patch("/api/import/sources", { data: { sourceTreeId: trees[0], displayName: "Fremd" } })).status()).toBe(403);
  });
});
