import { expect, type Page } from "@playwright/test";

export const mainNav = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" });

/**
 * Klappt auf breiten Bildschirmen das Untermenü „Verwaltung“ auf (Familien,
 * Benutzer, Änderungen, KI-Zugang). Gibt es keins (keine solchen Menüpunkte
 * für diese Rolle), passiert nichts. Erst nach der Hydration reagiert der
 * Knopf — daher wiederholen.
 */
export async function openAdminMenu(page: Page): Promise<void> {
  const toggle = mainNav(page).getByRole("button", { name: "Verwaltung" });
  if (!(await toggle.isVisible())) return;
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.locator("#admin-menu")).toBeVisible({ timeout: 1_000 });
  }).toPass();
}
