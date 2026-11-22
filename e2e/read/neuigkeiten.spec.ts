import { readFileSync } from "node:fs";
import path from "node:path";

import { test, expect, authFile, expectNoA11yViolations } from "../support/fixtures";
import { parseReleaseNotes } from "../../lib/release-notes";

/**
 * Neuigkeiten (CHANGELOG.md) lesend: Link in der Fußzeile, Seite mit allen
 * Releases, nur für Angemeldete — und die Mock-Benutzer sehen kein Fenster
 * „Was ist neu?“ (der Seed setzt das neueste Release als gesehen). Das
 * Fenster selbst prüft e2e/write/whats-new.spec.ts.
 */
const releases = parseReleaseNotes(readFileSync(path.join(__dirname, "..", "..", "CHANGELOG.md"), "utf8")).releases;

test.describe("Neuigkeiten", () => {
  test.use({ storageState: authFile("viewer") });

  test("Fußzeile verlinkt die Seite; sie zeigt alle Releases, neueste zuerst", async ({ page }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "Personen" })).toBeVisible();
    // Mock-Benutzer haben alles gesehen: kein Fenster.
    await expect(page.getByTestId("whats-new")).toHaveCount(0);

    await page.getByTestId("footer-news").click();
    await expect(page).toHaveURL(/\/neuigkeiten$/);
    await expect(page.getByRole("heading", { level: 1, name: "Neuigkeiten" })).toBeVisible();
    const shown = page.getByTestId("release");
    await expect(shown).toHaveCount(releases.length);
    await expect(shown.first()).toHaveAttribute("data-release-id", releases[0].id);
    await expect(shown.first().getByRole("heading", { level: 2 })).toHaveText(releases[0].title);
    await expect(shown.first().getByRole("listitem")).toHaveCount(releases[0].items.length);
    await expect(page.getByTestId("whats-new")).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("ohne Anmeldung: kein Link, Seite leitet zur Anmeldung", async ({ loginAs }) => {
    const { page } = await loginAs(null);
    await page.goto("/login");
    await expect(page.getByTestId("build-info")).toBeVisible();
    await expect(page.getByTestId("footer-news")).toHaveCount(0);
    await expect(page.getByTestId("whats-new")).toHaveCount(0);
    await page.goto("/neuigkeiten");
    await expect(page).toHaveURL(/\/login/);
  });

  test("API: ohne Anmeldung 401, unbekannte Kennung und fremde Felder 400", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const res = await anon.put("/api/me/release-seen", { data: { releaseId: releases[0].id } });
    expect(res.status()).toBe(401);
    await anon.dispose();

    const viewer = await playwright.request.newContext({ baseURL, storageState: authFile("viewer") });
    for (const data of [{ releaseId: "2000-01-01.1" }, { releaseId: "abc1234" }, {}, { releaseId: releases[0].id, userId: "mock-user-admin" }]) {
      const bad = await viewer.put("/api/me/release-seen", { data });
      expect(bad.status(), JSON.stringify(data)).toBe(400);
    }
    // Die gültige, schon gesehene Kennung erneut zu setzen ändert nichts am Stand.
    const ok = await viewer.put("/api/me/release-seen", { data: { releaseId: releases[0].id } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({ lastSeenReleaseId: releases[0].id });
    await viewer.dispose();
  });
});
