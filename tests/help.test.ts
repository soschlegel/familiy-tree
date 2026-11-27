import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getHelpTopic, listHelpTopics } from "@/lib/help/content";
import { HELP_LINKS } from "@/lib/help/links";
import { collectLinks, headingIds, parseHelpMarkdown, parseInline, resolveHref, slugify } from "@/lib/help/markdown";
import { renderHelpBlocks } from "@/components/help-render";

const html = (md: string) => renderToStaticMarkup(createElement("div", null, renderHelpBlocks(parseHelpMarkdown(md).blocks)));

describe("Anwender-Hilfe: Markdown-Leser", () => {
  it("liest Titel, Kurzbeschreibung und Blöcke", () => {
    const doc = parseHelpMarkdown("# Karte\n\nErster Absatz\nzweite Zeile.\n\n## Wie wird gezählt?\n\n- eins\n  weiter\n- zwei\n\n1. a\n2. b\n");
    expect(doc.title).toBe("Karte");
    expect(doc.summary).toBe("Erster Absatz zweite Zeile.");
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "list", "list"]);
    expect(headingIds(doc)).toEqual(["wie-wird-gezaehlt"]);
    const list = doc.blocks[2];
    expect(list.type === "list" && list.items.length).toBe(2);
  });

  it("Anker: Umlaute, Anführungszeichen, doppelte Überschriften", () => {
    expect(slugify("Was bedeuten „sicher“, „wahrscheinlich“ und „unklar“?")).toBe("was-bedeuten-sicher-wahrscheinlich-und-unklar");
    expect(slugify("Größe & Straße")).toBe("groesse-strasse");
    expect(headingIds(parseHelpMarkdown("# T\n\n## Tipp\n\n## Tipp\n"))).toEqual(["tipp", "tipp-2"]);
  });

  it("Inline: fett, kursiv, Code, Links, Maskierung", () => {
    expect(parseInline("**fett** und *kursiv* mit `code`").map((n) => n.type)).toEqual(["strong", "text", "em", "text", "code"]);
    expect(parseInline("5 * 3 und \\*kein\\*")).toEqual([{ type: "text", text: "5 * 3 und *kein*" }]);
    expect(html("# T\n\nSiehe [Karte](05-karte.md#wie-wird-gezaehlt).")).toContain('href="/hilfe/karte#wie-wird-gezaehlt"');
  });

  it("Tabellen und Hinweiskästen", () => {
    const out = html("# T\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n> **Gut zu wissen:** x\n");
    expect(out).toContain("<th");
    expect(out).toContain("<strong");
    expect(out).toContain("<aside");
  });
});

describe("Anwender-Hilfe: sicher", () => {
  it("rohes HTML bleibt Text", () => {
    const out = html('# T\n\n<script>alert(1)</script> <img src=x onerror="alert(1)">\n\n<b>fett</b>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("gefährliche Linkziele werden kein Link", () => {
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//boese.example/x", "/\\boese.example", "http://example.de", "vbscript:x", "05-karte.md#\"x", "mailto:a@b.de"]) {
      expect(resolveHref(bad), bad).toBeNull();
      const out = html(`# T\n\n[Klick](${bad})`);
      expect(out, bad).not.toContain("<a");
      expect(out, bad).toContain("Klick");
    }
  });

  it("erlaubte Linkziele", () => {
    expect(resolveHref("05-karte.md")).toEqual({ kind: "help", slug: "karte", hash: null });
    expect(resolveHref("/admin/places")).toEqual({ kind: "app", path: "/admin/places" });
    expect(resolveHref("#anker")).toEqual({ kind: "anchor", hash: "anker" });
    expect(resolveHref("https://www.geonames.org/")).toEqual({ kind: "external", url: "https://www.geonames.org/" });
    const out = html("# T\n\n[GeoNames](https://www.geonames.org/)");
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe("Anwender-Hilfe: Inhalte in docs/anwender/", () => {
  const topics = listHelpTopics();

  it("Themen in fester Reihenfolge, jedes mit Titel und Kurzbeschreibung", () => {
    expect(topics.map((t) => t.slug)).toEqual([
      "erste-schritte",
      "personen",
      "quellen-und-belege",
      "stammbaum",
      "karte",
      "orte-zuordnen",
      "dubletten",
      "import-und-export",
      "aenderungen",
      "ki-zugang",
      "datenschutz",
      "einstellungen",
      "statistik",
      "startseite",
    ]);
    for (const t of topics) {
      expect(t.title, t.file).not.toBe("Hilfe");
      expect(t.summary.length, t.file).toBeGreaterThan(20);
    }
  });

  it("jeder Querverweis zeigt auf ein vorhandenes Thema und einen vorhandenen Anker", () => {
    for (const t of topics) {
      const { doc } = getHelpTopic(t.slug)!;
      for (const href of collectLinks(doc)) {
        if (href.kind === "help") {
          const target = getHelpTopic(href.slug);
          expect(target, `${t.file} → ${href.slug}`).not.toBeNull();
          if (href.hash) expect(headingIds(target!.doc), `${t.file} → ${href.slug}#${href.hash}`).toContain(href.hash);
        }
        if (href.kind === "anchor") expect(headingIds(doc), `${t.file} → #${href.hash}`).toContain(href.hash);
      }
    }
  });

  it("jede Kontexthilfe der App zeigt auf ein vorhandenes Thema und einen vorhandenen Anker", () => {
    for (const [key, url] of Object.entries(HELP_LINKS)) {
      const m = /^\/hilfe\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(url);
      expect(m, key).not.toBeNull();
      const found = getHelpTopic(m![1]);
      expect(found, key).not.toBeNull();
      if (m![2]) expect(headingIds(found!.doc), key).toContain(m![2]);
    }
  });

  it("nur Dateien NN-thema.md zählen (README und anderes nicht)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hilfe-"));
    writeFileSync(path.join(dir, "README.md"), "# Pflege\n\nNicht anzeigen.");
    writeFileSync(path.join(dir, "02-zwei.md"), "# Zwei\n\nZweites Thema.");
    writeFileSync(path.join(dir, "01-eins.md"), "# Eins\n\nErstes Thema.");
    writeFileSync(path.join(dir, "notiz.md"), "# Notiz");
    expect(listHelpTopics(dir).map((t) => t.slug)).toEqual(["eins", "zwei"]);
    expect(getHelpTopic("readme", dir)).toBeNull();
  });
});
