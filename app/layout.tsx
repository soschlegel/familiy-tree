import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";
import "reactflow/dist/style.css";
import { auth, signOut } from "@/lib/auth";
import { can } from "@/lib/authz";

export const metadata: Metadata = {
  title: "Stammbaum",
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

  return (
    <html lang="de">
      <body className="min-h-screen">
        {session?.user && (
          <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <Link href="/tree" className="font-semibold">
                Stammbaum
              </Link>
              <Link href="/tree" className="text-sm hover:underline">
                Baum
              </Link>
              <Link href="/people" className="text-sm hover:underline">
                Personen
              </Link>
              <Link href="/admin/data" className="text-sm hover:underline">
                Daten
              </Link>
              {can(session.user.role, "family:manage") && (
                <Link href="/admin/families" className="text-sm hover:underline">
                  Familien
                </Link>
              )}
              {can(session.user.role, "user:manage") && (
                <Link href="/admin/users" className="text-sm hover:underline">
                  Benutzer
                </Link>
              )}

              <div className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-stone-500">
                  {session.user.name ?? session.user.email}
                  {" · "}
                  {ROLE_LABEL[session.user.role]}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">
                    Abmelden
                  </button>
                </form>
              </div>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
