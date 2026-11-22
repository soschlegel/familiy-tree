import type { Page } from "@playwright/test";

import { test, expect, authFile, expectNoHorizontalOverflow, waitForTree } from "../support/fixtures";
import { L } from "../support/mock";

/**
 * Telefonbreite: Die Seite selbst darf nicht waagerecht scrollen, die
 * Navigation muss erreichbar sein, und Eingabefelder brauchen mindestens
 * 16 px Schrift (darunter vergrößert iOS beim Antippen die ganze Seite).
 * Nur lesend — es wird nichts angelegt oder geändert.
 */
const [dupKeep, dupOther] = L.duplicates[0];

const PAGES: { name: string; url: string; heading: string | RegExp }[] = [
  { name: "Baum (Fokus)", url: "/tree", heading: "Stammbaum" },
  { name: "Baum (Generationen)", url: "/tree?view=generations", heading: "Stammbaum" },
  { name: "Personenliste", url: "/people", heading: "Personen" },
  { name: "Personenseite", url: `/people/${L.founders.A}`, heading: /.+/ },
  { name: "Person bearbeiten", url: `/people/${L.founders.A}/edit`, heading: /.+/ },
  { name: "Person anlegen", url: "/people/new", heading: /.+/ },
  { name: "Personen zusammenführen", url: `/people/merge?keep=${dupKeep}&other=${dupOther}`, heading: "Personen zusammenführen" },
  { name: "Quellenliste", url: "/sources", heading: "Quellen" },
  { name: "Quelle", url: `/sources/${L.sources.churchBookA}`, heading: /.+/ },
  { name: "Quelle anlegen", url: "/sources/new", heading: /.+/ },
  { name: "Recherche", url: "/research", heading: "Recherche" },
  { name: "Mögliche Dubletten", url: "/research/duplicates", heading: "Mögliche Dubletten" },
  { name: "Importe verbinden", url: "/research/connect", heading: /.+/ },
  { name: "Benutzer", url: "/admin/users", heading: "Benutzer" },
  { name: "Familien und Zugriffe", url: "/admin/families", heading: "Familien und Zugriffe" },
  { name: "Änderungen", url: "/admin/changes", heading: "Änderungen" },
  { name: "Daten", url: "/admin/data", heading: /.+/ },
  { name: "KI-Zugang", url: "/ai-access", heading: /.+/ },
];

/** Der Menü-Knopf ist sichtbar, groß genug zum Antippen und öffnet das Menü. */
async function expectNavigationReachable(page: Page) {
  const toggle = page.getByRole("button", { name: "Menü" });
  await expect(toggle).toBeInViewport();
  const box = (await toggle.boundingBox())!;
  expect(box.height, "Höhe des Menü-Knopfs").toBeGreaterThanOrEqual(44);
  expect(box.width, "Breite des Menü-Knopfs").toBeGreaterThanOrEqual(44);
  // Erst nach der Hydration reagiert der Knopf — daher wiederholen.
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.locator("#mobile-menu")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const link = page.locator("#mobile-menu").getByRole("link", { name: "Personen", exact: true });
  await expect(link).toBeInViewport();
  expect((await link.boundingBox())!.height, "Höhe eines Menüpunkts").toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobile-menu")).toBeHidden();
}

/** Sichtbare Textfelder und Auswahllisten mit weniger als 16 px Schrift. */
async function smallFontFields(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea",
      ),
    )
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.getAttribute("name") || el.getAttribute("aria-label") || "?"}`),
  );
}

test.describe("Telefon (390 px), als Admin", () => {
  test.use({ storageState: authFile("admin"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const p of PAGES) {
    test(`${p.name}: kein waagerechtes Scrollen, Navigation erreichbar`, async ({ page }) => {
      await page.goto(p.url);
      await expect(page.getByRole("heading", { level: 1, name: p.heading }).first()).toBeVisible();
      if (p.url.startsWith("/tree")) await waitForTree(page);
      await expectNoHorizontalOverflow(page);
      expect(await smallFontFields(page), "Felder mit weniger als 16 px Schrift").toEqual([]);
      await expectNavigationReachable(page);
      // Auch mit offenem und wieder geschlossenem Menü bleibt die Breite stehen.
      await expectNoHorizontalOverflow(page);
    });
  }

  test("KI-Zugang: Anleitung für Claude auf dem Handy ist aufgeklappt und passt", async ({ page }) => {
    await page.goto("/ai-access");
    const guide = page.getByTestId("ai-guide-mobile");
    await expect(guide).toHaveAttribute("open", "");
    await expect(guide).toContainText("Add custom connector");
    // In der Mock-Umgebung ist keine Connector-Adresse hinterlegt.
    await expect(guide.getByTestId("ai-connector-url-missing")).toBeVisible();
    await expect(page.getByTestId("ai-guide-code")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Benutzer und Zugriffe: Tabellen passen ohne seitliches Verschieben", async ({ page }) => {
    for (const url of ["/admin/users", "/admin/families"]) {
      await page.goto(url);
      const table = page.locator("table").first();
      await expect(table).toBeVisible();
      const fit = await table.evaluate((el) => {
        const box = el.parentElement!;
        return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth };
      });
      expect(fit.scrollWidth, `${url}: Breite der Tabelle im Rahmen`).toBeLessThanOrEqual(fit.clientWidth + 1);
    }
    // Die Aktionen der Benutzerzeile liegen im sichtbaren Bereich.
    await page.goto("/admin/users");
    const row = page.getByTestId("user-row").filter({ hasText: "viewer@example.test" });
    const del = row.getByRole("button", { name: "viewer@example.test löschen" });
    await del.scrollIntoViewIfNeeded();
    const box = (await del.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("Baum: Bedienelemente sind Tippziele, eine Karte lässt sich antippen", async ({ page }) => {
    await page.goto("/tree");
    const tree = await waitForTree(page);
    const controls = {
      "Zoom +": page.locator(".react-flow__controls-zoomin"),
      "Alles einpassen": page.locator(".react-flow__controls-fitview"),
      Legende: page.getByRole("button", { name: /Legende/ }),
      "Ansicht Generationen": page.getByTestId("tree-view-generations"),
      "Tiefe Vorfahren": page.getByTestId("tree-depth-up"),
    };
    for (const [name, control] of Object.entries(controls)) {
      const box = (await control.boundingBox())!;
      expect(Math.round(box.height), `Höhe von „${name}“`).toBeGreaterThanOrEqual(42);
      expect(box.x + box.width, `rechter Rand von „${name}“`).toBeLessThanOrEqual(390);
    }
    // Antippen einer anderen Karte stellt diese Person in den Mittelpunkt.
    const before = await tree.getAttribute("data-focus-id");
    let tapped = false;
    for (const card of await page.getByTestId("tree-person").all()) {
      const box = await card.boundingBox();
      const id = await card.getAttribute("data-person-id");
      if (!box || !id || id === before) continue;
      // Ein Punkt der Karte, der im Bild liegt (nicht am Ecksymbol rechts oben,
      // nicht unter Fokus-Verlauf, Legende oder Zoom-Knöpfen).
      const x = Math.min(Math.max(box.x + box.width * 0.45, 16), 374);
      const y = box.y + box.height * 0.6;
      if (x < box.x + 4 || x > box.x + box.width * 0.75 || y < 330 || y > 700) continue;
      await page.touchscreen.tap(x, y);
      tapped = true;
      break;
    }
    expect(tapped, "keine antippbare Karte im Bild").toBe(true);
    await expect(tree).not.toHaveAttribute("data-focus-id", before!);
    await expect(tree).toHaveAttribute("aria-busy", "false");
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("kleines Telefon (360 px), als Betrachter", () => {
  test.use({ storageState: authFile("viewer"), viewport: { width: 360, height: 740 }, hasTouch: true });

  for (const url of ["/tree", "/people", `/people/${L.founders.A}`, "/research", "/admin/data"]) {
    test(`${url}: kein waagerechtes Scrollen, Navigation erreichbar`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNavigationReachable(page);
    });
  }

  test("Baumseite füllt genau den Bildschirm (kein senkrechtes Scrollen)", async ({ page }) => {
    await page.goto("/tree");
    await waitForTree(page);
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(scroll).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("build-info")).toBeInViewport();
  });
});

test.describe("Telefon (390 px), ohne Anmeldung", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, hasTouch: true });

  test("Anmeldeseite: kein waagerechtes Scrollen, Feld mit 16 px Schrift", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await smallFontFields(page)).toEqual([]);
  });

  test("Mindesthöhe der Seite ist die sichtbare Höhe (dvh), nicht vh", async ({ page }) => {
    // Im Test-Browser sind vh und dvh gleich groß; auf Android (Edge) ist vh
    // um die Browserleiste größer. Deshalb hier die Regel selbst prüfen: Die
    // zuletzt wirksame min-height von <body> muss dvh sein.
    await page.goto("/login");
    const minHeights = await page.evaluate(() => {
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule) || !document.body.matches(rule.selectorText)) continue;
          if (rule.style.minHeight) out.push(rule.style.minHeight);
        }
      }
      return out;
    });
    expect(minHeights.at(-1), `min-height-Regeln für body: ${minHeights.join(", ")}`).toBe("100dvh");
  });

  test("kurze Seite: Fußzeile sitzt am unteren Rand, auch wenn das Fenster wächst", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
    const footer = page.locator("footer");
    // Wächst wie beim Ausblenden der Adressleiste auf Android.
    for (const height of [844, 920]) {
      await page.setViewportSize({ width: 390, height });
      await expect
        .poll(async () => {
          const box = (await footer.boundingBox())!;
          return Math.round(box.y + box.height);
        }, { message: `Unterkante der Fußzeile bei ${height} px` })
        .toBe(height);
    }
  });
});
