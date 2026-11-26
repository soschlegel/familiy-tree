import { test, expect, authFile, waitForTree } from "../support/fixtures";

/**
 * Content-Security-Policy (lib/csp.ts, middleware.ts): Richtlinie mit Nonce
 * auf den Seiten, Nonce an allen Skripten von Next.js, feste Richtlinie der
 * API — und der CSP-Wächter der Fixtures schlägt bei einer Verletzung an.
 * Ob die Seiten selbst ohne Verletzung laufen, prüft der Wächter in jedem
 * anderen Test mit.
 */
test("Seiten: Richtlinie mit Nonce, jedes Skript trägt sie", async ({ page }) => {
  const res = await page.goto("/login");
  const policy = res?.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce, policy).toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  // 'unsafe-eval' nur im Dev-Server (Fehlerhilfen von React/Next.js).
  if (process.env.E2E_SERVER !== "dev") expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  expect(policy).toContain("form-action 'self' https://github.com https://accounts.google.com");
  expect(policy).toContain("frame-ancestors 'none'");

  // Der Browser verbirgt das nonce-Attribut nach dem Parsen; die
  // Eigenschaft `nonce` bleibt lesbar.
  const nonces = await page.locator("script").evaluateAll((els) => els.map((s) => (s as HTMLScriptElement).nonce));
  expect(nonces.length).toBeGreaterThan(0);
  expect(new Set(nonces)).toEqual(new Set([nonce]));

  // Jede Antwort eine neue Nonce.
  const again = await page.request.get("/login");
  expect(again.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
});

test("API: feste, strenge Richtlinie ohne Nonce", async ({ page }) => {
  const res = await page.request.get("/api/health");
  expect(res.headers()["content-security-policy"]).toBe(
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; sandbox",
  );
});

test("CSP-Wächter: ein Skript ohne Nonce wird blockiert und gemeldet", async ({ browser }) => {
  // Eigener Kontext ohne den Wächter der Fixture — hier ist die Verletzung gewollt.
  const context = await browser.newContext({ storageState: authFile("viewer") });
  const page = await context.newPage();
  const messages: string[] = [];
  page.on("console", (m) => messages.push(m.text()));
  await page.goto("/tree");
  await waitForTree(page);
  const result = await page.evaluate(
    () =>
      new Promise<{ ran: boolean; directive: string }>((resolve) => {
        const w = window as unknown as { __cspProbe?: boolean };
        document.addEventListener(
          "securitypolicyviolation",
          (e) => resolve({ ran: Boolean(w.__cspProbe), directive: e.effectiveDirective }),
          { once: true },
        );
        // Wie eingeschleustes HTML: Inline-Ereignishandler ohne Nonce.
        const s = document.createElement("div");
        s.innerHTML = "<img src=x onerror=\"window.__cspProbe=true\">";
        document.body.appendChild(s);
      }),
  );
  expect(result.ran).toBe(false);
  expect(["script-src-attr", "script-src"]).toContain(result.directive);
  await expect.poll(() => messages.some((m) => /Content Security Policy/i.test(m))).toBe(true);
  await context.close();
});
