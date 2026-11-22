import type { Page } from "@playwright/test";

import {
  test,
  expect,
  authFile,
  devLogin,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
} from "../support/fixtures";
import { apiAs, uniq } from "../support/api";
import { openAdminMenu } from "../support/nav";

/**
 * KI-Zugang: Admin vergibt und entzieht das Recht, ein Benutzer legt
 * Schlüssel an (Geheimnis genau einmal sichtbar), Herabsetzen wirkt auf die
 * angezeigte wirksame Stufe, Widerrufen durch Benutzer und Admin,
 * Verlauf (widerrufene/abgelaufene ausgeblendet, Schalter `?verlauf=1`) und
 * endgültiges Löschen (Verlauf und nie benutzte ja, aktiv benutzte nein).
 *
 * Alles Ändernde läuft mit einem eigens eingeladenen Benutzer, der am Ende
 * samt Schlüsseln gelöscht wird — die festen Mock-Benutzer und ihre
 * Schlüssel bleiben unverändert (andere Tests, u.a. der MCP-Endpunkt, bauen
 * darauf).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const email = `e2e-ki-${tag}@example.test`;
const keyUi = `E2E Schlüssel ${tag}`;
const keyApi = `E2E API-Schlüssel ${tag}`;
let userId: string;
let secret: string;

const userRow = (page: Page) => page.locator(`[data-testid="user-row"][data-email="${email}"]`);
const aiSelect = (page: Page) => userRow(page).getByRole("combobox", { name: `KI-Zugang von ${email}` });
const tokenRow = (page: Page, name: string) => page.getByTestId("ai-token").filter({ hasText: name });
const historyToggle = (page: Page) => page.getByRole("checkbox", { name: "Widerrufene und abgelaufene anzeigen (Verlauf)" });

/** Als der Wegwerf-Benutzer anmelden (eigener Browser-Kontext). */
async function asUser(loginAs: (role: null) => Promise<{ page: Page }>) {
  const { page } = await loginAs(null);
  await devLogin(page, email);
  await page.waitForURL(/\/tree/);
  return page;
}

async function setAiAccess(aiAccess: "NONE" | "READ" | "WRITE") {
  const api = await apiAs("admin");
  const res = await api.put(`/api/users/${userId}/ai-access`, { data: { aiAccess } });
  expect(res.status(), await res.text()).toBe(200);
  await api.dispose();
}

test.beforeAll(async () => {
  const api = await apiAs("admin");
  const res = await api.post("/api/users", { data: { email, role: "VIEWER" } });
  expect(res.status(), await res.text()).toBe(201);
  userId = (await res.json()).id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  // Löschen entfernt die Schlüssel mit (onDelete: Cascade).
  if (userId) expect([200, 404]).toContain((await api.delete(`/api/users/${userId}`)).status());
  const users = (await (await api.get("/api/users")).json()) as { email: string }[];
  expect(users.filter((u) => u.email === email)).toEqual([]);
  const tokens = (await (await api.get("/api/ai-tokens?all=1")).json()) as { tokens: { name: string }[] };
  expect(tokens.tokens.filter((t) => t.name.includes(tag))).toEqual([]);
  // Die festen Schlüssel sind unberührt.
  const editor = (await (await api.get("/api/ai-tokens?all=1&userId=mock-user-editor")).json()) as {
    tokens: { id: string; status: string }[];
  };
  expect(Object.fromEntries(editor.tokens.map((t) => [t.id, t.status]))).toEqual({
    "mock-token-editor-write": "ACTIVE",
    "mock-token-editor-read": "ACTIVE",
    "mock-token-editor-revoked": "REVOKED",
    "mock-token-editor-expired": "EXPIRED",
  });
  await api.dispose();
});

test("ohne Recht: Seite erklärt die Lage, kein Menüpunkt", async ({ loginAs }) => {
  const page = await asUser(loginAs);
  await openAdminMenu(page);
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "KI-Zugang" })).toHaveCount(0);
  await page.goto("/ai-access");
  await expect(page.getByRole("heading", { level: 1, name: "KI-Zugang" })).toBeVisible();
  await expect(page.getByTestId("ai-access-level")).toHaveText("kein Zugang");
  await expect(page.getByTestId("ai-access-info")).toContainText("Ein Administrator kann ihn in der Benutzerverwaltung vergeben");
  await expect(page.getByRole("form", { name: "Neuen Schlüssel anlegen" })).toHaveCount(0);
  await expect(page.getByTestId("ai-token-empty")).toContainText("Noch keine Schlüssel.");
});

test("Admin vergibt Lesezugriff — gespeichert", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByTestId("ai-access-hint")).toContainText("auch Administratoren haben ihn sonst nicht");
  await expect(aiSelect(page)).toHaveValue("NONE");
  await aiSelect(page).selectOption({ label: "lesen" });
  await expect(page.getByText(`KI-Zugang von ${email}: lesen.`)).toBeVisible();
  await page.reload();
  await expect(aiSelect(page)).toHaveValue("READ");

  const api = await apiAs("admin");
  const users = (await (await api.get("/api/users")).json()) as { email: string; aiAccess: string; activeTokens: number }[];
  expect(users.find((u) => u.email === email)).toMatchObject({ aiAccess: "READ", activeTokens: 0 });
  await api.dispose();
});

test("nur lesend: Schreibstufe nicht wählbar", async ({ loginAs }) => {
  const page = await asUser(loginAs);
  await openAdminMenu(page);
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "KI-Zugang" }).click();
  await expect(page).toHaveURL(/\/ai-access$/);
  await expect(page.getByTestId("ai-access-level")).toHaveText("lesen");
  const level = page.getByLabel("Stufe");
  await expect(level).toHaveValue("READ");
  await expect(level.locator('option[value="WRITE"]')).toBeDisabled();
  await expect(page.getByText("Dein KI-Zugang erlaubt nur Lesen.")).toBeVisible();

  // Auch an der Oberfläche vorbei nicht.
  const res = await page.request.post("/api/ai-tokens", { data: { name: `E2E verboten ${tag}`, level: "WRITE" } });
  expect(res.status()).toBe(403);
});

test("Schlüssel anlegen: Geheimnis genau einmal sichtbar", async ({ loginAs }) => {
  await setAiAccess("WRITE");
  const page = await asUser(loginAs);
  await page.goto("/ai-access");
  await expect(page.getByTestId("ai-access-level")).toHaveText("lesen und schreiben");
  await expect(page.getByTestId("ai-token-count")).toHaveText("0 aktive Schlüssel von höchstens 10.");

  // Prüfung am Feld.
  await page.getByRole("button", { name: "Schlüssel anlegen" }).click();
  await expect(page.locator("#ai-token-name-error")).toHaveText("Bitte einen Namen angeben.");

  await page.getByLabel("Name des Schlüssels").fill(keyUi);
  await page.getByLabel("Stufe").selectOption({ label: "lesen und schreiben" });
  await page.getByLabel("Gültig (Tage)").fill("30");
  await page.getByRole("button", { name: "Schlüssel anlegen" }).click();

  const panel = page.getByTestId("ai-secret-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(`Schlüssel „${keyUi}“ angelegt.`);
  await expect(panel).toContainText("Nur jetzt sichtbar.");
  secret = await page.getByTestId("ai-secret").inputValue();
  expect(secret).toMatch(/^ftk_[0-9a-f]{12}_\S+$/);
  await expect(panel.getByRole("textbox", { name: "Adresse der MCP-Schnittstelle", exact: true })).toHaveValue(`${new URL(page.url()).origin}/api/mcp`);
  await expect(panel.getByRole("textbox", { name: "Anmeldung per HTTP-Header", exact: true })).toHaveValue(`Authorization: Bearer ${secret}`);
  await expect(panel.getByRole("textbox", { name: "Beispiel für Claude Code", exact: true })).toHaveValue(
    new RegExp(`^claude mcp add --transport http .*/api/mcp .*Bearer ${secret}`),
  );
  await expect(panel).toContainText("siehe README");

  // In der Liste mit erkennbarem Anfang, ohne Geheimnis.
  const prefix = secret.slice(0, 16);
  const row = tokenRow(page, keyUi);
  await expect(row.getByTestId("ai-token-prefix")).toHaveText(`${prefix}…`);
  await expect(row.getByTestId("ai-token-status")).toHaveText("aktiv");
  await expect(row.getByTestId("ai-token-level")).toHaveText("Stufe: lesen und schreiben");
  await expect(page.getByTestId("ai-token-count")).toHaveText("1 aktiver Schlüssel von höchstens 10.");

  // Nirgends abgelegt …
  expect(page.url()).not.toContain(secret);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(secret);
  // … und nach dem Neuladen weg.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "KI-Zugang" })).toBeVisible();
  await expect(page.getByTestId("ai-secret-panel")).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
  await expect(tokenRow(page, keyUi).getByTestId("ai-token-prefix")).toHaveText(`${prefix}…`);

  // API: Liste ohne Geheimnis und ohne Hash.
  const list = await page.request.get("/api/ai-tokens");
  const text = await list.text();
  expect(text).not.toContain("secretHash");
  expect(text).not.toContain(secret);

  // Ein zweiter Schlüssel über die API — Antwort nur hier mit Geheimnis, nicht zwischengespeichert.
  const created = await page.request.post("/api/ai-tokens", { data: { name: keyApi, level: "WRITE" } });
  expect(created.status()).toBe(201);
  expect(created.headers()["cache-control"]).toContain("no-store");
  const body = await created.json();
  expect(Object.keys(body).sort()).toEqual(["secret", "token"]);
  expect(JSON.stringify(body)).not.toContain("secretHash");
  expect(body.token.prefix).toBe(body.secret.slice(0, 16));
});

test("Herabsetzen wirkt sofort auf die wirksame Stufe", async ({ page, loginAs }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.goto("/admin/users");
  await expect(userRow(page).getByTestId("user-ai-keys-toggle")).toContainText("2 aktiv");
  await aiSelect(page).selectOption({ label: "lesen" });
  await expect(
    page.getByText(`KI-Zugang von ${email}: lesen. Schlüssel mit Schreibrecht wirken ab sofort nur noch lesend.`),
  ).toBeVisible();
  expect(dialogs).toEqual([]);

  const user = await asUser(loginAs);
  await user.goto("/ai-access");
  await expect(tokenRow(user, keyUi).getByTestId("ai-token-level")).toHaveText("Stufe: lesen und schreiben");
  await expect(tokenRow(user, keyUi).getByTestId("ai-token-effective")).toHaveText(
    "Wirkt derzeit nur: lesen (dein KI-Zugang ist niedriger).",
  );

  // Entziehen fragt nach und nennt die Folgen.
  await aiSelect(page).selectOption({ label: "kein Zugang" });
  await expect(page.getByText(`KI-Zugang von ${email}: kein Zugang. Die vorhandenen Schlüssel funktionieren ab sofort nicht mehr.`)).toBeVisible();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain(`KI-Zugang von ${email} entziehen?`);
  expect(dialogs[0]).toContain("2 aktive Schlüssel funktionieren dann sofort nicht mehr");
  await expect(aiSelect(page)).toHaveValue("NONE");

  await user.reload();
  await expect(user.getByTestId("ai-access-level")).toHaveText("kein Zugang");
  await expect(tokenRow(user, keyUi).getByTestId("ai-token-effective")).toHaveText(
    "Wirkt derzeit nicht — du hast keinen KI-Zugang.",
  );
  await expect(user.getByRole("form", { name: "Neuen Schlüssel anlegen" })).toHaveCount(0);
  // Mit noch nicht widerrufenen Schlüsseln bleibt der Menüpunkt, damit man sie widerrufen kann.
  await openAdminMenu(user);
  await expect(user.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "KI-Zugang" })).toBeVisible();
});

test("Widerrufen: als Benutzer und als Admin — danach im ausgeblendeten Verlauf", async ({ page, loginAs }) => {
  const user = await asUser(loginAs);
  const userDialogs: string[] = [];
  user.on("dialog", (d) => {
    userDialogs.push(d.message());
    void d.accept();
  });
  await user.goto("/ai-access");
  await expect(historyToggle(user)).toHaveCount(0); // nichts ausgeblendet
  await tokenRow(user, keyUi).getByRole("button", { name: `Schlüssel ${keyUi} widerrufen` }).click();
  await expect(user.getByRole("status")).toHaveText(
    `Schlüssel „${keyUi}“ widerrufen. Er steht jetzt im ausgeblendeten Verlauf.`,
  );
  expect(userDialogs[0]).toContain(`Schlüssel „${keyUi}“`);
  // Standardmäßig ausgeblendet, mit Zähler.
  await expect(tokenRow(user, keyUi)).toHaveCount(0);
  await expect(user.getByTestId("ai-token-hidden-count")).toHaveText("1 ausgeblendet");
  await expect(historyToggle(user)).not.toBeChecked();
  await historyToggle(user).check();
  await expect(user).toHaveURL(/[?&]verlauf=1/);
  await expect(user.getByTestId("ai-token-hidden-count")).toHaveText("1 im Verlauf");
  const history = user.getByRole("list", { name: "Verlauf: Deine Schlüssel" });
  await expect(history.getByTestId("ai-token")).toHaveCount(1);
  await expect(tokenRow(user, keyUi).getByTestId("ai-token-status")).toHaveText("widerrufen");
  await expect(tokenRow(user, keyUi)).toHaveAttribute("data-status", "REVOKED");
  await expect(tokenRow(user, keyUi).getByRole("button", { name: /widerrufen/ })).toHaveCount(0);
  await expect(tokenRow(user, keyUi).getByRole("button", { name: `Schlüssel ${keyUi} löschen` })).toBeVisible();
  // Der Schalter überlebt das Neuladen (Adresse).
  await user.reload();
  await expect(historyToggle(user)).toBeChecked();
  await expect(tokenRow(user, keyUi)).toBeVisible();
  await historyToggle(user).uncheck();
  await expect(user).not.toHaveURL(/verlauf=/);
  await expect(tokenRow(user, keyUi)).toHaveCount(0);

  // Admin: Schlüssel des Benutzers einsehen und den zweiten widerrufen.
  page.on("dialog", (d) => void d.accept());
  await page.goto("/admin/users");
  const toggle = userRow(page).getByRole("button", { name: `Schlüssel von ${email}: 1 aktiv` });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const keys = page.getByTestId("user-ai-keys");
  await expect(keys.getByTestId("ai-token")).toHaveCount(1);
  await expect(keys.getByTestId("ai-token-hidden-count")).toHaveText("1 ausgeblendet");
  await expect(tokenRow(page, keyApi).getByTestId("ai-token-effective")).toHaveText(
    "Wirkt derzeit nicht — der Benutzer hat keinen KI-Zugang.",
  );
  await keys.getByRole("button", { name: `Schlüssel ${keyApi} widerrufen` }).click();
  await expect(page.getByText(`Schlüssel „${keyApi}“ von ${email} widerrufen.`)).toBeVisible();
  await expect(keys.getByTestId("ai-token-none-active")).toHaveText("Keine aktiven Schlüssel.");
  await expect(keys.getByTestId("ai-token-hidden-count")).toHaveText("2 ausgeblendet");
  await expect(userRow(page).getByTestId("user-ai-keys-toggle")).toContainText("0 aktiv");
  await historyToggle(page).check();
  await expect(page).toHaveURL(/[?&]verlauf=1/);
  await expect(keys.getByTestId("ai-token")).toHaveCount(2);
  await expect(tokenRow(page, keyApi).getByTestId("ai-token-status")).toHaveText("widerrufen");
  await expect(tokenRow(page, keyUi).getByTestId("ai-token-status")).toHaveText("widerrufen");
  await expectNoA11yViolations(page);

  // Ohne Recht und ohne aktive Schlüssel verschwindet der Menüpunkt.
  await user.reload();
  await openAdminMenu(user);
  await expect(user.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "KI-Zugang" })).toHaveCount(0);
});

test("Löschen: Verlauf und nie benutzte ja, aktiv benutzte erst nach Widerruf", async ({ page, loginAs }) => {
  await setAiAccess("READ");
  const user = await asUser(loginAs);
  const dialogs: string[] = [];
  user.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept();
  });

  // Zwei neue Schlüssel: einer bleibt unbenutzt, einer wird über MCP benutzt.
  const unused = `E2E unbenutzt ${tag}`;
  const used = `E2E benutzt ${tag}`;
  expect((await user.request.post("/api/ai-tokens", { data: { name: unused, level: "READ" } })).status()).toBe(201);
  const usedRes = await user.request.post("/api/ai-tokens", { data: { name: used, level: "READ" } });
  expect(usedRes.status()).toBe(201);
  const usedBody = (await usedRes.json()) as { token: { id: string }; secret: string };
  const mcp = await user.request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${usedBody.secret}`, Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcp.status()).toBe(200);

  await user.goto("/ai-access");
  // Nie benutzt: löschen (= zugleich widerrufen) möglich.
  await tokenRow(user, unused).getByRole("button", { name: `Schlüssel ${unused} löschen` }).click();
  await expect(user.getByRole("status")).toHaveText(`Schlüssel „${unused}“ gelöscht.`);
  expect(dialogs.at(-1)).toContain(`Schlüssel „${unused}“`);
  expect(dialogs.at(-1)).toContain("endgültig löschen?");
  expect(dialogs.at(-1)).toContain("noch nie benutzt");
  await expect(tokenRow(user, unused)).toHaveCount(0);

  // Benutzt und aktiv: kein Löschknopf, die API lehnt ab (409).
  const usedRow = tokenRow(user, used);
  await expect(usedRow.getByTestId("ai-token-status")).toHaveText("aktiv");
  await expect(usedRow.getByRole("button", { name: `Schlüssel ${used} widerrufen` })).toBeVisible();
  await expect(usedRow.getByRole("button", { name: /löschen/ })).toHaveCount(0);
  const refused = await user.request.delete(`/api/ai-tokens/${usedBody.token.id}?endgueltig=1`);
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain("zuerst widerrufen");

  // Erst widerrufen, dann im Verlauf löschen.
  await usedRow.getByRole("button", { name: `Schlüssel ${used} widerrufen` }).click();
  await expect(user.getByRole("status")).toContainText(`Schlüssel „${used}“ widerrufen.`);
  await historyToggle(user).check();
  const history = user.getByRole("list", { name: "Verlauf: Deine Schlüssel" });
  await history.getByRole("button", { name: `Schlüssel ${used} löschen` }).click();
  await expect(user.getByRole("status")).toHaveText(`Schlüssel „${used}“ gelöscht.`);
  expect(dialogs.at(-1)).toContain("verschwindet damit auch aus dem Verlauf");
  await expect(tokenRow(user, used)).toHaveCount(0);
  await history.getByRole("button", { name: `Schlüssel ${keyUi} löschen` }).click();
  await expect(user.getByRole("status")).toHaveText(`Schlüssel „${keyUi}“ gelöscht.`);
  await expect(tokenRow(user, keyUi)).toHaveCount(0);
  await expect(user.getByTestId("ai-token-hidden-count")).toHaveText("1 im Verlauf");

  // Admin löscht im Verlauf des Benutzers (Schalter aus der Adresse).
  const adminDialogs: string[] = [];
  page.on("dialog", (d) => {
    adminDialogs.push(d.message());
    void d.accept();
  });
  await page.goto("/admin/users?verlauf=1");
  await userRow(page).getByTestId("user-ai-keys-toggle").click();
  const keys = page.getByTestId("user-ai-keys");
  await expect(historyToggle(page)).toBeChecked();
  await keys.getByRole("button", { name: `Schlüssel ${keyApi} löschen` }).click();
  await expect(page.getByText(`Schlüssel „${keyApi}“ von ${email} gelöscht.`)).toBeVisible();
  expect(adminDialogs.at(-1)).toContain(`von ${email} endgültig löschen?`);
  await expect(keys.getByTestId("ai-token")).toHaveCount(0);
  await expect(keys).toContainText("Noch keine Schlüssel angelegt.");

  const api = await apiAs("admin");
  const tokens = (await (await api.get(`/api/ai-tokens?all=1&userId=${userId}`)).json()) as { tokens: unknown[] };
  expect(tokens.tokens).toEqual([]);
  await api.dispose();
});

test("vorab angelegte Schlüssel: Status und gedeckelte Stufe", async ({ loginAs }) => {
  const { page } = await loginAs("editor");
  await page.goto("/ai-access");
  const byId = (id: string) => page.locator(`[data-testid="ai-token"][data-token-id="${id}"]`);
  // Widerrufene und abgelaufene sind ausgeblendet — mit Zähler.
  for (const id of ["mock-token-editor-revoked", "mock-token-editor-expired"]) await expect(byId(id)).toHaveCount(0);
  await expect(page.getByTestId("ai-token-hidden-count")).toHaveText("2 ausgeblendet");
  await historyToggle(page).check();
  await expect(page.getByTestId("ai-token-hidden-count")).toHaveText("2 im Verlauf");
  await expect(byId("mock-token-editor-revoked").getByTestId("ai-token-status")).toHaveText("widerrufen");
  await expect(byId("mock-token-editor-revoked")).toContainText(/widerrufen\s*1\.2\.2026/);
  await expect(byId("mock-token-editor-expired").getByTestId("ai-token-status")).toHaveText("abgelaufen");
  await expect(byId("mock-token-editor-expired")).toContainText(/abgelaufen\s*1\.3\.2026/);
  // Im Verlauf nur „löschen“ (hier nicht ausgelöst — feste Testschlüssel).
  for (const id of ["mock-token-editor-revoked", "mock-token-editor-expired"]) {
    await expect(byId(id).getByRole("button")).toHaveText(["löschen"]);
  }
  await expect(byId("mock-token-editor-write").getByTestId("ai-token-status")).toHaveText("aktiv");
  await expect(byId("mock-token-editor-write").getByTestId("ai-token-prefix")).toHaveText("ftk_00000000e001…");
  await expect(page.getByTestId("ai-token-count")).toHaveText("2 aktive Schlüssel von höchstens 10.");
  await expectNoA11yViolations(page);

  // Betrachter (Recht: lesen) mit einem Schlüssel der Stufe „lesen und schreiben“.
  const { page: viewer } = await loginAs("viewer");
  await viewer.goto("/ai-access");
  const capped = viewer.locator('[data-testid="ai-token"][data-token-id="mock-token-viewer-write"]');
  await expect(capped.getByTestId("ai-token-level")).toHaveText("Stufe: lesen und schreiben");
  await expect(capped.getByTestId("ai-token-effective")).toHaveText("Wirkt derzeit nur: lesen (dein KI-Zugang ist niedriger).");
  await expect(viewer.locator('[data-token-id="mock-token-viewer-read"]').getByTestId("ai-token-effective")).toHaveCount(0);
});

test("Betrachter ohne Adminrolle erreicht die Verwaltung nicht", async ({ loginAs }) => {
  const { page } = await loginAs("viewer");
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/tree(\?|$)/);
  await expect(page.getByRole("combobox", { name: /KI-Zugang von/ })).toHaveCount(0);

  const api = await apiAs("viewer");
  expect((await api.put("/api/users/mock-user-viewer/ai-access", { data: { aiAccess: "WRITE" } })).status()).toBe(403);
  expect((await api.put("/api/users/mock-user-nofamily/ai-access", { data: { aiAccess: "READ" } })).status()).toBe(403);
  expect((await api.get("/api/ai-tokens?all=1")).status()).toBe(403);
  expect((await api.get("/api/ai-tokens?all=1&userId=mock-user-editor")).status()).toBe(403);
  expect((await api.get("/api/users")).status()).toBe(403);
  // Fremde Schlüssel sind für Nicht-Admins unsichtbar (404) — und bleiben aktiv bzw. erhalten.
  expect((await api.delete("/api/ai-tokens/mock-token-editor-write")).status()).toBe(404);
  expect((await api.delete("/api/ai-tokens/mock-token-editor-revoked?endgueltig=1")).status()).toBe(404);
  const own = (await (await api.get("/api/ai-tokens")).json()) as { info: { aiAccess: string }; tokens: { userId: string }[] };
  expect(own.info.aiAccess).toBe("READ");
  expect(new Set(own.tokens.map((t) => t.userId))).toEqual(new Set(["mock-user-viewer"]));
  await api.dispose();
});

test("API liefert nie secretHash", async () => {
  const api = await apiAs("admin");
  for (const url of ["/api/ai-tokens", "/api/ai-tokens?all=1", "/api/ai-tokens?all=1&userId=mock-user-editor", "/api/users"]) {
    const res = await api.get(url);
    expect(res.status(), url).toBe(200);
    const text = await res.text();
    expect(text, url).not.toContain("secretHash");
    expect(text, url).not.toMatch(/ftk_[0-9a-f]{12}_/);
  }
  const all = (await (await api.get("/api/ai-tokens?all=1")).json()) as { tokens: Record<string, unknown>[] };
  expect(all.tokens.length).toBeGreaterThanOrEqual(9);
  for (const t of all.tokens) {
    expect(Object.keys(t).sort()).toEqual(
      ["createdAt", "expiresAt", "id", "kind", "lastUsedAt", "level", "name", "prefix", "revokedAt", "status", "user", "userId"],
    );
  }
  await api.dispose();
});

test.describe("Telefon (390 px)", () => {
  test.use({ storageState: authFile("editor"), viewport: { width: 390, height: 844 } });

  test("KI-Zugang ohne waagerechte Scrollleiste", async ({ page }) => {
    await page.goto("/ai-access");
    await expect(page.getByTestId("ai-token").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Verlauf: Schalter und Löschknopf sind Tippziele, keine Scrollleiste", async ({ page }) => {
    await page.goto("/ai-access?verlauf=1");
    const revoked = page.locator('[data-testid="ai-token"][data-token-id="mock-token-editor-revoked"]');
    await expect(revoked).toBeVisible();
    const label = page.locator("label").filter({ has: historyToggle(page) });
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const box = (await revoked.getByRole("button", { name: /löschen$/ }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);
  });
});
