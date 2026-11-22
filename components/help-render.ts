import Link from "next/link";
import { createElement as h, Fragment, type ReactNode } from "react";

import type { Block, HelpHref, Inline } from "@/lib/help/markdown";

/**
 * Syntaxbaum der Anwender-Hilfe (lib/help/markdown.ts) → React-Elemente.
 * Kein dangerouslySetInnerHTML: jeder Text geht als Text an React und wird
 * dort maskiert. Links nur auf geprüfte Ziele (resolveHref): Hilfethemen und
 * eigene Seiten über next/link, externe (nur https) in neuem Tab ohne
 * Referrer.
 *
 * Absichtlich ohne JSX (.ts), damit tests/help.test.ts die Ausgabe mit
 * renderToStaticMarkup prüfen kann. Liegt unter components/, damit Tailwind
 * die Klassen findet.
 */

export function hrefOf(href: HelpHref): string {
  switch (href.kind) {
    case "help":
      return `/hilfe/${href.slug}${href.hash ? `#${href.hash}` : ""}`;
    case "anchor":
      return `#${href.hash}`;
    case "app":
      return href.path;
    case "external":
      return href.url;
  }
}

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return h(Fragment, { key: i }, n.text);
      case "strong":
        return h("strong", { key: i, className: "font-semibold" }, ...inline(n.children));
      case "em":
        return h("em", { key: i }, ...inline(n.children));
      case "code":
        return h("code", { key: i, className: "rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-stone-800" }, n.text);
      case "link": {
        const className = "font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800 dark:text-accent-300 dark:hover:text-accent-200";
        if (n.href.kind === "external") {
          return h("a", { key: i, href: n.href.url, target: "_blank", rel: "noopener noreferrer", className }, ...inline(n.children));
        }
        return h(Link, { key: i, href: hrefOf(n.href), className }, ...inline(n.children));
      }
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "page-title",
  2: "section-title mt-8 scroll-mt-20 text-xl",
  3: "mt-6 scroll-mt-20 font-semibold",
  4: "mt-4 scroll-mt-20 text-sm font-semibold",
};

function block(b: Block, key: number): ReactNode {
  switch (b.type) {
    case "heading":
      return h(`h${b.level}`, { key, id: b.id, className: HEADING_CLASS[b.level] }, ...inline(b.children));
    case "paragraph":
      return h("p", { key, className: "leading-relaxed" }, ...inline(b.children));
    case "list":
      return h(
        b.ordered ? "ol" : "ul",
        { key, className: `${b.ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 leading-relaxed` },
        ...b.items.map((item, i) => h("li", { key: i }, ...inline(item))),
      );
    case "note":
      return h(
        "aside",
        { key, className: "alert-info space-y-2 border-l-4 border-l-accent-500 leading-relaxed dark:border-l-accent-400" },
        ...b.children.map(block),
      );
    case "table":
      // Eigener Rahmen mit Scrollen: breite Tabellen schieben auf dem
      // Telefon nicht die ganze Seite zur Seite.
      return h(
        "div",
        { key, className: "max-w-full overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800", tabIndex: 0 },
        h(
          "table",
          { className: "w-full border-collapse text-left text-sm" },
          h(
            "thead",
            { className: "bg-stone-50 dark:bg-stone-900" },
            h("tr", null, ...b.head.map((c, i) => h("th", { key: i, scope: "col", className: "px-3 py-2 font-semibold" }, ...inline(c)))),
          ),
          h(
            "tbody",
            null,
            ...b.rows.map((r, ri) =>
              h(
                "tr",
                { key: ri, className: "border-t border-stone-200 align-top dark:border-stone-800" },
                ...r.map((c, ci) => h("td", { key: ci, className: "px-3 py-2" }, ...inline(c))),
              ),
            ),
          ),
        ),
      );
    case "code":
      return h(
        "pre",
        { key, className: "overflow-x-auto rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-800", tabIndex: 0 },
        h("code", null, b.text),
      );
    case "rule":
      return h("hr", { key, className: "border-stone-200 dark:border-stone-800" });
  }
}

/** Blöcke eines Hilfethemas als Fließtext. */
export function renderHelpBlocks(blocks: Block[]): ReactNode {
  return h("div", { className: "max-w-3xl space-y-4", "data-testid": "help-content" }, ...blocks.map(block));
}
