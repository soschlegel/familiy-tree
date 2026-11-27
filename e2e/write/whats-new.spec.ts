import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { test, expect, devLogin, expectNoA11yViolations, expectNoHorizontalOverflow, waitForStartPage } from "../support/fixtures";
import { apiAs, uniq } from "../support/api";
import { parseReleaseNotes, WHATS_NEW_LIMIT } from "../../lib/release-notes";

/**
 * Fenster „Was ist neu?“ (docs/entwicklung/neuigkeiten.md) mit einem eigenen,
 * eingeladenen Benutzer — die Mock-Benutzer bleiben unberührt, damit
 * parallel laufende Tests nie ein unerwartetes Fenster sehen.
 *
 * - Eingeladene Benutzer starten beim neuesten Release: kein Fenster.
 * - Lesemarke auf ein älteres Release zurückgesetzt (PUT
 *   /api/me/release-seen): beim nächsten Laden erscheint das Fenster mit den
 *   Releases seither, höchstens drei, der Rest als Hinweis.
 * - Escape schließt und merkt das neueste; danach kein Fenster mehr.
 * - „Alle Neuigkeiten“ führt zur Seite und merkt ebenfalls.
 */
test.describe.configure({ mode: "serial" });

const releases = parseReleaseNotes(readFileSync(path.join(__dirname, "..", "..", "CHANGELOG.md"), "utf8")).releases;
const email = `e2e-neu-${uniq()}@example.test`;

test.beforeAll(async () => {
  const api = await apiAs("admin");
  const res = await api.post("/api/users", { data: { email, role: "VIEWER" } });
  expect(res.status(), await res.text()).toBe(201);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await apiAs("admin");
  const users = (await (await api.get("/api/users")).json()) as { id: string; email: string }[];
  for (const u of users.filter((x) => x.email === email)) await api.delete(`/api/users/${u.id}`);
  await api.dispose();
});

async function login(page: Page) {
  await devLogin(page, email);
  await waitForStartPage(page);
}

/** Lesemarke des angemeldeten Benutzers setzen (wie „Gelesen“, nur mit beliebigem Release). */
async function setSeen(page: Page, releaseId: string) {
  const res = await page.request.put("/api/me/release-seen", { data: { releaseId } });
  expect(res.status(), await res.text()).toBe(200);
}

function seenSaved(page: Page) {
  return page.waitForResponse((r) => r.url().endsWith("/api/me/release-seen") && r.request().method() === "PUT");
}

test("neu eingeladen: kein Fenster; ältere Lesemarke: Fenster mit den Releases seither", async ({ loginAs }) => {
  test.skip(releases.length < 2, "braucht mindestens zwei Releases in CHANGELOG.md");
  const { page } = await loginAs(null);
  await login(page);
  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1, name: "Personen" })).toBeVisible();
  await expect(page.getByTestId("whats-new")).toHaveCount(0);

  // Ein Release zurück: genau das neueste erscheint.
  await setSeen(page, releases[1].id);
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Was ist neu?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("release")).toHaveCount(1);
  await expect(dialog.getByTestId("release").first()).toHaveAttribute("data-release-id", releases[0].id);
  await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(releases[0].title);
  await expect(dialog.getByTestId("whats-new-more")).toHaveCount(0);
  // Fokus im Fenster, auf „Gelesen“.
  await expect(dialog.getByRole("button", { name: "Gelesen" })).toBeFocused();
  await expectNoA11yViolations(page);

  // Escape schließt und merkt das neueste.
  const saved = seenSaved(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Personen" })).toBeVisible();
  await expect(page.getByTestId("whats-new")).toHaveCount(0);
});

test("ältestes Release gesehen: höchstens drei, Rest per Link; „Alle Neuigkeiten“ merkt ebenfalls", async ({ loginAs }) => {
  const { page } = await loginAs(null);
  await login(page);
  await setSeen(page, releases[releases.length - 1].id);
  await page.goto("/people");
  const dialog = page.getByRole("dialog", { name: "Was ist neu?" });
  await expect(dialog).toBeVisible();
  const newer = releases.length - 1;
  const shown = Math.min(newer, WHATS_NEW_LIMIT);
  await expect(dialog.getByTestId("release")).toHaveCount(shown);
  for (let i = 0; i < shown; i++) {
    await expect(dialog.getByTestId("release").nth(i)).toHaveAttribute("data-release-id", releases[i].id);
  }
  if (newer > shown) {
    await expect(dialog.getByTestId("whats-new-more")).toContainText(newer - shown === 1 ? "Eine weitere" : `${newer - shown} weitere`);
  } else await expect(dialog.getByTestId("whats-new-more")).toHaveCount(0);

  const saved = seenSaved(page);
  await dialog.getByRole("link", { name: "Alle Neuigkeiten" }).click();
  await expect(page).toHaveURL(/\/neuigkeiten$/);
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
  await expect(page.getByTestId("release")).toHaveCount(releases.length);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
  await expect(page.getByTestId("whats-new")).toHaveCount(0);
});

test("Telefon: Fenster passt, „Gelesen“ schließt und gibt die Seite frei", async ({ loginAs }) => {
  const { page } = await loginAs(null);
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);
  await setSeen(page, releases[releases.length - 1].id);
  await page.goto("/people");
  const dialog = page.getByRole("dialog", { name: "Was ist neu?" });
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const box = await dialog.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  const read = dialog.getByRole("button", { name: "Gelesen" });
  await expect(read).toBeInViewport();

  const saved = seenSaved(page);
  await read.click();
  await expect(dialog).toHaveCount(0);
  expect((await saved).status()).toBe(200);
  // Die Seite ist wieder bedienbar (nichts mehr im Weg).
  await page.getByRole("button", { name: "Menü" }).click();
  await expect(page.getByRole("link", { name: "Personen" }).first()).toBeVisible();
});
