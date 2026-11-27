import Link from "next/link";
import { cookies } from "next/headers";
import { permanentRedirect } from "next/navigation";

import { requireScope } from "@/lib/session";
import { resolvePersonRedirect, resolveReference } from "@/lib/services";
import { FOCUS_COOKIE } from "@/lib/focus-tree";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { formatPrintDate, parseRingsPrintParams, RINGS_PRINT_PATH } from "@/lib/rings-print";
import { loadRingsView } from "@/lib/services/rings-view";
import { RingsPrintSheet } from "@/components/RingsPrintSheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ringe drucken" };

const ID_PATTERN = /^[\w-]{1,64}$/;

type Params = Promise<Record<string, string | string[] | undefined>>;

/**
 * „Ahnentafel zum Drucken“: die Ansicht „Ringe“ als Blatt bzw. Poster
 * (components/RingsPrintSheet.tsx, Regeln in lib/rings-print.ts). Dieselben
 * Adressparameter wie `/tree?view=rings` (focus, richtung, generationen,
 * farbe) plus format, ausrichtung, titel, datum, namen.
 *
 * Rechte: nur für Angemeldete (requireScope); Daten über dieselben Dienste
 * und dieselbe Wahl der Ausgangsperson wie die Ringe-Ansicht
 * (lib/services/rings-view.ts) — nicht sichtbare Personen erscheinen nur als
 * „nicht freigegeben“, eine angefragte gesperrte Person wie eine fehlende.
 * Kopfzeile und Fußzeile der App blendet der Seitenrahmen hier aus
 * (components/NavBar.tsx, app/globals.css).
 */
export default async function RingsPrintPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const { scope } = await requireScope();
  const settings = parseRingsPrintParams(params);

  // Alte Kennung einer aufgegangenen Person: auf die bleibende umleiten.
  if (settings.focus) {
    const mergedInto = await resolvePersonRedirect(scope, settings.focus);
    if (mergedInto) {
      const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
      query.set("focus", mergedInto);
      permanentRedirect(`${RINGS_PRINT_PATH}?${query}`);
    }
  }

  const noAccess = !scope.isAdmin && scope.families.size === 0;
  let view: Awaited<ReturnType<typeof loadRingsView>> = { data: null, notFound: false };
  if (!noAccess) {
    const jar = await cookies();
    const choice = await resolveReference(scope, { param: null, cookie: jar.get(REFERENCE_COOKIE)?.value ?? null });
    const remembered = jar.get(FOCUS_COOKIE)?.value;
    view = await loadRingsView(scope, {
      direction: settings.direction,
      generations: settings.generations,
      requested: settings.focus,
      candidates: [remembered && ID_PATTERN.test(remembered) ? remembered : null, choice.id],
    });
  }

  if (!view.data) {
    return (
      <div data-print-page className="px-4 py-10">
        <div className="card mx-auto max-w-2xl space-y-4 px-6 py-10 text-center" role="alert" data-testid="print-missing">
          <h1 className="section-title">{view.notFound ? "Person nicht gefunden" : "Nichts zu drucken"}</h1>
          <p className="text-sm muted">
            {view.notFound
              ? "Diese Person gibt es nicht, oder sie gehört zu einer Familie, für die du keine Freigabe hast."
              : "Dir ist noch keine Familie freigegeben, oder es sind noch keine Personen erfasst."}
          </p>
          <Link href="/tree?view=rings" className="btn-primary">
            Ringe öffnen
          </Link>
        </div>
      </div>
    );
  }

  return <RingsPrintSheet data={view.data} settings={settings} today={formatPrintDate(new Date())} />;
}
