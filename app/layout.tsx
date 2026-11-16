import type { Metadata } from "next";

import "./globals.css";
import "reactflow/dist/style.css";
import { auth, signOut } from "@/lib/auth";
import { can } from "@/lib/authz";
import { MainContainer, NavBar, type NavItem } from "@/components/NavBar";

export const metadata: Metadata = {
  title: { default: "Stammbaum", template: "%s · Stammbaum" },
  description: "Familienstammbaum mit Bildarchiv",
};

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

  const items: NavItem[] = user
    ? [
        { href: "/tree", label: "Baum" },
        { href: "/people", label: "Personen" },
        { href: "/research", label: "Recherche" },
        // Export steht allen offen (enthält nur, was der Benutzer sehen
        // darf); der Import ist auf der Seite selbst Administratoren
        // vorbehalten.
        { href: "/admin/data", label: "Daten" },
        ...(can(user.role, "family:manage")
          ? [{ href: "/admin/families", label: "Familien" }]
          : []),
        ...(can(user.role, "user:manage")
          ? [{ href: "/admin/users", label: "Benutzer" }]
          : []),
      ]
    : [];

  return (
    <html lang="de">
      <body className="min-h-screen">
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
      </body>
    </html>
  );
}
