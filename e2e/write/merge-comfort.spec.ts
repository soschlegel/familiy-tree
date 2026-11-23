import type { Page } from "@playwright/test";

import { test, expect, authFile, acceptDialogs, expectNoA11yViolations, expectNoHorizontalOverflow, httpError, waitForTree } from "../support/fixtures";
import { apiAs, createPerson, createRelationship, deletePerson, uniq, type CreatedPerson } from "../support/api";

/**
 * Zusammenführen — Komfort (als Bearbeiter):
 * - Dialog „Zusammenführen …“ auf der Personenseite: Kandidaten mit Klasse und
 *   Begründung, darunter die freie Suche.
 * - Alte Kennung als Umleitung: /people/<alt>, /tree?focus=<alt> und
 *   GET /api/persons/<alt> antworten mit 308 (auch über eine Kette), Schreiben
 *   mit 409 samt `mergedInto`; wer die bleibende Person nicht sehen darf,
 *   bekommt 404 wie bei einer unbekannten Kennung.
 * - Folgedubletten auf der Ergebnisseite; „alle sicheren“ nur über die
 *   gemeinsame Vorschau, Unsicheres bleibt stehen.
 * - „Erst die Eltern, dann dieses Paar“ in einem Schritt.
 * Alle Datensätze heißen „E2E …“ und werden entfernt.
 * Mit MERGE_SCREENS=<Ordner> entstehen Bildschirmfotos (1440 und 390 px).
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("editor") });

const tag = uniq();
const created: string[] = [];
const shots = process.env.MERGE_SCREENS;
const surname = `Komforttest${tag.replace(/[^a-z]/g, "")}`;

async function shot(page: Page, name: string) {
  if (!shots) return;
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: `${shots}/${name}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function person(data: Record<string, unknown>, role: "editor" | "admin" = "editor"): Promise<CreatedPerson> {
  const api = await apiAs(role);
  const p = await createPerson(api, { familyName: surname, ...data });
  await api.dispose();
  created.push(p.id);
  return p;
}

async function relate(data: Record<string, unknown>) {
  const api = await apiAs("editor");
  await createRelationship(api, data);
  await api.dispose();
}

/** Zusammenführen über die API (Vorgaben der Regeln). */
async function merge(keepId: string, mergeId: string, role: "editor" | "admin" = "editor") {
  const api = await apiAs(role);
  const res = await api.post("/api/persons/merge", { data: { keepId, mergeId } });
  expect(res.status(), await res.text()).toBe(200);
  await api.dispose();
}

test.afterAll(async () => {
  const api = await apiAs("admin");
  for (const id of created) await deletePerson(api, id);
  await api.dispose();
});

test("Dialog „Zusammenführen …“: Kandidaten mit Klasse und Begründung, darunter die freie Suche", async ({ page }) => {
  const same = { givenName: "E2E Dorothea", gender: "FEMALE", birthDate: "1811-03-04", deathDate: "1880-09-10" };
  const self = await person(same);
  const sure = await person(same);
  const likely = await person({ ...same, birthDate: "1811", deathDate: undefined, birthPlace: "Probstadt" });
  const stranger = await person({ givenName: "E2E Wendelin", gender: "MALE", birthDate: "1790" });

  await page.goto(`/people/${self.id}`);
  // Der Knopf steht im Kopf neben „Im Stammbaum zeigen“; unter „Verwaltung“ gibt es ihn nicht mehr.
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header.getByRole("link", { name: "Im Stammbaum zeigen" })).toBeVisible();
  await expect(header.getByTestId("merge-open")).toHaveText("Zusammenführen …");
  await expect(page.getByTestId("merge-open")).toHaveCount(1);
  await expect(page.getByText("Mit anderer Person zusammenführen")).toHaveCount(0);

  await header.getByTestId("merge-open").click();
  const dialog = page.getByTestId("merge-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Mit anderem Eintrag zusammenführen");
  const candidates = dialog.getByTestId("merge-candidate");
  await expect(candidates).toHaveCount(2);
  // „sicher“ zuerst, je mit Klasse und Begründungssatz
  await expect(candidates.nth(0)).toHaveAttribute("data-confidence", "high");
  await expect(candidates.nth(0)).toContainText("sicher");
  await expect(candidates.nth(0).getByTestId("merge-candidate-reason")).toHaveText("Gleicher Name, gleiches Geburtsdatum (04.03.1811), gleiches Sterbedatum (10.09.1880).");
  await expect(candidates.nth(1)).not.toHaveAttribute("data-confidence", "high");
  await expect(candidates.nth(1).getByTestId("merge-candidate-reason")).toContainText("Geburt");
  await expect(candidates.nth(0).getByTestId("merge-candidate-compare")).toHaveAttribute("href", `/people/merge?keep=${self.id}&other=${sure.id}`);
  await expect(candidates.nth(1).getByTestId("merge-candidate-compare")).toHaveAttribute("href", `/people/merge?keep=${self.id}&other=${likely.id}`);
  await expectNoA11yViolations(page);
  await shot(page, "merge-dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Freie Suche: eine Person, die kein Kandidat ist
  await expect(dialog.getByTestId("merge-compare")).toBeDisabled();
  await dialog.getByPlaceholder("Name der doppelten Person…").fill(`E2E Wendelin ${surname}`);
  await dialog.getByRole("button", { name: new RegExp(`E2E Wendelin ${surname}`) }).first().click();
  await expect(dialog.getByTestId("merge-compare")).toBeEnabled();

  // Escape schließt; der Fokus kehrt zum Knopf zurück
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(header.getByTestId("merge-open")).toBeFocused();

  // Kandidat → Vergleich mit dieser Person als bleibender
  await header.getByTestId("merge-open").click();
  await candidates.nth(0).getByTestId("merge-candidate-compare").click();
  await expect(page).toHaveURL(new RegExp(`/people/merge\\?keep=${self.id}&other=${sure.id}`));
  await expect(page.getByTestId("merge-keep")).toContainText("E2E Dorothea");
  expect(stranger.id).toBeTruthy();
});

test("Dialog ohne Kandidaten nennt das — die Suche bleibt", async ({ page }) => {
  const lonely = await person({ givenName: "E2E Zacharias", gender: "MALE", birthDate: "1777-07-07" });
  await page.goto(`/people/${lonely.id}`);
  await page.getByTestId("merge-open").click();
  const dialog = page.getByTestId("merge-dialog");
  await expect(dialog.getByTestId("merge-no-candidates")).toContainText("Keine möglichen Dubletten gefunden");
  await expect(dialog.getByPlaceholder("Name der doppelten Person…")).toBeVisible();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
});

test("alte Kennung: 308 für Personenseite, Stammbaum und API — auch über eine Kette; Schreiben 409 mit mergedInto", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(409));
  const same = { givenName: "E2E Henriette", gender: "FEMALE", birthDate: "1822-02-03", deathDate: "1890-04-05" };
  const a = await person(same);
  const b = await person(same);
  const c = await person(same);
  await merge(b.id, a.id);

  const noFollow = { maxRedirects: 0 };
  let res = await page.request.get(`/people/${a.id}`, noFollow);
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(`/people/${b.id}`);
  res = await page.request.get(`/people/${a.id}/edit`, noFollow);
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(`/people/${b.id}/edit`);
  res = await page.request.get(`/tree?focus=${a.id}&up=2`, noFollow);
  expect(res.status()).toBe(308);
  expect(res.headers().location).toContain(`focus=${b.id}`);
  expect(res.headers().location).toContain("up=2");
  res = await page.request.get(`/api/persons/${a.id}`, noFollow);
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(`/api/persons/${b.id}`);
  expect(await res.json()).toEqual({ mergedInto: b.id });
  // gefolgt: die bleibende Person
  expect((await (await page.request.get(`/api/persons/${a.id}`)).json()).person.id).toBe(b.id);

  // Schreiben auf die alte Kennung wird nicht still umgeleitet
  res = await page.request.patch(`/api/persons/${a.id}`, { data: { notes: "darf nicht ankommen" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).mergedInto).toBe(b.id);
  res = await page.request.delete(`/api/persons/${a.id}?force=true`);
  expect(res.status()).toBe(409);
  expect((await res.json()).mergedInto).toBe(b.id);
  expect((await (await page.request.get(`/api/persons/${b.id}`)).json()).person.notes ?? "").not.toContain("darf nicht ankommen");

  // Im Browser: die alte Adresse landet auf der bleibenden Person bzw. deren Baum
  await page.goto(`/people/${a.id}`);
  await expect(page).toHaveURL(new RegExp(`/people/${b.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Henriette");
  await page.goto(`/tree?focus=${a.id}`);
  await expect(page).toHaveURL(new RegExp(`focus=${b.id}`));
  await waitForTree(page);

  // Kette: B geht in C auf — beide alten Kennungen zeigen direkt auf C
  await merge(c.id, b.id);
  for (const old of [a.id, b.id]) {
    res = await page.request.get(`/people/${old}`, noFollow);
    expect(res.status()).toBe(308);
    expect(res.headers().location).toBe(`/people/${c.id}`);
    res = await page.request.get(`/api/persons/${old}`, noFollow);
    expect(res.headers().location).toBe(`/api/persons/${c.id}`);
  }
  // Die bleibende Person selbst und eine unbekannte Kennung: keine Umleitung
  expect((await page.request.get(`/people/${c.id}`, noFollow)).status()).toBe(200);
  expect((await page.request.get(`/people/gibt-es-nicht`, noFollow)).status()).toBe(404);
  expect((await page.request.get(`/api/persons/gibt-es-nicht`, noFollow)).status()).toBe(404);
});

test("alte Kennung einer nicht sichtbaren Person: 404 wie unbekannt — keine Umleitung verrät sie", async ({ page, consoleGuard }) => {
  consoleGuard.allow(httpError(404));
  // Familie C sieht der Bearbeiter nicht.
  const same = { givenName: "E2E Verborgen", gender: "MALE", birthDate: "1833-03-03", deathDate: "1899-09-09", familyIds: ["mock-family-c"] };
  const k = await person(same, "admin");
  const x = await person(same, "admin");
  await merge(k.id, x.id, "admin");

  const noFollow = { maxRedirects: 0 };
  // Der Administrator wird umgeleitet …
  const admin = await apiAs("admin");
  expect((await admin.get(`/people/${x.id}`, noFollow)).status()).toBe(308);
  expect((await admin.get(`/api/persons/${x.id}`, noFollow)).status()).toBe(308);
  await admin.dispose();

  // … der Bearbeiter bekommt genau die Antworten einer unbekannten Kennung.
  for (const id of [x.id, "gibt-es-nicht"]) {
    expect((await page.request.get(`/people/${id}`, noFollow)).status(), `/people/${id}`).toBe(404);
    expect((await page.request.get(`/people/${id}/edit`, noFollow)).status()).toBe(404);
    const api = await page.request.get(`/api/persons/${id}`, noFollow);
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ error: "Nicht gefunden" });
    const patch = await page.request.patch(`/api/persons/${id}`, { data: { notes: "x" } });
    expect(patch.status()).toBe(404);
    expect(await patch.json()).toEqual({ error: "Person nicht gefunden" });
    expect((await page.request.delete(`/api/persons/${id}`)).status()).toBe(404);
    const tree = await page.request.get(`/tree?focus=${id}`, noFollow);
    expect(tree.status()).toBe(200);
  }
  await page.goto(`/tree?focus=${x.id}`);
  await expect(page.getByTestId("tree-focus-missing")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`focus=${x.id}`));
});

test("Folgedubletten auf der Ergebnisseite: Klassen, gemeinsame Vorschau nur für „sicher“, Unsicheres bleibt", async ({ page }) => {
  acceptDialogs(page);
  const lotte = { givenName: "E2E Lotte", gender: "FEMALE", birthDate: "1830-05-01" };
  const k = await person(lotte);
  const x = await person(lotte);
  const father = { givenName: "E2E Konrad", gender: "MALE", birthDate: "1800-01-02" };
  const f1 = await person(father);
  const f2 = await person(father);
  const partner = { givenName: "E2E Emil", gender: "MALE", birthDate: "1828-03-03" };
  const p1 = await person(partner);
  const p2 = await person(partner);
  const child = { givenName: "E2E Ida", gender: "FEMALE", birthDate: "1855" };
  const c1 = await person(child);
  const c2 = await person(child);
  await relate({ type: "PARENT_OF", fromPersonId: f1.id, toPersonId: k.id });
  await relate({ type: "PARENT_OF", fromPersonId: f2.id, toPersonId: x.id });
  await relate({ type: "PARTNER_OF", fromPersonId: k.id, toPersonId: p1.id });
  await relate({ type: "PARTNER_OF", fromPersonId: x.id, toPersonId: p2.id });
  await relate({ type: "PARENT_OF", fromPersonId: k.id, toPersonId: c1.id });
  await relate({ type: "PARENT_OF", fromPersonId: x.id, toPersonId: c2.id });

  await page.goto(`/people/merge?keep=${k.id}&other=${x.id}`);
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("merge-result")).toContainText("Zusammengeführt");

  const followups = page.getByTestId("merge-followups");
  await expect(followups).toBeVisible();
  const item = (a: CreatedPerson, b: CreatedPerson) =>
    followups.getByTestId("merge-followup").filter({ has: page.locator(`a[href="/people/${a.id}"]`) }).filter({ has: page.locator(`a[href="/people/${b.id}"]`) });
  await expect(followups.getByTestId("merge-followup")).toHaveCount(3);
  await expect(item(f1, f2)).toHaveAttribute("data-confidence", "high");
  await expect(item(f1, f2)).toContainText("Beide als Eltern von E2E Lotte");
  await expect(item(f1, f2)).toContainText("dasselbe Kind eingetragen");
  await expect(item(p1, p2)).toHaveAttribute("data-confidence", "high");
  await expect(item(p1, p2)).toContainText("Beide als Partner von E2E Lotte");
  await expect(item(c1, c2)).toHaveAttribute("data-confidence", "medium");
  await expect(item(c1, c2)).toContainText("Beide als Kinder von E2E Lotte");
  // Nichts ist angekreuzt oder vorausgewählt; jedes Paar lässt sich einzeln vergleichen.
  await expect(followups.getByRole("checkbox")).toHaveCount(0);
  await expect(item(c1, c2).getByTestId("followup-compare")).toHaveAttribute("href", new RegExp(`/people/merge\\?keep=(${c1.id}&other=${c2.id}|${c2.id}&other=${c1.id})`));
  await expectNoA11yViolations(page);
  await shot(page, "merge-followups");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Gemeinsam: erst die Vorschau — nur die zwei sicheren Paare
  await expect(followups.getByTestId("followup-bulk-preview")).toContainText("(2)");
  await followups.getByTestId("followup-bulk-preview").click();
  const summary = followups.getByTestId("followup-bulk-summary");
  await expect(summary).toContainText("2 von 2 Paaren");
  await expect(summary).toContainText("E2E Konrad");
  await expect(summary).toContainText("E2E Emil");
  await expect(summary).not.toContainText("E2E Ida");
  await shot(page, "merge-followups-preview");
  await followups.getByTestId("followup-bulk-confirm").click();
  await expect(followups.getByTestId("followup-bulk-result")).toContainText("2 Paare zusammengeführt");

  // Danach neu gesucht: nur noch das „wahrscheinliche“ Paar, und beide Kinder gibt es noch.
  await expect(followups.getByTestId("merge-followup")).toHaveCount(1);
  await expect(item(c1, c2)).toHaveAttribute("data-confidence", "medium");
  await expect(followups.getByTestId("followup-bulk-preview")).toHaveCount(0);
  for (const c of [c1, c2]) expect((await page.request.get(`/api/persons/${c.id}`, { maxRedirects: 0 })).status()).toBe(200);
  const detail = await (await page.request.get(`/api/persons/${k.id}`)).json();
  expect(detail.parents).toHaveLength(1);
  expect(detail.partners).toHaveLength(1);
  expect(detail.children).toHaveLength(2);
});

test("Ergebnisseite ohne Folgedubletten zeigt den Abschnitt nicht", async ({ page }) => {
  acceptDialogs(page);
  const same = { givenName: "E2E Ottilie", gender: "FEMALE", birthDate: "1844-04-04" };
  const k = await person(same);
  const x = await person(same);
  await page.goto(`/people/merge?keep=${k.id}&other=${x.id}`);
  const loaded = page.waitForResponse((r) => r.url().includes("/api/persons/merge/followups"));
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("merge-result")).toContainText("Zusammengeführt");
  expect((await (await loaded).json()).items).toEqual([]);
  await expect(page.getByTestId("merge-followups")).toHaveCount(0);
});

test("Erst die Eltern, dann dieses Paar: Vorschau der Eltern, ein Schritt, beide zusammengeführt", async ({ page }) => {
  acceptDialogs(page);
  const father = await person({ givenName: "E2E Konrad", gender: "MALE", birthDate: "1799" });
  const m1 = await person({ givenName: "E2E Regina", gender: "FEMALE", birthDate: "1802" });
  const m2 = await person({ givenName: "E2E Regina", gender: "FEMALE", birthDate: "1802" });
  const k = await person({ givenName: "E2E Karoline", gender: "FEMALE", birthDate: "1831-05-01" });
  const x = await person({ givenName: "E2E Karoline", gender: "FEMALE", birthDate: "1831-05-01" });
  for (const [par, ch] of [[father, k], [m1, k], [father, x], [m2, x]]) await relate({ type: "PARENT_OF", fromPersonId: par.id, toPersonId: ch.id });

  await page.goto(`/people/merge?keep=${k.id}&other=${x.id}`);
  await expect(page.getByTestId("merge-blockers")).toContainText("Als Mutter ist bei jedem Eintrag eine eigene Person eingetragen");
  await expect(page.getByTestId("merge-confirm")).toBeDisabled();
  // Der Link zum einzelnen Vergleich bleibt; dazu der Weg in einem Schritt.
  await expect(page.getByTestId("merge-parent-link")).toHaveCount(1);
  await page.getByTestId("merge-parents-first").click();
  const plan = page.getByTestId("merge-parents-plan");
  await expect(plan).toContainText("Erst die Eltern, dann dieses Paar");
  await expect(plan.getByTestId("merge-parents-pair")).toHaveCount(1);
  await expect(plan.getByTestId("merge-parents-pair")).toContainText("E2E Regina");
  await expect(plan.getByTestId("merge-parents-pair").getByRole("link", { name: "Einzeln vergleichen" })).toHaveAttribute("href", `/people/merge?keep=${m1.id}&other=${m2.id}`);
  await expectNoA11yViolations(page);
  await shot(page, "merge-parents-first");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Abbrechen ändert nichts
  await plan.getByRole("button", { name: "Abbrechen" }).click();
  await expect(plan).toHaveCount(0);
  for (const p of [m2, x]) expect((await page.request.get(`/api/persons/${p.id}`, { maxRedirects: 0 })).status()).toBe(200);

  await page.getByTestId("merge-parents-first").click();
  await page.getByTestId("merge-parents-confirm").click();
  const result = page.getByTestId("merge-result");
  await expect(result).toContainText("Zusammengeführt");
  await expect(page.getByTestId("merge-result-parents")).toContainText("E2E Regina");
  await shot(page, "merge-parents-result");

  // Beide aufgegangenen Einträge leiten auf die bleibenden um; das Kind hat zwei Eltern.
  const oldMother = await page.request.get(`/api/persons/${m2.id}`, { maxRedirects: 0 });
  expect(oldMother.status()).toBe(308);
  expect(oldMother.headers().location).toBe(`/api/persons/${m1.id}`);
  const oldChild = await page.request.get(`/api/persons/${x.id}`, { maxRedirects: 0 });
  expect(oldChild.headers().location).toBe(`/api/persons/${k.id}`);
  const detail = await (await page.request.get(`/api/persons/${k.id}`)).json();
  expect(detail.parents.map((r: { other: { id: string } }) => r.other.id).sort()).toEqual([father.id, m1.id].sort());
});

test("Väter, die nur schwach zusammenpassen (nur der erste Vorname gleich): kein Knopf „Erst die Eltern“ — die Sperre bleibt", async ({ page }) => {
  const f1 = await person({ givenName: "E2E Gustav", gender: "MALE", birthDate: "1799" });
  const f2 = await person({ givenName: "E2E Ludwig", gender: "MALE", birthDate: "1801" });
  const m1 = await person({ givenName: "E2E Sophie", gender: "FEMALE", birthDate: "1803" });
  const m2 = await person({ givenName: "E2E Sophie", gender: "FEMALE", birthDate: "1803" });
  const k = await person({ givenName: "E2E Mathilde", gender: "FEMALE", birthDate: "1832-06-01" });
  const x = await person({ givenName: "E2E Mathilde", gender: "FEMALE", birthDate: "1832-06-01" });
  for (const [par, ch] of [[f1, k], [m1, k], [f2, x], [m2, x]]) await relate({ type: "PARENT_OF", fromPersonId: par.id, toPersonId: ch.id });
  await page.goto(`/people/merge?keep=${k.id}&other=${x.id}`);
  // „E2E Gustav“ / „E2E Ludwig“: Die Sperre nennt das Paar zum Prüfen, mehr nicht.
  await expect(page.getByTestId("merge-blockers")).toContainText("Als Vater ist bei jedem Eintrag eine eigene Person eingetragen");
  await expect(page.getByTestId("merge-parent-link")).toHaveCount(2);
  await expect(page.getByTestId("merge-parents-first")).toHaveCount(0);
  await expect(page.getByTestId("merge-confirm")).toBeDisabled();
});
