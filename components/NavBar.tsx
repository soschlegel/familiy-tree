"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDismiss } from "./useDismiss";

/** `group: "admin"` = im Untermenü „Verwaltung“ statt in der Hauptzeile. */
export type NavItem = { href: string; label: string; group?: "admin" };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Kopfzeile. Auf breiten Bildschirmen eine Zeile, auf schmalen ein
 * aufklappbares Menü. Der aktuelle Bereich ist markiert (aria-current).
 */
export function NavBar({
  items,
  userLabel,
  signOut,
}: {
  items: NavItem[];
  userLabel: string;
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Nach einem Seitenwechsel ist das Menü wieder zu.
  useEffect(() => setOpen(false), [pathname]);

  // Klick daneben, Escape (Fokus zurück auf „Menü") und Tab aus dem Menü
  // heraus schließen es.
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [menuRef, toggleRef], toggleRef);

  // Untermenü „Verwaltung“ (ab lg): Familien, Benutzer, Änderungen, KI-Zugang …
  const mainItems = items.filter((i) => !i.group);
  const adminItems = items.filter((i) => i.group === "admin");
  const adminActive = adminItems.some((i) => isActive(pathname, i.href));
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef<HTMLUListElement>(null);
  const adminToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setAdminOpen(false), [pathname]);
  const closeAdmin = useCallback(() => setAdminOpen(false), []);
  useDismiss(adminOpen, closeAdmin, [adminRef, adminToggleRef], adminToggleRef);

  const linkClass = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition ${
      active
        ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
        : "text-stone-600 hover:bg-stone-900/5 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-stone-50"
    }`;

  return (
    <header className="relative z-30 border-b border-stone-900/10 bg-surface/90 backdrop-blur dark:border-white/10">
      {/* Unter md ist der Menü-Knopf 44 px hoch (Tippziel); der kleinere
          Innenabstand hält die Kopfzeile bei 55 px — damit rechnet die Baumseite. */}
      <nav
        aria-label="Hauptnavigation"
        className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 max-md:py-[5px]"
      >
        <Link href="/tree" className="mr-4 flex items-center gap-2 max-lg:-my-2 max-lg:py-2" aria-label="Stammbaum — Startseite">
          <BrandMark />
          <span className="font-serif text-lg font-semibold tracking-tight">Stammbaum</span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {mainItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={linkClass(active)}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          {adminItems.length > 0 && (
            <li className="relative">
              <button
                ref={adminToggleRef}
                type="button"
                aria-expanded={adminOpen}
                aria-controls="admin-menu"
                data-active={adminActive || undefined}
                className={`${linkClass(adminActive)} inline-flex items-center gap-1`}
                onClick={() => setAdminOpen((o) => !o)}
              >
                Verwaltung
                <span aria-hidden className="text-[0.65rem]">
                  {adminOpen ? "▴" : "▾"}
                </span>
              </button>
              {adminOpen && (
                <ul
                  ref={adminRef}
                  id="admin-menu"
                  aria-label="Verwaltung"
                  className="absolute left-0 top-full z-40 mt-1.5 flex min-w-44 flex-col gap-1 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg dark:border-stone-800 dark:bg-stone-900"
                >
                  {adminItems.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`block ${linkClass(active)} py-1.5`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          )}
        </ul>

        {/* Bei knapper Breite (ab lg mit allen Menüpunkten) wird der Name
            gekürzt statt umzubrechen; vollständig steht er im Tooltip. */}
        <div className="ml-auto hidden min-w-0 items-center gap-3 text-sm lg:flex">
          <span className="muted min-w-0 truncate" title={userLabel}>
            {userLabel}
          </span>
          {signOut}
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="btn-secondary ml-auto lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden>{open ? "✕" : "☰"}</span>
          Menü
        </button>
      </nav>

      {open && (
        <div
          ref={menuRef}
          id="mobile-menu"
          className="absolute inset-x-0 top-full z-40 border-b border-stone-200 bg-white px-4 pb-4 pt-2 shadow-lg lg:hidden dark:border-stone-800 dark:bg-stone-900"
        >
          <ul className="flex flex-col gap-1">
            {mainItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block ${linkClass(active)} py-3`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Auf dem Telefon kein zweites Aufklappen: die Verwaltung als
              beschriftete Gruppe im selben Menü. */}
          {adminItems.length > 0 && (
            <>
              <p id="mobile-admin-h" className="eyebrow mt-3 px-3">
                Verwaltung
              </p>
              <ul className="mt-1 flex flex-col gap-1" aria-labelledby="mobile-admin-h">
                {adminItems.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block ${linkClass(active)} py-3`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800">
            <span className="muted min-w-0 truncate">{userLabel}</span>
            {signOut}
          </div>
        </div>
      )}
    </header>
  );
}

/** Kleines Zeichen: Wurzel, Stamm und Krone als stilisierter Stammbaum. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" className="fill-accent-700 dark:fill-accent-300" />
      <g className="stroke-white dark:stroke-stone-950" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M16 25V15M16 15l-5-4M16 15l5-4M11 11V8M21 11V8" />
      </g>
      <g className="fill-brass-300 dark:fill-brass-600">
        <circle cx="11" cy="7.5" r="2.2" />
        <circle cx="21" cy="7.5" r="2.2" />
        <circle cx="16" cy="25.5" r="2.2" />
      </g>
    </svg>
  );
}

/**
 * Inhaltsbereich. Der Stammbaum nutzt die volle Breite, alle anderen Seiten
 * bleiben auf Lesebreite.
 */
export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = pathname === "/tree" || pathname.startsWith("/tree/");
  return (
    <main
      id="inhalt"
      // flex-1: füllt die Höhe zwischen Kopf- und Fußzeile (body ist eine
      // Spalte, app/layout.tsx); w-full, weil auto-Ränder sonst die Breite
      // auf den Inhalt schrumpfen ließen.
      className={wide ? "w-full flex-1 px-2 py-3 sm:px-4" : "mx-auto w-full max-w-6xl flex-1 px-4 py-6"}
    >
      {children}
    </main>
  );
}
