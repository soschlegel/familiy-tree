import { test, expect, authFile, acceptDialogs, devLogin, httpError } from "../support/fixtures";
import { apiAs, uniq } from "../support/api";
import { familyName, mock, visibleFor } from "../support/mock";

/**
 * Verwaltung als Admin: Benutzer einladen, Rolle ändern, sperren; sich selbst
 * nicht herabstufen können; Familie anlegen und Zugriff vergeben — und als
 * der eingeladene Benutzer prüfen, dass sich die Sichtbarkeit ändert.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("admin") });

const tag = uniq();
const email = `e2e-${tag}@example.test`;
const newFamily = `E2E Familie ${tag}`;

test.afterAll(async () => {
  const api = await apiAs("admin");
  const users = (await (await api.get("/api/users")).json()) as { id: string; email: string }[];
  for (const u of users.filter((x) => x.email === email)) await api.delete(`/api/users/${u.id}`);
  const families = (await (await api.get("/api/families")).json()) as { id: string; name: string }[];
  for (const f of families.filter((x) => x.name === newFamily)) await api.delete(`/api/families/${f.id}?force=true`);
  await api.dispose();
});

test("Benutzer einladen und Rolle ändern", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Rolle", { exact: true }).selectOption({ label: "Bearbeiter" });
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByText(`${email} eingeladen.`)).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("eingeladen");
  await expect(row).toContainText("nie");
  const role = row.getByRole("combobox", { name: `Rolle von ${email}` });
  await expect(role).toHaveValue("EDITOR");

  await role.selectOption({ label: "Betrachter" });
  await expect(page.getByText(`Rolle von ${email} geändert.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: email }).getByRole("combobox", { name: `Rolle von ${email}` })).toHaveValue("VIEWER");
});

test("Doppelte Einladung wird abgelehnt", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(409));
  await page.goto("/admin/users");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /existiert|bereits/ })).toBeVisible();
});

test("die eigene Rolle lässt sich nicht ändern", async ({ page }) => {
  await page.goto("/admin/users");
  const self = page.getByRole("row").filter({ hasText: "admin@example.test" });
  await expect(self).toContainText("(du)");
  await expect(self.getByRole("combobox", { name: "Rolle von admin@example.test" })).toBeDisabled();
  await expect(self.getByRole("button", { name: "sperren" })).toHaveCount(0);

  // Auch an der Oberfläche vorbei nicht.
  const api = await apiAs("admin");
  for (const data of [{ role: "VIEWER" }, { status: "BLOCKED" }]) {
    const res = await api.patch("/api/users/mock-user-admin", { data });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("nur ein anderer Admin");
  }
  expect((await api.delete("/api/users/mock-user-admin")).status()).toBe(409);
  await api.dispose();
});

test("Familie anlegen, Zugriff vergeben — der Benutzer sieht danach mehr", async ({ page, loginAs }) => {
  // Als eingeladener Benutzer anmelden: noch keine Familie.
  const { page: user } = await loginAs(null);
  await devLogin(user, email);
  await user.waitForURL(/\/tree/);
  await expect(user.getByTestId("tree-empty")).toContainText("Noch keine Familie freigegeben");

  // Admin legt eine Familie an …
  await page.goto("/admin/families");
  await page.getByLabel("Name der neuen Familie").fill(newFamily);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText(`Familie „${newFamily}“ angelegt.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: newFamily })).toContainText("0 Personen · 0 Benutzer");

  // … und vergibt Lesezugriff auf sie und auf Familie C.
  const access = (family: string) => page.getByRole("combobox", { name: `Zugriff von ${email} auf ${family}` });
  await access(newFamily).selectOption({ label: "lesen" });
  await expect(page.getByText("Zugriff gespeichert.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: newFamily })).toContainText("1 Benutzer");
  await access(familyName("C")).selectOption({ label: "lesen" });
  await expect(access(familyName("C"))).toHaveValue("VIEWER");

  // Der Benutzer sieht jetzt Familie C — ohne neue Anmeldung.
  const inC = visibleFor(["C"]).length;
  await user.goto("/people");
  await expect(user.getByTestId("people-count")).toHaveText(`1–${Math.min(40, inC)} von ${inC} Personen`);
  await user.goto("/tree");
  await expect(user.getByTestId("tree-counts")).toContainText(`${inC} Personen`);
  const cPerson = mock.persons.find((x) => x.familyKeys.length === 1 && x.familyKeys[0] === "C")!;
  expect((await user.request.get(`/api/persons/${cPerson.id}`)).status()).toBe(200);
  // Die neue Familie erscheint im Filter, A nicht.
  await user.goto("/people");
  const familySelect = user.getByLabel("Familie");
  await expect(familySelect.locator("option")).toContainText(["Alle Familien", newFamily, familyName("C")]);
  await expect(familySelect.locator("option", { hasText: familyName("A") })).toHaveCount(0);

  // Zugriff wieder entziehen.
  await access(familyName("C")).selectOption({ label: "kein Zugriff" });
  await expect(access(familyName("C"))).toHaveValue("");
  expect((await user.request.get(`/api/persons/${cPerson.id}`)).status()).toBe(404);

  // Familie löschen.
  acceptDialogs(page);
  await page.getByRole("button", { name: `Familie ${newFamily} löschen` }).click();
  await expect(page.getByText(`Familie „${newFamily}“ gelöscht.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: newFamily })).toHaveCount(0);

});

test("Benutzer sperren: Sitzung endet, Anmeldung scheitert", async ({ page, loginAs }) => {
  const { page: user } = await loginAs(null);
  await devLogin(user, email);
  await user.waitForURL(/\/tree/);

  acceptDialogs(page);
  await page.goto("/admin/users");
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "sperren" }).click();
  await expect(page.getByText(`${email} gesperrt.`)).toBeVisible();
  await expect(row).toContainText("gesperrt");
  await expect(row.getByRole("button", { name: "entsperren" })).toBeVisible();

  // Die laufende Sitzung ist sofort ungültig.
  await user.goto("/people");
  await expect(user).toHaveURL(/\/login/);
  // Neue Anmeldung scheitert mit Meldung.
  await devLogin(user, email);
  await expect(user.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" })).toBeVisible();

  // Entsperren macht es rückgängig.
  await row.getByRole("button", { name: "entsperren" }).click();
  await expect(page.getByText(`${email} entsperrt.`)).toBeVisible();
  await expect(row).toContainText("aktiv");
});
