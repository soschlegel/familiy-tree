import type { Page } from "@playwright/test";

import { test, expect, authFile, expectNoA11yViolations, expectNoHorizontalOverflow } from "../support/fixtures";
import { L, fullName, mock, person } from "../support/mock";

/**
 * „Wie sind wir verwandt?“ (/kinship): Auswahl zweier Personen, Ergebnis in
 * Worten, Zeichnung mit verlinkten Karten, Tauschen, Einstieg von der
 * Personenseite und unter „Recherche“, streng wie der Baum (Verbindung nur
 * über gesperrte Personen = Hinweis wie auf der Personenseite), Telefonbreite.
 * Nur lesend.
 */
const SELF = L.selfEditor;
const COUSIN = L.kinshipHidden.cousin;
const AUNT = L.kinshipHidden.aunt;

const bioParents = (id: string) =>
  mock.relationships
    .filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.toPersonId === id)
    .map((r) => r.fromPersonId);
const bioChildren = (id: string) =>
  mock.relationships
    .filter((r) => r.type === "PARENT_OF" && r.subtype === "BIOLOGICAL" && r.fromPersonId === id)
    .map((r) => r.toPersonId);
const GRANDPARENTS_MATERNAL = bioParents(AUNT);

/** Cousin/Cousine von SELF über den Vater (Familie A, für den Betrachter sichtbar). */
const FATHER = bioParents(SELF).find((p) => person(p).gender === "MALE")!;
const PATERNAL_COUSIN = bioParents(FATHER)
  .flatMap(bioChildren)
  .filter((sib) => sib !== FATHER && bioParents(sib).length === 2)
  .flatMap(bioChildren)
  .find((c) => person(c).familyKeys.includes("A") && bioParents(c).length === 2)!;

const visibleCards = (page: Page) => page.locator('[data-testid="kinship-card"]:visible');

/** Wortlaut wie auf der Personenseite (components/ReferencePanel.tsx). */
const NO_KINSHIP = "keine Verwandtschaft über freigegebene Personen bekannt";

test.describe("als Bearbeiter", () => {
  test.use({ storageState: authFile("editor") });

  test("Verbindung nur über gesperrte Personen: derselbe Hinweis wie die Personenseite, nichts gezeichnet, Tauschen", async ({ page }) => {
    // Personenseite der Cousine aus Sicht der eigenen Person.
    await page.goto(`/people/${COUSIN}`);
    await expect(page.getByTestId("person-reference-term")).toContainText(NO_KINSHIP);
    await page.getByTestId("person-kinship-link").click();
    await expect(page).toHaveURL(new RegExp(`/kinship\\?a=${COUSIN}&b=${SELF}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Wie sind wir verwandt?" })).toBeVisible();
    await expect(page.getByTestId("kinship-selected-a")).toHaveText(fullName(COUSIN));
    await expect(page.getByTestId("kinship-selected-b")).toHaveText(fullName(SELF));

    // Streng wie der Baum: keine Verbindung über freigegebene Personen, keine Zeichnung.
    await expect(page.getByTestId("kinship-none")).toContainText(`${fullName(COUSIN)} und ${fullName(SELF)}: ${NO_KINSHIP}.`);
    await expect(page.getByTestId("kinship-result")).toHaveCount(0);
    await expect(page.getByTestId("kinship-diagram")).toHaveCount(0);
    await expect(page.getByTestId("kinship-card")).toHaveCount(0);

    // Nichts über die gesperrten Personen im Seitenquelltext.
    const html = await page.content();
    for (const id of [AUNT, ...GRANDPARENTS_MATERNAL]) {
      expect(html).not.toContain(id);
      expect(html).not.toContain(person(id).givenName);
    }

    // Tauschen: dasselbe Ergebnis.
    await page.getByTestId("kinship-swap").click();
    await expect(page).toHaveURL(new RegExp(`/kinship\\?a=${SELF}&b=${COUSIN}$`));
    await expect(page.getByTestId("kinship-selected-a")).toHaveText(fullName(SELF));
    await expect(page.getByTestId("kinship-none")).toContainText(NO_KINSHIP);

    // Kontexthilfe.
    await page.getByTestId("kinship-none").getByTestId("help-link").click();
    await expect(page).toHaveURL(/\/hilfe\/verwandtschaft#nicht-freigegebene-personen$/);
  });
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("zwei Personen über die Suche wählen, Cousins mit gemeinsamem Großelternpaar", async ({ page }) => {
    await page.goto("/research");
    await page.getByTestId("research-kinship").getByRole("link", { name: "Wie sind wir verwandt?" }).click();
    await expect(page).toHaveURL(/\/kinship$/);
    await expect(page.getByTestId("kinship-hint")).toBeVisible();

    const choose = async (slot: "a" | "b", id: string) => {
      const field = page.getByTestId(`kinship-field-${slot}`);
      await field.getByTestId(`kinship-search-${slot}`).fill(fullName(id));
      const year = person(id).birthDate ? String(person(id).birthDate!.getUTCFullYear()) : "";
      await field.getByRole("button", { name: new RegExp(`^${fullName(id)}.*${year}`) }).first().click();
      await expect(page).toHaveURL(new RegExp(`${slot}=${id}`));
    };
    await choose("a", SELF);
    await expect(page.getByTestId("kinship-hint")).toHaveText("Wähle noch die zweite Person.");
    await choose("b", PATERNAL_COUSIN);

    await expect(page.getByTestId("kinship-kind")).toHaveText("Blutsverwandt");
    await expect(page.getByTestId("kinship-b-for-a")).toContainText(/Cousine? 1\. Grades väterlicherseits/);
    await expect(page.getByTestId("kinship-degree")).toContainText("Gemeinsame Vorfahren");
    await expect(page.getByTestId("kinship-degree")).toContainText("Beide sind 2 Generationen");
    // Großelternpaar oben, je zwei Karten darunter.
    const diagram = page.getByTestId("kinship-diagram");
    await expect(diagram.getByText("Gemeinsame Vorfahren").first()).toBeVisible();
    await expect(visibleCards(page)).toHaveCount(6);
    // Screenreader-Liste nennt die Kette.
    await expect(diagram.locator(".sr-only li").first()).toHaveText(`Erste Person: ${fullName(SELF)}${person(SELF).birthDate ? ` (* ${person(SELF).birthDate!.getUTCFullYear()})` : ""}`);
    await visibleCards(page).filter({ hasText: fullName(PATERNAL_COUSIN) }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${PATERNAL_COUSIN}$`));
  });

  test("angeheiratet: Ehe-Schritt in der Kette", async ({ page }) => {
    await page.goto(`/kinship?a=${L.crossMarriedPartnerA}&b=${L.crossMarriedIntoA}`);
    await expect(page.getByTestId("kinship-kind")).toHaveText("Angeheiratet");
    await expect(page.getByTestId("kinship-b-for-a")).toContainText(/ist Ehe(frau|mann) von/);
    await expect(page.getByTestId("kinship-diagram").getByTestId("kinship-link").filter({ hasText: /Ehe(frau|mann)/ })).toBeVisible();
    await expect(visibleCards(page)).toHaveCount(2);
  });

  test("nicht sichtbare Person gilt als nicht gefunden, dieselbe Person, keine Verbindung", async ({ page }) => {
    await page.goto(`/kinship?a=${L.crossMarriedPartnerA}&b=${L.inLawOnlyB}`);
    await expect(page.getByTestId("kinship-notfound-b")).toBeVisible();
    await expect(page.getByTestId("kinship-result")).toHaveCount(0);
    expect(await page.content()).not.toContain(person(L.inLawOnlyB).givenName + " " + person(L.inLawOnlyB).familyName);

    await page.goto(`/kinship?a=${COUSIN}&b=${SELF}`);
    await expect(page.getByTestId("kinship-notfound-a")).toBeVisible();

    await page.goto(`/kinship?a=${SELF}&b=${SELF}`);
    await expect(page.getByTestId("kinship-same")).toBeVisible();
  });

  test("Telefonbreite: eine Spalte, kein waagerechtes Scrollen, Barrierefreiheit hell und dunkel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/kinship?a=${SELF}&b=${PATERNAL_COUSIN}`);
    await expect(page.getByTestId("kinship-result")).toBeVisible();
    // Kette als eine Spalte: erste Person zuoberst.
    await expect(visibleCards(page).first()).toContainText(fullName(SELF));
    await expectNoHorizontalOverflow(page);
    const box = await page.getByTestId("kinship-swap").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Farbschema vor dem Laden umstellen (sonst prüft axe mitten im Übergang).
    for (const [scheme, width] of [["light", 390], ["dark", 390], ["dark", 1280], ["light", 1280]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/kinship?a=${SELF}&b=${PATERNAL_COUSIN}`);
      await expect(page.getByTestId("kinship-result")).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });
});

test.describe("als Administrator", () => {
  test.use({ storageState: authFile("admin") });

  test("keine Verbindung erfasst: derselbe Hinweis", async ({ page }) => {
    const isolated = L.noFamily.find((id) => !mock.relationships.some((r) => r.fromPersonId === id || r.toPersonId === id))!;
    await page.goto(`/kinship?a=${L.founders.A}&b=${isolated}`);
    await expect(page.getByTestId("kinship-none")).toContainText(NO_KINSHIP);
    await expect(page.getByTestId("kinship-none")).toContainText("Das heißt nicht, dass die beiden nicht verwandt sind");
  });

  test("Administrator sieht die Cousine über alle Personen verbunden", async ({ page }) => {
    await page.goto(`/kinship?a=${COUSIN}&b=${SELF}`);
    await expect(page.getByTestId("kinship-kind")).toHaveText("Blutsverwandt");
    await expect(page.getByTestId("kinship-a-for-b")).toHaveText(`${fullName(COUSIN)} ist Cousine 1. Grades mütterlicherseits von ${fullName(SELF)}.`);
    const hrefs = await visibleCards(page).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
    expect(hrefs).toContain(`/people/${AUNT}`);
  });
});
