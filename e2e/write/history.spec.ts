import { request as pwRequest, type Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  acceptDialogs,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  httpError,
  waitForHydration,
  waitForTree,
} from "../support/fixtures";
import { apiAs } from "../support/api";
import { mock } from "../support/mock";
import { mainNav, openAdminMenu } from "../support/nav";

/**
 * Verwaltung der Zeitgeschichte (/admin/history): Administrator legt ein
 * eigenes Ereignis an (Prüfung am Feld), ändert und löscht es, blendet einen
 * mitgelieferten Eintrag aus und wieder ein; Wirkung auf die Zeitreise der
 * Karte; Einträge in der Änderungsübersicht. Nicht-Administratoren kommen
 * weder über die Seite noch über die API hinein. Am Ende: Einträge der KI
 * (Vermerk, Filter, Bestätigen; eigener Block). Telefonbreite, dunkles
 * Farbschema, axe.
 *
 * Aufräumen vor und nach der Datei: eigene Einträge „E2E …“ löschen, die
 * hier ausgeblendeten mitgelieferten wieder einblenden — die lesenden Tests
 * (e2e/read/history.spec.ts) erwarten die vollständige Liste.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const TITLE = "E2E Hochwasser";
const CHANGED = "E2E Hochwasser am Fluss";
const BUILTIN = { id: "erster-weltkrieg", title: "Erster Weltkrieg" };

type State = { builtin: { id: string; hidden: boolean }[]; custom: { id: string; title: string }[] };

async function cleanup() {
  const api = await apiAs("admin");
  const res = await api.get("/api/history-events");
  expect(res.status()).toBe(200);
  const state = (await res.json()) as State;
  for (const c of state.custom.filter((c) => c.title.startsWith("E2E "))) {
    expect([200, 404]).toContain((await api.delete(`/api/history-events/${c.id}`)).status());
  }
  if (state.builtin.find((b) => b.id === BUILTIN.id)?.hidden) {
    expect((await api.patch(`/api/history-events/builtin/${BUILTIN.id}`, { data: { hidden: false } })).status()).toBe(200);
  }
  await api.dispose();
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

const custom = (page: Page) => page.getByTestId("history-custom").filter({ hasText: "E2E " });
const builtinRow = (page: Page) => page.getByTestId(`history-builtin-${BUILTIN.id}`);
const addForm = (page: Page) => page.getByRole("form", { name: "Ereignis hinzufügen" });

test("Administrator: über das Menü erreichbar, Ausgangszustand und Barrierefreiheit", async ({ page }) => {
  await page.goto("/people");
  await openAdminMenu(page);
  await mainNav(page).getByRole("link", { name: "Zeitgeschichte", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/history$/);
  await expect(page.getByRole("heading", { level: 1, name: "Zeitgeschichte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Wie funktioniert die Zeitgeschichte?" })).toHaveAttribute(
    "href",
    "/hilfe/einstellungen#zeitgeschichte",
  );
  await expect(builtinRow(page)).toContainText("1914–1918");
  await expect(builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` })).toBeVisible();
  await expect(addForm(page).getByTestId("history-form-hint")).toContainText("keine Namen aus dem Stammbaum");
  await expect(custom(page)).toHaveCount(0);

  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(builtinRow(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "light" });
});

test("anlegen mit Prüfung am Feld; erscheint in der Zeitreise", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(400));
  await page.goto("/admin/history");
  const form = addForm(page);
  await form.getByLabel("Titel").fill(TITLE);
  await form.getByLabel("Jahr von").fill("1916");
  await form.getByLabel(/Jahr bis/).fill("1900");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(form.getByRole("alert")).toContainText("„bis“ darf nicht vor „von“ liegen.");
  await expect(form.getByLabel(/Jahr bis/)).toHaveAttribute("aria-invalid", "true");

  await form.getByLabel(/Jahr bis/).fill("");
  await form.getByLabel("Art").selectOption({ label: "Seuche/Not" });
  await form.getByLabel(/Beschreibung/).fill("Der Fluss trat über die Ufer.");
  await form.getByLabel(/Gilt für Region\/Ort/).fill("Beispieltal");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${TITLE}“ angelegt.`);
  await expect(custom(page)).toHaveCount(1);
  await expect(custom(page).getByTestId("history-custom-title")).toHaveText(TITLE);
  await expect(custom(page).getByTestId("history-custom-years")).toHaveText("1916");
  await expect(custom(page).getByTestId("history-custom-region")).toHaveText("Gilt für: Beispieltal");
  // Formular wieder leer.
  await expect(form.getByLabel("Titel")).toHaveValue("");

  await page.goto("/map?mode=alle&jahr=1916");
  const item = page.getByTestId("map-history").getByTestId("map-history-item").filter({ hasText: TITLE });
  await expect(item).toHaveText(`${TITLE} (1916)`);
  await expect(item).toHaveAttribute("title", "Seuche/Not · gilt für Beispieltal · Der Fluss trat über die Ufer.");
});

test("ändern; Eintrag in der Änderungsübersicht", async ({ page }) => {
  await page.goto("/admin/history");
  await custom(page).getByRole("button", { name: `${TITLE} ändern` }).click();
  const form = page.getByRole("form", { name: `${TITLE} ändern` });
  await expect(form.getByLabel("Jahr von")).toHaveValue("1916");
  await form.getByLabel("Titel").fill(CHANGED);
  await form.getByLabel(/Jahr bis/).fill("1917");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${CHANGED}“ geändert.`);
  await expect(custom(page).getByTestId("history-custom-years")).toHaveText("1916–1917");

  await expectChange(page, `Zeitgeschichte „${CHANGED}“ geändert`);
});

/** Änderungsübersicht: das neueste Paket „Zeitgeschichte geändert“ aufklappen und die Beschreibung finden. */
async function expectChange(page: Page, what: string, nth = 0) {
  await page.goto("/admin/changes");
  await page.getByRole("button", { name: "Einzelheiten zu „Zeitgeschichte geändert“" }).nth(nth).click();
  await expect(page.getByText(what).first()).toBeVisible();
}

test("mitgelieferten Eintrag ausblenden und wieder einblenden — wirkt auf die Karte", async ({ page }) => {
  await page.goto("/admin/history");
  await builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${BUILTIN.title}“ ausgeblendet.`);
  await expect(builtinRow(page).getByTestId("history-builtin-hidden")).toHaveText("ausgeblendet");
  await expect(page.getByTestId("history-builtin-count")).toContainText("davon 1 ausgeblendet");

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).not.toContainText(BUILTIN.title);
  await expect(page.getByTestId("map-history")).toContainText(CHANGED);

  await page.goto("/admin/history");
  await builtinRow(page).getByRole("button", { name: `${BUILTIN.title} einblenden` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${BUILTIN.title}“ wieder eingeblendet.`);
  await expect(builtinRow(page).getByTestId("history-builtin-hidden")).toHaveCount(0);

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).toContainText(BUILTIN.title);

  // Neuestes Paket: wieder eingeblendet, das davor: ausgeblendet.
  await expectChange(page, `Zeitgeschichte „${BUILTIN.title}“ wieder eingeblendet`, 0);
  await expectChange(page, `Zeitgeschichte „${BUILTIN.title}“ ausgeblendet`, 1);
});

test("Telefon (390 px): ohne Seitwärts-Scrollen, Tippflächen mindestens 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/history");
  await expect(custom(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const button of [
    custom(page).getByRole("button", { name: `${CHANGED} ändern` }),
    custom(page).getByRole("button", { name: `${CHANGED} löschen` }),
    builtinRow(page).getByRole("button", { name: `${BUILTIN.title} ausblenden` }),
    addForm(page).getByRole("button", { name: "Anlegen" }),
  ]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test("löschen", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/admin/history");
  await custom(page).getByRole("button", { name: `${CHANGED} löschen` }).click();
  await expect(page.locator(".alert-success")).toHaveText(`„${CHANGED}“ gelöscht.`);
  await expect(custom(page)).toHaveCount(0);
  await expect(page.getByTestId("history-custom-empty")).toBeVisible();

  await page.goto("/map?mode=alle&jahr=1916");
  await expect(page.getByTestId("map-history")).not.toContainText(CHANGED);
});

test("Nicht-Administratoren: kein Menüpunkt, Seite leitet um, API 403", async ({ loginAs }) => {
  for (const role of ["editor", "viewer"] as const) {
    const { page } = await loginAs(role);
    await page.goto("/people");
    await openAdminMenu(page);
    await expect(mainNav(page).getByRole("link", { name: "Zeitgeschichte", exact: true })).toHaveCount(0);
    await page.goto("/admin/history");
    await expect(page).toHaveURL(/\/tree(\?|$)/);
    await expect(page.getByRole("alert").filter({ hasText: "fehlt dir die Berechtigung" })).toBeVisible();

    const api = await apiAs(role);
    expect((await api.get("/api/history-events")).status(), role).toBe(403);
    expect(
      (await api.post("/api/history-events", { data: { title: "E2E verboten", yearFrom: 1900, kind: "krieg" } })).status(),
      role,
    ).toBe(403);
    expect((await api.patch(`/api/history-events/builtin/${BUILTIN.id}`, { data: { hidden: true } })).status(), role).toBe(403);
    await api.dispose();
  }
});

// ---------------------------------------------------------------------------
// Einträge der KI (MCP add_history_event): sofort für alle sichtbar, an den
// drei Anzeigestellen (Zeitstrahl, Zeitreise, Lebenslauf) mit dem Vermerk
// „von KI, ungeprüft“; in der Verwaltung erkennbar („von KI“, Begründung,
// Quelle), filterbar („Nur unbestätigte“), einzeln oder „alle sichtbaren“
// zu bestätigen — danach ist der Vermerk weg. In dieser Datei (seriell) statt
// einer eigenen, weil „löschen“ oben eine leere Liste erwartet. Eigene Titel
// „KI-Test …“, Aufräumen vor und nach dem Block.
// ---------------------------------------------------------------------------

test.describe("Einträge der KI", () => {
  const PREFIX = "KI-Test ";
  const FLOOD = { title: "KI-Test Hochwasser im Beispieltal", year_from: 1915, kind: "not", region: "Beispieltal" };
  const FIRE = { title: "KI-Test Stadtbrand in Beispielstadt", year_from: 1917, kind: "not", region: "Beispielstadt" };
  const MANUAL = "KI-Test Markttag";
  const REASON = "Ortschronik Beispielstadt (1920), S. 12 — erfundenes Testbeispiel";
  const SOURCE = "https://example.org/chronik";
  const NOTE = "von KI, ungeprüft";

  /** Verstorbene Person der Familie A mit genauen Daten über 1914–1918 (wie e2e/read/history.spec.ts). */
  const subject = mock.persons.find((p) => {
    if (!p.familyKeys.includes("A") || !p.birthDate || !p.deathDate) return false;
    if (p.birthDatePrecision !== "DAY" || p.deathDatePrecision !== "DAY") return false;
    return p.birthDate.getUTCFullYear() < 1914 && p.deathDate.getUTCFullYear() > 1918;
  })!;

  const BASE_URL = `http://localhost:${process.env.MOCK_PORT ?? 3100}`;
  const secret = mock.apiTokens.find((t) => t.id === "mock-token-admin-write")!.secret;
  let rpcId = 1;

  /** Ein Werkzeug über /api/mcp mit dem Schreibschlüssel des Administrators. */
  async function mcpCall(name: string, args: Record<string, unknown>) {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    const res = await ctx.post("/api/mcp", {
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${secret}` },
      data: { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    await ctx.dispose();
    return json.result as { isError?: boolean; content: { text: string }[] };
  }

  type AiState = { custom: { id: string; title: string }[] };

  async function cleanupAi() {
    const api = await apiAs("admin");
    const state = (await (await api.get("/api/history-events")).json()) as AiState;
    for (const c of state.custom.filter((c) => c.title.startsWith(PREFIX))) {
      expect([200, 404]).toContain((await api.delete(`/api/history-events/${c.id}`)).status());
    }
    await api.dispose();
  }

  test.beforeAll(async () => {
    await cleanupAi();
    const cs = await mcpCall("begin_change_set", { title: "KI-Test Zeitgeschichte ergänzt" });
    const changeSetId = JSON.parse(cs.content[0].text).change_set_id;
    for (const e of [FLOOD, FIRE]) {
      const r = await mcpCall("add_history_event", { ...e, reason: REASON, source_url: SOURCE, change_set_id: changeSetId });
      expect(r.isError, r.content[0].text).toBeFalsy();
    }
    const api = await apiAs("admin");
    expect((await api.post("/api/history-events", { data: { title: MANUAL, yearFrom: 1850, kind: "sonstiges" } })).status()).toBe(201);
    await api.dispose();
  });
  test.afterAll(cleanupAi);

  const card = (page: Page, title: string) => page.getByTestId("history-custom").filter({ hasText: title });

  test("Verwaltung: KI-Einträge erkennbar, mit Begründung und Quelle; Filter „Nur unbestätigte“", async ({ page }) => {
    await page.goto("/admin/history");
    await waitForHydration(page, '[data-testid="history-filter-unconfirmed"]');
    await expect(page.getByTestId("history-unconfirmed-count")).toHaveText("davon 2 von KI, ungeprüft");
    await expect(page.getByRole("link", { name: "Wie prüfe ich Einträge der KI?" })).toHaveAttribute("href", "/hilfe/einstellungen#eintraege-der-ki");
    const flood = card(page, FLOOD.title);
    await expect(flood.getByTestId("history-custom-origin")).toHaveText("von KI");
    await expect(flood.getByTestId("history-custom-unconfirmed")).toHaveText("ungeprüft");
    await expect(flood.getByTestId("history-custom-reason")).toContainText(`Begründung der KI: ${REASON}`);
    await expect(flood.getByRole("link", { name: SOURCE })).toHaveAttribute("rel", /noopener/);
    await expect(flood.getByRole("button", { name: `${FLOOD.title} bestätigen` })).toBeVisible();
    // Von Hand angelegt: ohne Herkunftsvermerk und ohne „Bestätigen“.
    await expect(card(page, MANUAL).getByTestId("history-custom-origin")).toHaveCount(0);
    await expect(card(page, MANUAL).getByRole("button", { name: /bestätigen/ })).toHaveCount(0);

    await page.getByTestId("history-filter-unconfirmed").check();
    await expect(card(page, MANUAL)).toHaveCount(0);
    await expect(card(page, FLOOD.title)).toBeVisible();
    await expect(card(page, FIRE.title)).toBeVisible();
    await expect(page.getByTestId("history-confirm-all")).toHaveText(/Alle sichtbaren bestätigen \(\d+\)/);
    await expectNoA11yViolations(page);

    // Dunkel: neu laden (sonst misst axe mitten im Farbübergang der Knöpfe).
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(flood).toBeVisible();
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("Telefon (390 px): ohne Seitwärts-Scrollen, „Bestätigen“ mindestens 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/history");
    await expect(card(page, FLOOD.title)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const box = (await card(page, FLOOD.title).getByRole("button", { name: `${FLOOD.title} bestätigen` }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  /** Vermerk an den drei Anzeigestellen — für einen Betrachter. */
  async function expectNoteEverywhere(page: Page, present: boolean) {
    const count = present ? 1 : 0;
    // Zeitreise der Karte.
    await page.goto(`/map?mode=alle&jahr=${FLOOD.year_from}`);
    const item = page.getByTestId("map-history").getByTestId("map-history-item").filter({ hasText: FLOOD.title });
    await expect(item).toBeVisible();
    await expect(item.getByTestId("map-history-ai")).toHaveCount(count);
    if (present) await expect(item.getByTestId("map-history-ai")).toHaveText(NOTE);

    // Lebenslauf.
    await page.goto(`/people/${subject.id}`);
    // Ungeprüfte KI-Einträge zählen als Ergänzung und können unter „weitere
    // Ereignisse“ eingeklappt sein — dann erst aufklappen.
    const more = page.getByTestId("biography-history-more");
    if ((await more.count()) > 0) await more.locator("summary").click();
    const bio = page.getByTestId("biography-history").getByTestId("biography-history-item").filter({ hasText: FLOOD.title });
    await expect(bio).toBeVisible();
    await expect(bio.getByTestId("biography-history-ai")).toHaveCount(count);

    // Zeitstrahl: die Gruppe mit dem Ereignis öffnen.
    await page.goto("/tree?view=timeline");
    await waitForTree(page);
    await waitForHydration(page, '[data-testid="tree-history-toggle"]');
    // Ganzen Zeitstrahl einpassen, damit das Jahr im Bild ist (nahe Gruppen fließen dann zusammen).
    await page.locator(".react-flow__controls-fitview").click();
    const button = page.locator(`[data-testid="tree-history-button"][aria-label*="${FLOOD.title}"]`);
    await expect(button).toHaveCount(1);
    if (present) await expect(button).toHaveAttribute("aria-label", new RegExp(`${FLOOD.title} \\(${NOTE}\\)`));
    else await expect(button).not.toHaveAttribute("aria-label", new RegExp(NOTE));
    await button.click();
    const tip = page.getByTestId("tree-history-tip");
    const row = tip.locator("li").filter({ hasText: FLOOD.title });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("tree-history-ai")).toHaveCount(count);
  }

  test("Vermerk „von KI, ungeprüft“ an Zeitstrahl, Zeitreise und Lebenslauf — für alle Benutzer", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await expectNoteEverywhere(page, true);
    await expectNoA11yViolations(page);
  });

  test("einzeln bestätigen, dann „alle sichtbaren bestätigen“ mit Rückfrage", async ({ page }) => {
    acceptDialogs(page);
    await page.goto("/admin/history");
    await waitForHydration(page, '[data-testid="history-filter-unconfirmed"]');
    await card(page, FLOOD.title).getByRole("button", { name: `${FLOOD.title} bestätigen` }).click();
    await expect(page.locator(".alert-success")).toHaveText(`„${FLOOD.title}“ bestätigt.`);
    const flood = card(page, FLOOD.title);
    await expect(flood.getByTestId("history-custom-unconfirmed")).toHaveCount(0);
    await expect(flood.getByTestId("history-custom-origin")).toHaveText("von KI");
    await expect(flood.getByTestId("history-custom-confirmed")).toContainText("Bestätigt am");

    await page.getByTestId("history-filter-unconfirmed").check();
    await expect(card(page, FLOOD.title)).toHaveCount(0);
    await expect(card(page, FIRE.title)).toBeVisible();
    await page.getByTestId("history-confirm-all").click();
    await expect(page.locator(".alert-success")).toHaveText(/^(1 Eintrag|\d+ Einträge) bestätigt\.$/);
    await expect(card(page, FIRE.title)).toHaveCount(0);
    await expect(page.getByTestId("history-unconfirmed-count")).toHaveCount(0);
  });

  test("nach dem Bestätigen ist der Vermerk überall weg", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await expectNoteEverywhere(page, false);
  });
});
