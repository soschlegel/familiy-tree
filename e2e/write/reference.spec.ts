import { test, expect, authFile, acceptDialogs, httpError, waitForTree } from "../support/fixtures";
import { apiAs } from "../support/api";
import { L, fullName, mock } from "../support/mock";

/**
 * „Das bin ich“ setzen und aufheben — selbst auf der Personenseite und als
 * Administrator in der Benutzerverwaltung (README, „Bezugsperson“). Ändert
 * nur die eigene Person des Betrachters und setzt sie am Ende zurück.
 */
test.describe.configure({ mode: "serial" });

const FOUNDER = L.founders.A;
const HIDDEN = mock.persons.find((p) => p.familyKeys.length === 1 && p.familyKeys[0] === "D")!.id;

test.afterAll(async () => {
  // Zurück auf den Ausgangszustand: der Betrachter hat keine eigene Person.
  const api = await apiAs("viewer");
  await api.put("/api/me/person", { data: { personId: null } });
  await api.dispose();
});

test("Betrachter: „Das bin ich“ auf der Personenseite, danach Verwandtschaft im Baum; wieder aufheben", async ({ loginAs }) => {
  const { page } = await loginAs("viewer");
  await page.goto(`/people/${FOUNDER}`);
  await page.getByTestId("self-person-set").click();
  await expect(page.getByTestId("person-reference-self")).toContainText("das bist du");
  await expect(page.getByTestId("self-person-clear")).toBeVisible();

  await page.goto(`/tree?focus=${FOUNDER}`);
  await waitForTree(page);
  await expect(page.getByTestId("reference-chip")).toHaveAttribute("data-source", "self");
  await expect(page.locator(`[data-testid="tree-person"][data-person-id="${FOUNDER}"]`)).toHaveAttribute("data-reference", "true");
  // Kinder des Stammvaters tragen ihre Bezeichnung.
  const child = mock.relationships.find((r) => r.type === "PARENT_OF" && r.fromPersonId === FOUNDER)!.toPersonId;
  await expect(page.locator(`[data-testid="tree-person"][data-person-id="${child}"]`)).toHaveAttribute(
    "data-kinship",
    /^(Sohn|Tochter|Kind|Adoptiv.*|Stief.*|Pflege.*)$/,
  );

  await page.goto(`/people/${FOUNDER}`);
  await page.getByTestId("self-person-clear").click();
  await expect(page.getByTestId("self-person-set")).toBeVisible();
  await page.goto("/tree");
  await waitForTree(page);
  await expect(page.getByTestId("reference-chip")).toHaveCount(0);
});

test("Schnittstelle: nur sichtbare Personen; unbekannt und gesperrt sind gleich 404", async ({ consoleGuard }) => {
  consoleGuard.allow(httpError(404));
  const api = await apiAs("viewer");
  expect((await api.put("/api/me/person", { data: { personId: HIDDEN } })).status()).toBe(404);
  expect((await api.put("/api/me/person", { data: { personId: "gibt-es-nicht" } })).status()).toBe(404);
  expect((await api.put("/api/me/person", { data: { personId: 42 } })).status()).toBe(400);
  const ok = await api.put("/api/me/person", { data: { personId: FOUNDER } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ personId: FOUNDER });
  expect((await api.put("/api/me/person", { data: { personId: null } })).status()).toBe(200);
  await api.dispose();
});

test.describe("Administrator", () => {
  test.use({ storageState: authFile("admin") });

  test("ordnet dem Betrachter in der Benutzerverwaltung eine Person zu und hebt sie wieder auf", async ({ page, loginAs }) => {
    acceptDialogs(page);
    await page.goto("/admin/users");
    const row = page.getByTestId("user-row").filter({ hasText: "viewer@example.test" });
    await expect(row.getByTestId("user-person")).toContainText("keine");
    await row.getByTestId("user-person-edit").click();

    const form = page.getByTestId("user-person-form");
    await form.getByRole("combobox").fill(fullName(FOUNDER));
    await form.getByRole("button", { name: new RegExp(fullName(FOUNDER)) }).first().click();
    await form.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText(`viewer@example.test ist jetzt ${fullName(FOUNDER)}.`)).toBeVisible();
    await expect(row.getByTestId("user-person")).toContainText(fullName(FOUNDER));

    // Der Betrachter sieht sie als seine Bezugsperson.
    const viewer = (await loginAs("viewer")).page;
    await viewer.goto(`/people/${FOUNDER}`);
    await expect(viewer.getByTestId("person-reference-self")).toContainText("das bist du");

    await row.getByTestId("user-person-edit").click();
    await page.getByTestId("user-person-form").getByRole("button", { name: "Zuordnung aufheben" }).click();
    await expect(page.getByText("Zuordnung von viewer@example.test aufgehoben.")).toBeVisible();
    await expect(row.getByTestId("user-person")).toContainText("keine");
  });

  test("Schnittstelle: unbekannte Person ist 404", async ({ consoleGuard }) => {
    consoleGuard.allow(httpError(404));
    const api = await apiAs("admin");
    const users = (await (await api.get("/api/users")).json()) as { id: string; email: string }[];
    const viewer = users.find((u) => u.email === "viewer@example.test")!;
    expect((await api.patch(`/api/users/${viewer.id}`, { data: { personId: "gibt-es-nicht" } })).status()).toBe(404);
    expect((await api.patch(`/api/users/${viewer.id}`, { data: { personId: null } })).status()).toBe(200);
    await api.dispose();
  });
});
