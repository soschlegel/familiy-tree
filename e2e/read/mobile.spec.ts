import type { Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow, waitForTree } from "../support/fixtures";
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
  { name: "Karte", url: "/map", heading: "Wurzeln nach Jahr" },
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
  { name: "Orte zuordnen", url: "/admin/places", heading: "Orte zuordnen" },
  { name: "Daten", url: "/admin/data", heading: /.+/ },
  { name: "KI-Zugang", url: "/ai-access", heading: /.+/ },
  { name: "Neuigkeiten", url: "/neuigkeiten", heading: "Neuigkeiten" },
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
    // Anmeldung: Header „Authorization“, Wert „Bearer <Schlüssel>“.
    const auth = page.getByTestId("ai-guide-auth");
    await expect(auth).toContainText("Authorization");
    await expect(auth).toContainText("Bearer ftk_…");
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

  test("Baum: Vollbild ein und aus — Knopf, Escape, Zurück, Karte antippen", async ({ page }) => {
    await page.goto("/tree");
    const tree = await waitForTree(page);
    const shell = page.getByTestId("tree-shell");
    const button = page.getByTestId("tree-fullscreen");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toHaveAccessibleName("Vollbild");
    const box = (await button.boundingBox())!;
    expect(Math.round(box.height), "Höhe des Knopfs „Vollbild“").toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(360);

    const enter = async () => {
      await button.click();
      await expect(page).toHaveURL(/[?&]vollbild=1/);
      await expect(shell).toHaveAttribute("data-fullscreen", "true");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button).toHaveAccessibleName("Vollbild beenden");
    };
    const expectNormal = async () => {
      await expect(shell).not.toHaveAttribute("data-fullscreen", "true");
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(page).not.toHaveURL(/vollbild=/);
      await expect(page.getByRole("toolbar", { name: "Baumansicht" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Stammbaum" })).toBeVisible();
    };

    // Ein: Baumfläche füllt den Bildschirm, Werkzeugleiste weg, Rest der Seite stillgelegt.
    await enter();
    await expect(page.getByRole("toolbar", { name: "Baumansicht" })).toBeHidden();
    const area = (await tree.boundingBox())!;
    expect(area.height, "Höhe der Baumfläche im Vollbild").toBeGreaterThanOrEqual(730);
    expect(area.width).toBeGreaterThanOrEqual(355);
    await expect(page.locator("footer")).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: /Legende/ })).toBeInViewport();
    await expectNoA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    // Escape beendet es.
    await page.keyboard.press("Escape");
    await expectNormal();
    await expect(page.locator("footer")).not.toHaveAttribute("inert", "");

    // Zurück beendet es, ohne die Baumseite zu verlassen.
    await enter();
    await page.goBack();
    await expectNormal();
    await expect(page).toHaveURL(/\/tree/);

    // Karte antippen: neue Fokusperson, das Vollbild bleibt; der Knopf beendet es.
    await enter();
    const before = await tree.getAttribute("data-focus-id");
    let tapped = false;
    for (const card of await page.getByTestId("tree-person").all()) {
      const cardBox = await card.boundingBox();
      const id = await card.getAttribute("data-person-id");
      if (!cardBox || !id || id === before) continue;
      const x = cardBox.x + cardBox.width * 0.4;
      const y = cardBox.y + cardBox.height * 0.6;
      // Nicht unter Fokus-Verlauf/Knopf oben und Legende/Zoom-Knöpfen unten.
      if (x < 8 || x > 352 || y < 90 || y > 650) continue;
      await page.touchscreen.tap(x, y);
      tapped = true;
      break;
    }
    expect(tapped, "keine antippbare Karte im Bild").toBe(true);
    await expect(tree).not.toHaveAttribute("data-focus-id", before!);
    await expect(tree).toHaveAttribute("aria-busy", "false");
    await expect(shell).toHaveAttribute("data-fullscreen", "true");
    await expect(page).toHaveURL(/[?&]vollbild=1/);
    const after = await tree.getAttribute("data-focus-id");
    await button.click();
    await expectNormal();
    await expect(tree).toHaveAttribute("data-focus-id", after!);
  });

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
    await expect(page.getByLabel("E-Mail-Adresse", { exact: true })).toBeVisible();
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
    // Die Anmeldeseite selbst ist mit E-Mail-Link und Dev-Login länger als
    // ein Telefonbildschirm; die Bestätigungsseite des E-Mail-Links ist kurz
    // und nutzt dasselbe Seitengerüst.
    await page.goto("/login/email");
    await expect(page.getByRole("heading", { name: "Mit E-Mail-Link anmelden" })).toBeVisible();
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
