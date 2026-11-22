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

  // Der Benutzer sieht jetzt Familie C — ohne neue Anmeldung. Mindestens die
  // Mock-Personen von C: gleichzeitig laufende Dateien (changelog,
  // person-lifecycle) legen kurzzeitig eigene „E2E …“-Personen in C an.
  const inC = visibleFor(["C"]).length;
  const count = async (testId: string, re: RegExp) =>
    Number((re.exec((await user.getByTestId(testId).textContent()) ?? "") ?? [])[1] ?? -1);
  await user.goto("/people");
  await expect.poll(() => count("people-count", /von (\d+) Personen/)).toBeGreaterThanOrEqual(inC);
  await user.goto("/tree");
  await expect.poll(() => count("tree-counts", /(\d+) Personen/)).toBeGreaterThanOrEqual(inC);
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

test("E-Mail-Adresse korrigieren, solange der Benutzer sich nie angemeldet hat", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(409));
  const typo = `e2e-tippfehler-${tag}@example.tset`;
  const fixed = `e2e-korrigiert-${tag}@example.test`;
  await page.goto("/admin/users");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(typo);
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByText(`${typo} eingeladen.`)).toBeVisible();

  const row = page.getByTestId("user-row").filter({ hasText: typo });
  await row.getByRole("button", { name: `E-Mail ändern von ${typo}` }).click();
  const form = page.getByRole("form", { name: `Adresse von ${typo} korrigieren` });
  // Großschreibung wird wie beim Einladen vereinheitlicht.
  await form.getByLabel("Neue E-Mail-Adresse").fill(fixed.toUpperCase());
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(`E-Mail-Adresse von ${typo} in ${fixed} geändert.`)).toBeVisible();
  await expect(page.getByTestId("user-row").filter({ hasText: fixed })).toContainText("eingeladen");
  await expect(page.getByTestId("user-row").filter({ hasText: typo })).toHaveCount(0);

  // Doppelte Adresse: 409 mit Meldung, auch über die Oberfläche.
  const fixedRow = page.getByTestId("user-row").filter({ hasText: fixed });
  await fixedRow.getByRole("button", { name: `E-Mail ändern von ${fixed}` }).click();
  await page.getByRole("form", { name: `Adresse von ${fixed} korrigieren` }).getByLabel("Neue E-Mail-Adresse").fill("editor@example.test");
  await page.getByRole("form", { name: `Adresse von ${fixed} korrigieren` }).getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "bereits eingeladen" })).toBeVisible();

  // Wer sich schon angemeldet hat, behält seine Adresse — kein Knopf, und die API lehnt ab.
  await expect(page.getByTestId("user-row").filter({ hasText: email }).getByRole("button", { name: /E-Mail ändern von / })).toHaveCount(0);
  const api = await apiAs("admin");
  const users = (await (await api.get("/api/users")).json()) as { id: string; email: string }[];
  const signedIn = users.find((u) => u.email === email)!;
  const refused = await api.patch(`/api/users/${signedIn.id}`, { data: { email: `e2e-anders-${tag}@example.test` } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toContain("noch nie angemeldet");
  const self = await api.patch("/api/users/mock-user-admin", { data: { email: `e2e-admin-${tag}@example.test` } });
  expect(self.status()).toBe(409);
  const invalid = await api.patch(`/api/users/${users.find((u) => u.email === fixed)!.id}`, { data: { email: "kein-at-zeichen" } });
  expect(invalid.status()).toBe(400);
  // Aufräumen.
  expect((await api.delete(`/api/users/${users.find((u) => u.email === fixed)!.id}`)).status()).toBe(200);
  await api.dispose();
});

test("Benutzer löschen: Rückfrage nennt die Folgen, nicht für den eigenen Zugang", async ({ page, loginAs }) => {
  await page.goto("/admin/users");
  // Eigener Zugang: Knopf gesperrt, Grund steht daneben.
  const self = page.getByTestId("user-row").filter({ hasText: "admin@example.test" });
  await expect(self.getByRole("button", { name: "admin@example.test löschen" })).toBeDisabled();
  await expect(self.getByTestId("user-delete-why")).toHaveText("eigener Zugang");

  // Der eingeladene und inzwischen angemeldete Testbenutzer: Sitzung läuft.
  const { page: user } = await loginAs(null);
  await devLogin(user, email);
  await user.waitForURL(/\/tree/);

  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  const row = page.getByTestId("user-row").filter({ hasText: email });
  await row.getByRole("button", { name: `${email} löschen` }).click();
  await expect(page.getByText(`${email} gelöscht.`)).toBeVisible();
  expect(question).toContain(`${email} endgültig löschen?`);
  expect(question).toContain("alle KI-Schlüssel");
  expect(question).toContain("Protokolleinträge");
  await expect(page.getByTestId("user-row").filter({ hasText: email })).toHaveCount(0);

  // Sitzung ungültig, Anmeldung ohne neue Einladung nicht möglich.
  await user.goto("/people");
  await expect(user).toHaveURL(/\/login/);
  await devLogin(user, email);
  await expect(user.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" })).toBeVisible();

  // Die Protokolleinträge über den Benutzer bleiben (Aufräumen in afterAll findet ihn nicht mehr).
  const api = await apiAs("admin");
  expect((await api.delete("/api/users/mock-user-admin")).status()).toBe(409);
  await api.dispose();
});
