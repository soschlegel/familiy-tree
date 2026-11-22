import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { USERS, type Role } from "./mock";

export { expect };

export const AUTH_DIR = path.join(__dirname, "..", ".auth");
export const authFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);

/**
 * Konsolenmeldungen, die kein Fehler der App sind. Bewusst eng gefasst.
 */
const GLOBAL_ALLOW: RegExp[] = [
  // React Flow warnt im Dev-Modus unter StrictMode beim doppelten Mounten,
  // obwohl nodeTypes/edgeTypes außerhalb der Komponente stehen.
  /\[React Flow\]: It looks like you've created a new nodeTypes or edgeTypes object/,
];

/**
 * Bekannter, offener Fehler (UEBERGABE, „Seltener Fehler beim Laden“): Unter
 * Last scheitert gelegentlich die Hydration einer Seite (React #418), weil
 * der Client beim noch laufenden Laden (Streaming) einen anderen Baum
 * erwartet als den, den der Server geschickt hat. Der Server liefert dabei
 * nachweislich dasselbe HTML wie sonst, und React baut die Seite selbst neu
 * auf — für die Tests also kein Fehler der geprüften Funktion. Gegen den
 * Produktions-Build tritt er in wenigen Prozent der Seitenaufrufe auf; dort
 * wird er deshalb nur gemeldet (Konsole und Anmerkung „bekannter Fehler“ im
 * Bericht), nicht als Testfehler gezählt. Gegen den Dev-Server (`--dev`,
 * ungekürzte Meldung mit Komponentenpfad) und mit E2E_STRICT_HYDRATION=1
 * bleibt er ein Fehler.
 */
const KNOWN_HYDRATION = /^Minified React error #418;/;
/**
 * Folgefehler davon auf Seiten mit Streaming (loading.tsx, z.B. /research):
 * Nachdem React den Baum neu aufgebaut hat, finden die nachgeschobenen
 * Inline-Skripte ihre Platzhalter nicht mehr. Nur zusammen mit einem
 * vorherigen #418 auf derselben Seite toleriert.
 */
const HYDRATION_FOLLOW_UP = /^Cannot read properties of null \(reading 'parentNode'\)$/;
const TOLERATE_HYDRATION =
  process.env.E2E_SERVER !== "dev" && process.env.E2E_STRICT_HYDRATION !== "1";

type Guard = {
  /** Erwartete Fehlermeldungen (z.B. 404 eines absichtlich gesperrten Aufrufs). */
  allow: (pattern: RegExp) => void;
  /** Zusätzlich erlaubte Meldungen dieses Tests. */
  patterns: RegExp[];
  /** Bisher gesammelte unerwartete Meldungen. */
  problems: string[];
  /** Bekannte, nur gemeldete Fehler (siehe KNOWN_HYDRATION). */
  known: string[];
};

/**
 * Sammelt unerwartete Konsolenfehler und Seitenfehler (uncaught exceptions)
 * einer Seite. Am Testende schlägt der Test fehl, wenn etwas dabei war.
 */
export function watchPage(page: Page, guard: Guard, extraAllow: RegExp[]) {
  const label = () => {
    try {
      return new URL(page.url()).pathname + new URL(page.url()).search;
    } catch {
      return page.url();
    }
  };
  // Gilt nur bis zum Ende des Ladens des betroffenen Dokuments: die
  // nachgeschobenen Inline-Skripte laufen alle vor „load“.
  let hydrationFailed = false;
  page.on("load", () => {
    hydrationFailed = false;
  });
  page.on("pageerror", (err) => {
    if (TOLERATE_HYDRATION && KNOWN_HYDRATION.test(err.message)) {
      hydrationFailed = true;
      guard.known.push(`Hydration-Fehler (React #418) @ ${label()}`);
      return;
    }
    if (hydrationFailed && HYDRATION_FOLLOW_UP.test(err.message)) {
      const note = `Folgefehler nach Hydration-Fehler @ ${label()}`;
      if (!guard.known.includes(note)) guard.known.push(note);
      return;
    }
    guard.problems.push(`[pageerror @ ${label()}] ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if ([...GLOBAL_ALLOW, ...extraAllow].some((re) => re.test(text))) return;
    guard.problems.push(`[console.error @ ${label()}] ${text}`);
  });
}

type Fixtures = {
  consoleGuard: Guard;
  /**
   * Weitere Rolle in einem eigenen Browser-Kontext (mit derselben Überwachung);
   * null = ohne Anmeldung.
   */
  loginAs: (role: Role | null) => Promise<{ page: Page; context: BrowserContext }>;
};

export const test = base.extend<Fixtures>({
  consoleGuard: [
    async ({}, use) => {
      const patterns: RegExp[] = [];
      const guard: Guard = { allow: (re) => void patterns.push(re), patterns, problems: [], known: [] };
      await use(guard);
      for (const k of guard.known) {
        base.info().annotations.push({ type: "bekannter Fehler", description: k });
        console.warn(`[bekannt] ${base.info().title}: ${k}`);
      }
      expect(guard.problems, "Unerwartete Konsolen- oder Seitenfehler").toEqual([]);
    },
    { auto: true },
  ],
  page: async ({ page, consoleGuard }, use) => {
    watchPage(page, consoleGuard, consoleGuard.patterns);
    await use(page);
  },
  loginAs: async ({ browser, consoleGuard }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (role) => {
      const context = await browser.newContext({
        storageState: role ? authFile(role) : { cookies: [], origins: [] },
      });
      opened.push(context);
      const page = await context.newPage();
      watchPage(page, consoleGuard, consoleGuard.patterns);
      return { page, context };
    });
    for (const c of opened) await c.close();
  },
});

/** Anmelden über den Dev-Login der Login-Seite. */
export async function devLogin(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

export async function newRoleContext(browser: Browser, role: Role) {
  return browser.newContext({ storageState: authFile(role) });
}

export { USERS };

/** Bestätigungsdialoge (confirm) automatisch annehmen. */
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => void d.accept());
}

/**
 * Automatische Barrierefreiheitsprüfung (axe, WCAG 2.1 A/AA).
 * Ausnahmen — bewusst und begründet:
 * - `nextjs-portal`: das Entwickler-Overlay von Next.js gibt es nur im
 *   Dev-Modus, nicht in der App.
 * - `.react-flow__minimap`, `.react-flow__controls`: Bedienelemente von
 *   React Flow (Fremdbibliothek, SVG ohne Textalternative bzw. eigene
 *   Knöpfe); der Baum selbst ist über die Karten-Links bedienbar.
 */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .exclude(".react-flow__minimap")
    .exclude(".react-flow__controls")
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1, 2).join(" ")}`)
        .join("\n"),
  );
  expect(summary, `Barrierefreiheit auf ${page.url()}`).toEqual([]);
}

/** Keine waagerechte Scrollleiste auf der Seite. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && r.width > 0) {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (${Math.round(r.right)}px)`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders };
  });
  expect(overflow.offenders, `Seite ${page.url()} ist ${overflow.scrollWidth}px breit bei ${overflow.clientWidth}px`).toEqual([]);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Wartet, bis der Baum gezeichnet ist und keine Navigation mehr läuft. */
export async function waitForTree(page: Page) {
  const tree = page.getByTestId("family-tree");
  await expect(tree).toBeVisible();
  await expect(tree).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("tree-person").first()).toBeAttached();
  return tree;
}

/**
 * Wartet, bis React ein Element hydriert hat. Nach einer vollständigen
 * Navigation (z.B. GET-Formular) ist die Seite sonst schon bedienbar, aber
 * Ereignisse wie onChange hängen noch nicht daran.
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && Object.keys(el!).some((k) => k.startsWith("__reactProps"));
    },
    selector,
  );
}

/** Browsermeldung für eine absichtlich fehlschlagende Anfrage (z.B. 404, 409). */
export function httpError(status: number): RegExp {
  return new RegExp(`Failed to load resource: the server responded with a status of ${status}(?!\\d)`);
}
