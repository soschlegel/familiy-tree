import type { Metadata, Viewport } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import Link from "next/link";

import "./globals.css";
import "reactflow/dist/style.css";
import { auth, signOut } from "@/lib/auth";
import { can } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { buildInfo, buildLabel } from "@/lib/build-info";
import { MainContainer, NavBar, type NavItem } from "@/components/NavBar";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { releaseNotes } from "@/lib/release-notes-data";
import { releasesSince } from "@/lib/release-notes";
import { FooterHelpLink } from "@/components/HelpLink";

export const metadata: Metadata = {
  title: { default: "Stammbaum", template: "%s · Stammbaum" },
  description: "Familienstammbaum mit Bildarchiv",
};

// Browserleiste auf dem Telefon in der Papierfarbe (--paper in globals.css),
// damit sie beim Ein- und Ausblenden nicht als fremder Streifen absticht.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#12100e" },
  ],
};

// Überschriften in einer Antiqua mit Charakter, Fließtext in einer gut
// lesbaren Grotesk. Beide selbst gehostet über next/font, mit Systemschrift
// als Rückfall (siehe tailwind.config.ts).
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  axes: ["opsz"],
});
const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  EDITOR: "Bearbeiter",
  VIEWER: "Betrachter",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

  // „KI-Zugang“ nur zeigen, wenn er dem Benutzer etwas nützt: mit Recht, oder
  // mit noch nicht widerrufenen Schlüsseln (die er dort widerrufen kann). Die
  // Seite selbst erreicht jeder und erklärt dort die Lage.
  const ai = user
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          aiAccess: true,
          lastSeenReleaseId: true,
          _count: { select: { apiTokens: { where: { revokedAt: null } } } },
        },
      })
    : null;
  const showAi = Boolean(ai && (ai.aiAccess !== "NONE" || ai._count.apiTokens > 0));

  // Neuigkeiten (CHANGELOG.md): einmal „Was ist neu?“ nach einer neuen
  // Version, mit den Releases seit dem zuletzt gesehenen (docs/entwicklung/neuigkeiten.md).
  const releases = releaseNotes();
  const whatsNew = ai ? releasesSince(releases, ai.lastSeenReleaseId) : { show: [], more: 0 };

  const items: NavItem[] = user
    ? [
        { href: "/tree", label: "Baum" },
        { href: "/map", label: "Karte" },
        { href: "/people", label: "Personen" },
        { href: "/research", label: "Recherche" },
        { href: "/sources", label: "Quellen" },
        // Export steht allen offen (enthält nur, was der Benutzer sehen
        // darf); der Import ist auf der Seite selbst Administratoren
        // vorbehalten.
        { href: "/admin/data", label: "Daten" },
        // Untermenü „Verwaltung“ (components/NavBar.tsx), damit die
        // Kopfzeile auch bei mittlerer Breite einzeilig bleibt.
        ...(showAi ? [{ href: "/ai-access", label: "KI-Zugang", group: "admin" as const }] : []),
        ...(can(user.role, "family:manage")
          ? [{ href: "/admin/families", label: "Familien", group: "admin" as const }]
          : []),
        ...(can(user.role, "user:manage")
          ? [{ href: "/admin/users", label: "Benutzer", group: "admin" as const }]
          : []),
        ...(can(user.role, "audit:read")
          ? [{ href: "/admin/changes", label: "Änderungen", group: "admin" as const }]
          : []),
        ...(can(user.role, "setting:manage")
          ? [{ href: "/admin/settings", label: "Einstellungen", group: "admin" as const }]
          : []),
        // Anwender-Hilfe (docs/anwender/) — für alle, zuletzt im Untermenü.
        { href: "/hilfe", label: "Hilfe", group: "admin" as const },
      ]
    : [];

  return (
    <html lang="de" className={`${serif.variable} ${sans.variable}`}>
      {/* Spalte über mindestens die sichtbare Höhe (min-height in
          globals.css); <main> wächst, die Fußzeile sitzt so immer am
          unteren Rand. */}
      <body className="flex flex-col">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow dark:focus:bg-stone-900"
        >
          Zum Inhalt springen
        </a>
        {user && (
          <NavBar
            items={items}
            userLabel={`${user.name ?? user.email} · ${ROLE_LABEL[user.role] ?? user.role}`}
            signOut={
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="btn-secondary">Abmelden</button>
              </form>
            }
          />
        )}
        <MainContainer>{children}</MainContainer>
        {whatsNew.show.length > 0 && (
          <WhatsNewDialog releases={whatsNew.show} more={whatsNew.more} latestId={releases[0].id} />
        )}
        {/* Feste Höhe (--footer-h): die Baumseite rechnet sie aus ihrer Höhe heraus. */}
        <footer className="flex h-[var(--footer-h)] shrink-0 items-center justify-center gap-x-3 px-4 text-xs muted">
          <span data-testid="build-info" className="tabular-nums">
            {buildLabel(buildInfo(), Boolean(user))}
          </span>
          {/* Neuigkeiten nur für Angemeldete, wie die genaue Build-Angabe. */}
          {user && (
            <Link href="/neuigkeiten" className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100" data-testid="footer-news">
              Neuigkeiten
            </Link>
          )}
          {user && <FooterHelpLink />}
        </footer>
      </body>
    </html>
  );
}
