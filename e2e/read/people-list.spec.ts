import { test, expect, authFile, waitForHydration } from "../support/fixtures";
import { FAMILY, familyName, fullName, mock, visibleFor } from "../support/mock";

/** Personenliste: Suche, Familienfilter, Sortierung, Seiten, Zählung. */
test.use({ storageState: authFile("admin") });

const TOTAL = mock.persons.length;
const PAGE = 40;

test("Zählung und Seiten", async ({ page }) => {
  await page.goto("/people");
  await expect(page.getByTestId("people-count")).toHaveText(`1–${PAGE} von ${TOTAL} Personen`);
  const list = page.getByTestId("people-list");
  await expect(list.getByRole("listitem")).toHaveCount(PAGE);

  const pager = page.getByRole("navigation", { name: "Seiten" });
  const pages = Math.ceil(TOTAL / PAGE);
  await expect(pager.getByRole("link", { name: /^Seite \d+$/ })).toHaveCount(pages);
  await expect(pager.getByRole("link", { name: "Seite 1" })).toHaveAttribute("aria-current", "page");

  await pager.getByRole("link", { name: "Seite 2" }).click();
  await expect(page).toHaveURL("/people?page=2");
  await expect(page.getByTestId("people-count")).toHaveText(`41–80 von ${TOTAL} Personen`);
  await expect(pager.getByRole("link", { name: "Seite 2" })).toHaveAttribute("aria-current", "page");

  await pager.getByRole("link", { name: "Weiter →" }).click();
  await expect(page).toHaveURL("/people?page=3");

  await pager.getByRole("link", { name: `Seite ${pages}` }).click();
  await expect(page.getByTestId("people-count")).toHaveText(`${(pages - 1) * PAGE + 1}–${TOTAL} von ${TOTAL} Personen`);
  await expect(list.getByRole("listitem")).toHaveCount(TOTAL - (pages - 1) * PAGE);
  await expect(pager.getByText("Weiter →")).toHaveAttribute("aria-hidden", "true");

  // Eine Seite jenseits des Endes zeigt die letzte.
  await page.goto("/people?page=99");
  await expect(page.getByTestId("people-count")).toHaveText(`${(pages - 1) * PAGE + 1}–${TOTAL} von ${TOTAL} Personen`);
});

test("Seite jenseits des Endes behält den Ortsfilter", async ({ page }) => {
  await page.goto("/people?place=Celle");
  const count = page.getByTestId("people-count");
  await expect(count).toHaveText(/ von \d+ Treffern$/);
  const hits = Number((await count.innerText()).match(/von (\d+) Treffern/)![1]);
  expect(hits).toBeGreaterThan(0);
  expect(hits).toBeLessThan(TOTAL);
  const lastPage = Math.ceil(hits / PAGE);
  const lastText = `${(lastPage - 1) * PAGE + 1}–${hits} von ${hits} Treffern`;

  await page.goto("/people?place=Celle&page=99");
  await expect(count).toHaveText(lastText);
  await expect(page.locator("#people-place")).toHaveValue("Celle");
});

test("Namenssuche", async ({ page }) => {
  const word = "Koch";
  const expected = mock.persons.filter((p) =>
    [p.givenName, p.familyName, p.birthName].some((v) => v?.toLowerCase().includes(word.toLowerCase())),
  );
  expect(expected.length).toBeGreaterThan(1);

  await page.goto("/people");
  await page.getByLabel("Name").fill(word);
  await page.getByLabel("Name").press("Enter");
  await expect(page).toHaveURL(new RegExp(`/people\\?q=${word}&`));
  await expect(page.getByTestId("people-count")).toHaveText(`1–${expected.length} von ${expected.length} Treffern`);
  const items = page.getByTestId("people-list").getByRole("listitem");
  await expect(items).toHaveCount(expected.length);
  for (const text of await items.allInnerTexts()) expect(text).toMatch(/Koch/);
  await expect(page.getByRole("navigation", { name: "Seiten" })).toHaveCount(0);

  // Zwei Wörter: beide müssen passen.
  const target = mock.persons.find((p) => p.familyName === "Koch")!;
  await page.getByLabel("Name").fill(`${target.givenName} ${target.familyName}`);
  await page.getByLabel("Name").press("Enter");
  await expect(items.first()).toContainText(fullName(target.id));

  await page.getByLabel("Name").fill("Gibtesnichtxyz");
  await page.getByLabel("Name").press("Enter");
  await expect(page.getByTestId("people-count")).toHaveText("Keine Treffer");
  await expect(page.getByText("Keine Person gefunden.")).toBeVisible();
  await page.getByRole("link", { name: "Filter zurücksetzen" }).click();
  await expect(page).toHaveURL("/people");
  await expect(page.getByTestId("people-count")).toHaveText(`1–${PAGE} von ${TOTAL} Personen`);
});

test("Familienfilter", async ({ page }) => {
  const inB = visibleFor(["B"]).length;
  await page.goto("/people");
  await page.getByLabel("Familie").selectOption({ label: familyName("B") });
  await expect(page).toHaveURL(new RegExp(`[?&]family=${FAMILY.B}(&|$)`));
  await expect(page.getByTestId("people-count")).toHaveText(`1–${PAGE} von ${inB} Treffern`);
  // Badge der Familie an jeder Karte.
  const short = familyName("B").replace(/^Familie /, "");
  for (const text of await page.getByTestId("people-list").getByRole("listitem").allInnerTexts()) {
    expect(text).toContain(short);
  }
  // Filter und Seite zusammen.
  await page.getByRole("navigation", { name: "Seiten" }).getByRole("link", { name: "Seite 2" }).click();
  await expect(page).toHaveURL(`/people?family=${FAMILY.B}&page=2`); // Seitenverweise sind aufgeräumt
  await expect(page.getByTestId("people-count")).toHaveText(`41–80 von ${inB} Treffern`);
});

test("Sortierung nach Geburt", async ({ page }) => {
  const dated = mock.persons.filter((p) => p.birthDate);
  const cmp = (a: (typeof dated)[number], b: (typeof dated)[number]) =>
    a.birthDate!.getTime() - b.birthDate!.getTime() ||
    (a.familyName ?? "").localeCompare(b.familyName ?? "") ||
    a.givenName.localeCompare(b.givenName);
  const oldest = [...dated].sort(cmp)[0];
  const youngest = [...dated].sort((a, b) => -cmp(a, b) || 0)[0];

  await page.goto("/people");
  await page.getByLabel("Sortierung").selectOption({ label: "Geburt, älteste zuerst" });
  await expect(page).toHaveURL(/[?&]sort=birthDate(&|$)/);
  const items = page.getByTestId("people-list").getByRole("listitem");
  await expect(items.first()).toContainText(fullName(oldest.id));
  await waitForHydration(page, "#people-sort");

  await page.getByLabel("Sortierung").selectOption({ label: "Geburt, jüngste zuerst" });
  await expect(page).toHaveURL(/[?&]sort=birthDateDesc(&|$)/);
  await expect(items.first()).toContainText(String(youngest.birthDate!.getUTCFullYear()));
  await waitForHydration(page, "#people-sort");

  await page.getByLabel("Sortierung").selectOption({ label: "Name" });
  await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
  await expect(items).toHaveCount(PAGE);
  // Nach Name: alphabetisch nach Nachname.
  const first = [...mock.persons].sort(
    (a, b) => (a.familyName ?? "").localeCompare(b.familyName ?? "", "de") || a.givenName.localeCompare(b.givenName, "de"),
  )[0];
  await expect(items.first()).toContainText(first.familyName!);
});

test.describe("als Betrachter", () => {
  test.use({ storageState: authFile("viewer") });

  test("sieht nur Familie A und keinen Familienfilter", async ({ page }) => {
    const n = visibleFor(["A"]).length;
    await page.goto("/people");
    await expect(page.getByTestId("people-count")).toHaveText(`1–${PAGE} von ${n} Personen`);
    // Nur eine Familie freigegeben — kein Filter nötig.
    await expect(page.getByLabel("Familie")).toHaveCount(0);
    // Fremde Familie per Adresse: leeres Ergebnis statt Fehler.
    await page.goto(`/people?family=${FAMILY.B}`);
    await expect(page.getByTestId("people-count")).toHaveText(`1–${PAGE} von ${n} Personen`);
  });
});
