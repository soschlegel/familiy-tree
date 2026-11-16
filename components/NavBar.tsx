"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string };

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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const linkClass = (active: boolean) =>
    `rounded-md px-2 py-1 text-sm transition ${
      active
        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-50"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
    }`;

  return (
    <header className="relative border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <nav
        aria-label="Hauptnavigation"
        className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5"
      >
        <Link href="/tree" className="mr-3 font-semibold">
          Stammbaum
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
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
        </ul>

        <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
          <span className="muted">{userLabel}</span>
          {signOut}
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="btn-secondary ml-auto md:hidden"
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
          className="absolute inset-x-0 top-full z-40 border-b border-stone-200 bg-white px-4 pb-4 pt-2 shadow-lg md:hidden dark:border-stone-800 dark:bg-stone-900"
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block ${linkClass(active)} py-2`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800">
            <span className="muted min-w-0 truncate">{userLabel}</span>
            {signOut}
          </div>
        </div>
      )}
    </header>
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
      className={wide ? "px-2 py-3 sm:px-4" : "mx-auto max-w-6xl px-4 py-6"}
    >
      {children}
    </main>
  );
}
