// Webpack-Loader (eingehängt in next.config.mjs): spielt eine Korrektur aus
// React 19.3 in das React zurück, das Next.js 15.5 für den App Router
// mitbringt (next/dist/compiled/react-dom, 19.2.0-canary).
//
// Der Fehler (facebook/react#35210, behoben mit PR #35494 „[Fiber] Correctly
// handle replaying when hydrating“): Der Server lagert große Teile einer Liste
// in eigene, später gesendete RSC-Zeilen aus. Beginnt die Hydration, bevor
// sie da sind, hält React am umgebenden Element (z.B. <ul>) an und setzt
// später genau dort wieder auf („replay“). Dabei wurde der Zeiger auf das
// nächste zu übernehmende DOM-Element nicht zurückgestellt: er stand schon
// auf dem ersten Kind, React erwartete aber noch einmal das Element selbst —
// „Hydration failed“ (React #418), die Seite wurde im Browser neu aufgebaut.
//
// Die Korrektur stellt den Zeiger vor dem Wiederaufsetzen zurück — dieselben
// Zeilen wie in React 19.3. Passt die Stelle nicht mehr (anderes Next/React),
// bricht der Build mit einer klaren Meldung ab, statt den Fehler still
// zurückzubringen. Enthält React die Korrektur schon, bleibt die Datei
// unverändert — dann kann dieser Loader samt Regel in next.config.mjs weg.
//
// Beschreibung: docs/komponenten/betrieb-und-tests.md („Hydration-Fehler“).

/** Welche Dateien der Loader bearbeitet (Regel in next.config.mjs, Test). */
const TARGET =
  /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(-experimental)?[\\/]cjs[\\/]react-dom-(client|profiling)\.(production|development|profiling)\.js$/;

// Wiederaufsetzen an einem Host-Element (Fiber-Tag 5) in replayBeginWork bzw.
// replaySuspendedUnitOfWork — in allen Fassungen dieselbe Form.
const BROKEN = /(case 5:\s*resetHooksOnUnwind\((\w+)\);)(\s*default:\s*unwindInterruptedWork\()/g;
// So sieht die Stelle aus, wenn React die Korrektur selbst enthält.
const FIXED = /case 5:\s*resetHooksOnUnwind\(\w+\);[\s\S]{0,200}?\w+ === hydrationParentFiber &&/;
const NEEDED = ["hydrationParentFiber", "nextHydratableInstance", "isHydrating", "function popToNextHostParent("];

/**
 * @param {string} source Inhalt von react-dom-client.*.js
 * @returns {{ code: string, status: "patched" | "upstream" }}
 */
function applyHydrationReplayFix(source) {
  if (FIXED.test(source)) return { code: source, status: "upstream" };
  const hits = source.match(BROKEN)?.length ?? 0;
  const missing = NEEDED.filter((name) => !source.includes(name));
  if (hits !== 1 || missing.length > 0) {
    throw new Error(
      "react-hydration-replay-fix: Die zu korrigierende Stelle in React wurde nicht (eindeutig) gefunden " +
        `(Treffer: ${hits}${missing.length ? `, fehlt: ${missing.join(", ")}` : ""}). ` +
        "Vermutlich wurde Next.js/React aktualisiert — prüfen, ob die Korrektur (facebook/react#35494) " +
        "enthalten ist, und lib/next-patches/react-hydration-replay-fix.cjs anpassen oder entfernen.",
    );
  }
  const code = source.replace(
    BROKEN,
    (_all, head, fiber, tail) =>
      `${head}
      /* Rückportierung facebook/react#35494 (lib/next-patches/react-hydration-replay-fix.cjs) */
      ${fiber} === hydrationParentFiber &&
        (isHydrating
          ? (popToNextHostParent(${fiber}),
            5 === ${fiber}.tag &&
              null != ${fiber}.stateNode &&
              (nextHydratableInstance = ${fiber}.stateNode))
          : (popToNextHostParent(${fiber}), (isHydrating = !0)));${tail}`,
  );
  return { code, status: "patched" };
}

module.exports = function reactHydrationReplayFixLoader(source) {
  return applyHydrationReplayFix(source).code;
};
module.exports.applyHydrationReplayFix = applyHydrationReplayFix;
module.exports.TARGET = TARGET;
