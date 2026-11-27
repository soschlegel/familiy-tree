import {
  test,
  expect,
  authFile,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
} from "../support/fixtures";
import { forbiddenNamesFor, mock } from "../support/mock";
import type { FamilyKey } from "../../prisma/mock-data";
import { eventTitle, type EventTypeName } from "../../lib/events";
import type { FuzzyDate } from "../../lib/dates";
import {
  anniversarySentence,
  computeToday,
  formatIsoDay,
  SECTION_LIMIT,
  sentenceText,
  type CalendarDay,
  type TodayResult,
} from "../../lib/today";

/**
 * Startseite „Heute in der Familie“ (app/page.tsx, lib/services/today.ts).
 * Unabhängig vom echten Datum: Die Tests wählen den Tag über `?datum=` und
 * rechnen die Erwartung mit lib/today.ts über denselben Mock-Datensatz aus.
 * Nur lesend.
 */

const fuzzy = (date: Date | null, precision: string, qualifier: string): FuzzyDate | null =>
  date ? ({ date, precision, qualifier } as FuzzyDate) : null;

/** Erwartung für einen Benutzer mit diesen Familien (null = Admin). */
function expected(keys: FamilyKey[] | null, day: CalendarDay): TodayResult {
  const visible = (fk: FamilyKey[]) => keys === null || fk.some((k) => keys.includes(k));
  return computeToday({
    day,
    // Ein Tag ≠ heute: Sätze mit „Am …“ statt „Heute“ (realToday weit weg).
    realToday: { year: 1900, month: 1, day: 1 },
    persons: mock.persons.map((p) => ({
      id: p.id,
      name: [p.givenName, p.familyName].filter(Boolean).join(" "),
      visible: visible(p.familyKeys),
      birth: fuzzy(p.birthDate, p.birthDatePrecision, p.birthDateQualifier),
      death: fuzzy(p.deathDate, p.deathDatePrecision, p.deathDateQualifier),
      deathWithoutDate: !p.deathDate && Boolean(p.deathPlace?.trim()),
    })),
    partnerships: mock.relationships
      .filter((r) => r.type === "PARTNER_OF")
      .map((r) => ({
        id: r.id,
        subtype: r.subtype,
        partners: [r.fromPersonId, r.toPersonId] as [string, string],
        start: fuzzy(r.startDate, r.startDatePrecision, r.startDateQualifier),
      })),
    events: mock.events
      .filter((e) => e.personId && !e.dateTo)
      .map((e) => ({
        id: e.id,
        personId: e.personId!,
        type: e.type,
        title: eventTitle({ type: e.type as EventTypeName, label: e.label }),
        isAlternative: e.isAlternative,
        date: fuzzy(e.date, e.datePrecision, e.dateQualifier),
      })),
  });
}

/** Alle Tage eines Jahres (ohne 29.2.) — die Tests suchen sich passende aus. */
const DAYS: CalendarDay[] = [];
for (let m = 1; m <= 12; m++) {
  for (let d = 1; d <= 31; d++) {
    if (new Date(Date.UTC(2031, m - 1, d)).getUTCMonth() === m - 1) DAYS.push({ year: 2031, month: m, day: d });
  }
}
const find = (pred: (d: CalendarDay) => boolean) => {
  const d = DAYS.find(pred);
  if (!d) throw new Error("Kein passender Tag in den Mock-Daten");
  return d;
};

/** Tag, an dem der Admin mehr sieht als der Betrachter, der aber auch etwas sieht. */
const BUSY = find((d) => {
  const a = expected(null, d).today.length;
  const v = expected(["A"], d).today.length;
  return a >= 3 && v >= 1 && v < a;
});
/** Tag mit mehr weiteren Geburtstagen (Tag 15–30), als die Liste zeigt. */
const MANY_BIRTHDAYS = find((d) => expected(null, d).laterBirthdays.length > SECTION_LIMIT);
/** Tag, an dem ein Lebender Geburtstag hat und die Tageskarte noch anderes zeigt. */
const BIRTHDAY_DAY = find((d) => {
  const e = expected(null, d);
  return e.birthdays.some((a) => a.daysAway === 0) && e.today.length > 0 && e.laterBirthdays.length > 0;
});
/** Tag, an dem der Betrachter im 14-Tage-Fenster keinen Geburtstag hat. */
const NO_BIRTHDAYS = find((d) => expected(["A"], d).birthdays.length === 0);
/** Tag ohne Jahrestag für den Betrachter, mit einem nächsten. */
const EMPTY = find((d) => {
  const v = expected(["A"], d);
  return v.today.length === 0 && v.next !== null;
});

const url = (d: CalendarDay) => `/?datum=${formatIsoDay(d)}`;

test.describe("Startseite als Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Jahrestage des Tages als Sätze, Personen verlinkt, runde hervorgehoben", async ({ page }) => {
    const exp = expected(null, BUSY);
    await page.goto(url(BUSY));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Der \d+\. \S+ in der Familie$/);
    await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/hilfe/startseite#wie-wird-gezaehlt");
    const items = page.getByTestId("today-list").getByTestId("today-item");
    await expect(items).toHaveCount(Math.min(exp.today.length, SECTION_LIMIT));
    for (const [i, a] of exp.today.slice(0, SECTION_LIMIT).entries()) {
      await expect(items.nth(i)).toContainText(sentenceText(anniversarySentence(a, false)));
      const links = items.nth(i).getByTestId("today-person-link");
      await expect(links).toHaveCount(a.persons.length);
      for (const [j, p] of a.persons.entries()) await expect(links.nth(j)).toHaveAttribute("href", `/people/${p.id}`);
      await expect(items.nth(i).getByTestId("today-round")).toHaveCount(a.round ? 1 : 0);
    }
    // Ein Klick auf einen Namen führt zur Person.
    const first = exp.today[0].persons[0];
    await items.first().getByTestId("today-person-link").first().click();
    await expect(page).toHaveURL(`/people/${first.id}`);
  });

  test("Geburtstage ganz oben: heute hervorgehoben, nicht doppelt in der Tageskarte, Rest unter „Weitere Geburtstage“", async ({ page }) => {
    const exp = expected(null, BIRTHDAY_DAY);
    await page.goto(url(BIRTHDAY_DAY));
    // Reihenfolge der Karten: Geburtstage, Jahrestage, Demnächst.
    const order = await page
      .locator("[data-testid=birthdays-section], [data-testid=today-section], [data-testid=soon-section]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(order).toEqual(["birthdays-section", "today-section", "soon-section"]);
    const section = page.getByTestId("birthdays-section");
    await expect(section.getByRole("heading", { level: 2 })).toHaveText("Geburtstage");
    await expect(section).toContainText("und in den 14 Tagen danach");
    const items = page.getByTestId("birthdays-list").getByTestId("today-item");
    await expect(items).toHaveCount(Math.min(exp.birthdays.length, SECTION_LIMIT));
    for (const [i, a] of exp.birthdays.slice(0, SECTION_LIMIT).entries()) {
      await expect(items.nth(i)).toContainText(sentenceText(anniversarySentence(a, false)));
      await expect(items.nth(i)).toHaveAttribute("data-days-away", String(a.daysAway));
      await expect(items.nth(i).getByTestId("today-mark")).toHaveCount(a.daysAway === 0 ? 1 : 0);
      await expect(items.nth(i).getByTestId("today-round")).toHaveCount(a.round ? 1 : 0);
    }
    await expect(items.first().getByTestId("today-mark")).toHaveText("an diesem Tag");
    // Die Tageskarte nennt den Geburtstag nicht noch einmal.
    const dayItems = page.getByTestId("today-list").getByTestId("today-item");
    await expect(dayItems).toHaveCount(Math.min(exp.today.length, SECTION_LIMIT));
    for (const a of exp.birthdays.filter((b) => b.daysAway === 0)) {
      await expect(page.getByTestId("today-list")).not.toContainText(sentenceText(anniversarySentence(a, false)));
    }
    // „Demnächst“: nur die Geburtstage nach dem Fenster.
    await expect(page.getByTestId("soon-section").getByRole("heading", { name: "Weitere Geburtstage" })).toBeVisible();
    const later = page.getByTestId("soon-birthdays").getByTestId("today-item");
    await expect(later).toHaveCount(Math.min(exp.laterBirthdays.length, SECTION_LIMIT));
    for (const [i, a] of exp.laterBirthdays.slice(0, SECTION_LIMIT).entries()) {
      expect(a.daysAway).toBeGreaterThan(14);
      await expect(later.nth(i)).toContainText(sentenceText(anniversarySentence(a, false)));
    }
  });

  test("Weitere Geburtstage: mehr als zehn → „Weitere … anzeigen“", async ({ page }) => {
    const exp = expected(null, MANY_BIRTHDAYS);
    await page.goto(url(MANY_BIRTHDAYS));
    const list = page.getByTestId("soon-birthdays");
    // Die übrigen stehen schon im (zugeklappten) <details> — gezählt wird, was sichtbar ist.
    const shown = list.getByTestId("today-item").filter({ visible: true });
    await expect(shown).toHaveCount(SECTION_LIMIT);
    const more = page.getByTestId("soon-birthdays-more");
    await more.getByText(`Weitere ${exp.laterBirthdays.length - SECTION_LIMIT} anzeigen`).click();
    await expect(shown).toHaveCount(exp.laterBirthdays.length);
    await expect(more.getByText("Weniger anzeigen")).toBeVisible();
    await expect(list.getByTestId("today-item").first()).toContainText(sentenceText(anniversarySentence(exp.laterBirthdays[0], false)));
  });

  test("Tag blättern, zurück zu heute, Einstieg und Logo", async ({ page }) => {
    await page.goto(url(BUSY));
    await page.getByTestId("today-next").click();
    const next = new Date(Date.UTC(BUSY.year, BUSY.month - 1, BUSY.day + 1));
    await expect(page).toHaveURL(`/?datum=${next.toISOString().slice(0, 10)}`);
    await page.getByTestId("today-back").click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heute in der Familie");
    await expect(page.getByTestId("today-back")).toHaveCount(0);
    // Einstieg: der Baum ist einen Klick entfernt.
    await page.getByTestId("start-tree").click();
    await expect(page).toHaveURL(/\/tree(\?|$)/);
    // Das Logo führt zurück zur Startseite.
    await page.getByRole("link", { name: "Stammbaum — Startseite" }).click();
    await expect(page).toHaveURL("/");
    // Ungültiges Datum: einfach heute.
    await page.goto("/?datum=2026-02-30");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heute in der Familie");
  });
});

test.describe("Startseite mit eingeschränkten Rechten", () => {
  test("Betrachter (nur Familie A): nur sichtbare Personen, nichts Fremdes", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    const exp = expected(["A"], BUSY);
    await page.goto(url(BUSY));
    await expect(page.getByTestId("today-list").getByTestId("today-item")).toHaveCount(Math.min(exp.today.length, SECTION_LIMIT));
    if (exp.birthdays.length > 0) {
      await expect(page.getByTestId("birthdays-list").getByTestId("today-item")).toHaveCount(Math.min(exp.birthdays.length, SECTION_LIMIT));
    } else {
      await expect(page.getByTestId("birthdays-empty")).toBeVisible();
    }
    const main = page.locator("main");
    const text = await main.innerText();
    for (const name of forbiddenNamesFor(["A"])) expect(text, name).not.toContain(name);
    const allowed = new Set(mock.persons.filter((p) => p.familyKeys.includes("A")).map((p) => `/people/${p.id}`));
    for (const href of await main.getByTestId("today-person-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
      expect(allowed.has(href!), href!).toBe(true);
    }
  });

  test("leerer Tag: freundlicher Hinweis und der nächste Jahrestag", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    const exp = expected(["A"], EMPTY);
    await page.goto(url(EMPTY));
    await expect(page.getByTestId("today-empty")).toContainText("steht kein Jahrestag im Stammbaum");
    await expect(page.getByTestId("today-next-anniversary")).toContainText(sentenceText(anniversarySentence(exp.next!, false)));
    await page.getByTestId("today-next-link").click();
    await expect(page).toHaveURL(url(exp.next!.on));
    await expect(page.getByTestId("today-list").getByTestId("today-item").first()).toBeVisible();
  });

  test("kein Geburtstag im Fenster: Karte bleibt mit freundlichem Satz", async ({ loginAs }) => {
    const { page } = await loginAs("viewer");
    await page.goto(url(NO_BIRTHDAYS));
    const section = page.getByTestId("birthdays-section");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("birthdays-empty")).toContainText("und in den 14 Tagen danach hat niemand Geburtstag");
    await expect(section.getByTestId("today-item")).toHaveCount(0);
    // Die Navigation steht weiterhin in der ersten Karte.
    await expect(section.getByTestId("today-prev")).toBeVisible();
  });

  test("ohne Familie: Hinweis statt Listen, Einstieg bleibt", async ({ loginAs }) => {
    const { page } = await loginAs("nofamily");
    await page.goto(url(BUSY));
    await expect(page.getByTestId("today-no-family")).toContainText("Noch keine Familie freigegeben");
    await expect(page.getByTestId("today-section")).toHaveCount(0);
    await expect(page.getByTestId("birthdays-section")).toHaveCount(0);
    await expect(page.getByTestId("today-item")).toHaveCount(0);
    await expect(page.getByTestId("start-entries")).toBeVisible();
  });
});

test.describe("Startseite auf dem Telefon", () => {
  test.use({ storageState: authFile("admin"), viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`kein waagerechtes Scrollen, Tippflächen, Barrierefreiheit (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url(BIRTHDAY_DAY));
      await expect(page.getByTestId("birthdays-list")).toBeVisible();
      await expect(page.getByTestId("today-mark").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      for (const id of ["today-prev", "today-next", "start-tree", "start-statistics", "start-records"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.height, id).toBeGreaterThanOrEqual(44);
      }
      const link = (await page.getByTestId("today-person-link").first().boundingBox())!;
      expect(link.height, "Tippfläche eines Namens").toBeGreaterThanOrEqual(44);
      await expectNoA11yViolations(page);
    });
  }
});
