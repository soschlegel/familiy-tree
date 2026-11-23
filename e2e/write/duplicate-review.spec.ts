import type { APIRequestContext, Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations } from "../support/fixtures";
import { apiAs, createPerson, deletePerson, uniq, type CreatedPerson } from "../support/api";
import { mock } from "../support/mock";

/**
 * KI-Vorprüfung auf „Mögliche Dubletten“ (als Bearbeiter): Einschätzungen
 * kommen über den KI-Zugang (review_duplicate) und stehen am Paar — Urteil,
 * Begründung, „veraltet“. Sie wählen nie etwas vor, ändern die Klasse nicht,
 * und ein KI-„kein Duplikat“ blendet erst aus, wenn ein Mensch es übernimmt.
 * Alle Datensätze heißen „E2E …“ und werden entfernt.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq().replace(/[^a-z]/g, "");
const SURNAME = { safe: `Kisicher${tag}`, likely: `Kiwahr${tag}`, different: `Kianders${tag}` };
const REASON_MERGE = "E2E: gleicher Name und Geburtstag, Vorschau ohne Blocker.";
const REASON_NOT = "E2E: verschiedene Geburtsorte, laut Taufbuch zwei Kinder.";
const created: string[] = [];

type Pair = { a: string; b: string };
let safe: Pair; // Klasse „sicher“, ohne Einschätzung
let likely: Pair; // Klasse „wahrscheinlich“, KI: zusammenführen
let different: Pair; // KI: kein Duplikat

async function person(data: Record<string, unknown>): Promise<CreatedPerson> {
  const api = await apiAs("editor");
  const p = await createPerson(api, { gender: "FEMALE", ...data });
  await api.dispose();
  created.push(p.id);
  return p;
}

const secretOf = (key: string) => mock.apiTokens.find((t) => t.id === `mock-token-${key}`)!.secret;
async function mcpCall(request: APIRequestContext, key: string, name: string, args: Record<string, unknown>) {
  const res = await request.post("/api/mcp", {
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${secretOf(key)}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).result as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[] };
}

/** Das Paar, wie es die Liste führt (Reihenfolge a/b bestimmt den Link zum Vergleich). */
async function listedPair(request: APIRequestContext, surname: string): Promise<Pair & { confidence: string }> {
  const res = await request.get("/api/duplicates?limit=500");
  const items = (await res.json()).items as { a: { id: string; familyName: string }; b: { id: string }; confidence: string }[];
  const hit = items.find((d) => d.a.familyName === surname);
  expect(hit, `Paar ${surname} in der Liste`).toBeTruthy();
  return { a: hit!.a.id, b: hit!.b.id, confidence: hit!.confidence };
}

const item = (page: Page, surname: string) => page.getByTestId("dup-item").filter({ hasText: surname });
const checked = (page: Page) => page.locator('[data-testid="dup-list"] input[type="checkbox"]:checked');

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  await api.dispose();
});

test("Einschätzungen der KI stehen am Paar — Klasse und Auswahl bleiben unberührt", async ({ page, request }) => {
  await person({ givenName: "E2E Adele", familyName: SURNAME.safe, birthDate: "1850-03-12", deathDate: "1920-07-01" });
  await person({ givenName: "E2E Adele", familyName: SURNAME.safe, birthDate: "1850-03-12", deathDate: "1920-07-01" });
  await person({ givenName: "E2E Berta", familyName: SURNAME.likely, birthDate: "1861-05-04" });
  await person({ givenName: "E2E Berta", familyName: SURNAME.likely, birthDate: "1861-05-04", birthPlace: "Musterdorf" });
  await person({ givenName: "E2E Clara", familyName: SURNAME.different, birthDate: "1872-09-09" });
  await person({ givenName: "E2E Clara", familyName: SURNAME.different, birthDate: "1872-09-09", birthPlace: "Beispielstadt" });
  const s = await listedPair(page.request, SURNAME.safe);
  const l = await listedPair(page.request, SURNAME.likely);
  const d = await listedPair(page.request, SURNAME.different);
  safe = s;
  likely = l;
  different = d;
  expect(s.confidence).toBe("high");
  expect(l.confidence).toBe("medium");

  // Die KI schätzt ein: „zusammenführen“ mit Vorschlag (bewusst der ZWEITE Eintrag) und „kein Duplikat“.
  const r1 = await mcpCall(request, "editor-write", "review_duplicate", {
    person_a_id: l.a,
    person_b_id: l.b,
    verdict: "MERGE",
    reason: REASON_MERGE,
    suggested_keep_id: l.b,
  });
  expect(r1.isError, JSON.stringify(r1)).toBeFalsy();
  expect(r1.structuredContent).toMatchObject({ verdict: "MERGE", merged: false });
  const r2 = await mcpCall(request, "editor-write", "review_duplicate", { person_a_id: d.a, person_b_id: d.b, verdict: "NOT_DUPLICATE", reason: REASON_NOT });
  expect(r2.isError, JSON.stringify(r2)).toBeFalsy();

  // Filter „KI: zusammenführen“.
  await page.goto("/research/duplicates");
  const filter = page.getByTestId("dup-ki-filter");
  await expect(filter).toBeVisible();
  await filter.getByTestId("dup-ki-zusammenfuehren").click();
  await expect(page).toHaveURL(/ki=zusammenfuehren/);
  const row = item(page, SURNAME.likely);
  await expect(row).toHaveCount(1);
  await expect(item(page, SURNAME.different)).toHaveCount(0);
  await expect(item(page, SURNAME.safe)).toHaveCount(0);
  // Die Klasse bleibt „wahrscheinlich“ — ein KI-„zusammenführen“ macht kein Paar „sicher“.
  await expect(row).toHaveAttribute("data-confidence", "medium");
  await expect(row).toContainText("wahrscheinlich");
  const review = row.getByTestId("dup-review");
  await expect(review).toHaveAttribute("data-verdict", "MERGE");
  await expect(review).toHaveAttribute("data-stale", "false");
  await expect(review).toContainText("KI-Einschätzung: zusammenführen");
  await expect(review).toContainText(REASON_MERGE);
  await expect(review).toContainText("Vorschlag der KI");
  await expect(review).toContainText("Nur ein Hinweis");
  await expect(review.getByTestId("dup-review-stale")).toHaveCount(0);
  await expect(review.getByTestId("dup-review-adopt")).toHaveCount(0);
  // Keine Vorauswahl: kein Auswahlkästchen am Paar, nichts angehakt, und der Link zum
  // Vergleich folgt weiter der Liste (bleibt = erster Eintrag), nicht dem Vorschlag der KI.
  await expect(row.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(checked(page)).toHaveCount(0);
  await expect(row.getByTestId("dup-merge")).toHaveAttribute("href", `/people/merge?keep=${l.a}&other=${l.b}`);
  await expectNoA11yViolations(page);

  // Filter „Noch nicht vorgeprüft“: das sichere Paar, auswählbar, aber nicht angehakt.
  await page.getByTestId("dup-ki-offen").click();
  await expect(page).toHaveURL(/ki=offen/);
  await expect(item(page, SURNAME.likely)).toHaveCount(0);
  await expect(item(page, SURNAME.different)).toHaveCount(0);
  const safeRow = item(page, SURNAME.safe);
  await expect(safeRow).toHaveAttribute("data-confidence", "high");
  await expect(safeRow.getByTestId("dup-review")).toHaveCount(0);
  await expect(safeRow.locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(checked(page)).toHaveCount(0);

  // Filter „Vorgeprüft“ zeigt beide eingeschätzten Paare; der Klassenfilter bleibt daneben wirksam.
  await page.getByTestId("dup-ki-vorgeprueft").click();
  await expect(item(page, SURNAME.likely)).toHaveCount(1);
  await expect(item(page, SURNAME.different)).toHaveCount(1);
  await expect(item(page, SURNAME.safe)).toHaveCount(0);
  await page.goto("/research/duplicates?klasse=high&ki=vorgeprueft");
  await expect(item(page, SURNAME.likely)).toHaveCount(0);
});

test("„veraltet“, wenn sich eine Person seit der Einschätzung geändert hat — auch im Hinweis der Personenseite", async ({ page }) => {
  await page.goto(`/people/${likely.a}`);
  const hint = page.getByTestId("duplicate-banner").getByTestId("duplicate-banner-review");
  await expect(hint).toHaveText("KI-Einschätzung: zusammenführen");
  await expect(page.getByTestId("duplicate-banner-item")).toHaveAttribute("data-confidence", "medium");

  const res = await page.request.patch(`/api/persons/${likely.b}`, { data: { birthPlace: "Musterdorf bei Beispielstadt" } });
  expect(res.status(), await res.text()).toBe(200);

  await page.goto("/research/duplicates?ki=zusammenfuehren");
  const review = item(page, SURNAME.likely).getByTestId("dup-review");
  await expect(review).toHaveAttribute("data-stale", "true");
  await expect(review.getByTestId("dup-review-stale")).toHaveText("veraltet");
  await expect(review).toContainText("Seit dieser Einschätzung wurde mindestens einer der beiden Einträge geändert");
  await expect(item(page, SURNAME.likely)).toHaveAttribute("data-confidence", "medium");
  await expect(checked(page)).toHaveCount(0);

  await page.goto(`/people/${likely.a}`);
  await expect(page.getByTestId("duplicate-banner-review")).toHaveText("KI-Einschätzung: zusammenführen (veraltet)");
  // Dieselbe Einschätzung steht im Dialog „Zusammenführen …“ am Kandidaten.
  await page.getByTestId("merge-open").click();
  await expect(page.getByTestId("merge-dialog").getByTestId("merge-candidate-review")).toHaveText("KI-Einschätzung: zusammenführen (veraltet)");
  await page.keyboard.press("Escape");
  await expectNoA11yViolations(page);
});

test("KI-„kein Duplikat“ blendet nicht aus — erst „übernehmen“ durch den Menschen", async ({ page }) => {
  await page.goto("/research/duplicates?ki=kein-duplikat");
  const row = item(page, SURNAME.different);
  // Das Paar steht trotz KI-Urteil in der Liste.
  await expect(row).toHaveCount(1);
  const review = row.getByTestId("dup-review");
  await expect(review).toHaveAttribute("data-verdict", "NOT_DUPLICATE");
  await expect(review).toContainText("KI-Einschätzung: kein Duplikat");
  await expect(review).toContainText(REASON_NOT);
  await expect(row.getByTestId("dup-merge")).toBeVisible();
  await expect(row.getByTestId("dup-dismiss")).toBeVisible();

  await review.getByTestId("dup-review-adopt").click();
  await expect(item(page, SURNAME.different)).toHaveCount(0);
  // Ausgeblendet wie durch „Kein Duplikat“ — beide Einträge gibt es weiter.
  const list = (await (await page.request.get("/api/duplicates?limit=500")).json()).items as { a: { familyName: string } }[];
  expect(list.some((x) => x.a.familyName === SURNAME.different)).toBe(false);
  for (const id of [different.a, different.b]) expect((await page.request.get(`/api/persons/${id}`)).status()).toBe(200);
  // Das sichere Paar ohne Einschätzung ist unberührt.
  expect(list.some((x) => x.a.familyName === SURNAME.safe)).toBe(true);
  expect((await page.request.get(`/api/persons/${safe.a}`)).status()).toBe(200);
});

test("Betrachter sehen das Paar, aber keine Einschätzung", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("viewer") });
  const page = await context.newPage();
  await page.goto("/research/duplicates?ki=zusammenfuehren");
  await expect(page.getByRole("heading", { level: 1, name: "Mögliche Dubletten" })).toBeVisible();
  await expect(page.getByTestId("dup-review")).toHaveCount(0);
  await expect(page.getByText(REASON_MERGE)).toHaveCount(0);
  await context.close();
});
