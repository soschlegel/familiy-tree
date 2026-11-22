import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareReleaseIds,
  formatReleaseDate,
  parseReleaseId,
  parseReleaseNotes,
  releasesSince,
  type Release,
} from "@/lib/release-notes";
import { latestReleaseId, releaseNotes } from "@/lib/release-notes-data";

const SAMPLE = `# Neuigkeiten

Einleitung, wird übergangen.

<!--
## 1999-01-01.1 — im Kommentar, zählt nicht
-->

## 2026-11-22.2 — Zweites Release

- Erster Punkt
  mit Fortsetzung
- Zweiter Punkt

## 2026-11-22.1 – Erstes Release am Tag

* Stern als Aufzählung

## 2026-11-09.10 - Zweistellige Nummer

- Punkt
`;

describe("parseReleaseId / compareReleaseIds", () => {
  it("liest Datum und Nummer", () => {
    expect(parseReleaseId("2026-11-22.2")).toEqual({ date: "2026-11-22", seq: 2 });
    expect(parseReleaseId("2026-02-30.1")).toBeNull();
    expect(parseReleaseId("2026-11-22")).toBeNull();
    expect(parseReleaseId("2026-11-22.0")).toBeNull();
    expect(parseReleaseId("abc1234")).toBeNull();
  });

  it("ordnet nach Datum, dann nach Nummer (numerisch)", () => {
    expect(compareReleaseIds("2026-11-22.2", "2026-11-22.1")).toBeGreaterThan(0);
    expect(compareReleaseIds("2026-11-22.10", "2026-11-22.9")).toBeGreaterThan(0);
    expect(compareReleaseIds("2026-11-21.9", "2026-11-22.1")).toBeLessThan(0);
    expect(compareReleaseIds("2026-11-22.1", "2026-11-22.1")).toBe(0);
  });
});

describe("parseReleaseNotes", () => {
  it("liest Überschriften, Stichpunkte und Fortsetzungszeilen", () => {
    const { releases, errors } = parseReleaseNotes(SAMPLE);
    expect(errors).toEqual([]);
    expect(releases.map((r) => r.id)).toEqual(["2026-11-22.2", "2026-11-22.1", "2026-11-09.10"]);
    expect(releases[0]).toEqual({
      id: "2026-11-22.2",
      date: "2026-11-22",
      seq: 2,
      title: "Zweites Release",
      items: ["Erster Punkt mit Fortsetzung", "Zweiter Punkt"],
    });
    expect(releases[1].title).toBe("Erstes Release am Tag");
    expect(releases[1].items).toEqual(["Stern als Aufzählung"]);
  });

  it("verträgt Windows-Zeilenenden", () => {
    const { releases, errors } = parseReleaseNotes(SAMPLE.replace(/\n/g, "\r\n"));
    expect(errors).toEqual([]);
    expect(releases).toHaveLength(3);
  });

  it("meldet Fehler und übergeht fehlerhafte Releases", () => {
    const { releases, errors } = parseReleaseNotes(
      [
        "## 2026-11-22.1 — Gut",
        "- Punkt",
        "## a1b2c3d — Commit-Kennung statt Datum",
        "- Punkt",
        "## 2026-11-23.1 — Ohne Punkte",
        "",
        "## 2026-11-21.1 — Freitext",
        "Kein Stichpunkt",
        "- Punkt",
      ].join("\n"),
    );
    expect(releases.map((r) => r.id)).toEqual(["2026-11-22.1", "2026-11-21.1"]);
    expect(errors.join("\n")).toMatch(/Zeile 3: Überschrift/);
    expect(errors.join("\n")).toMatch(/Zeile 5: Release 2026-11-23.1 ohne Stichpunkte/);
    expect(errors.join("\n")).toMatch(/Zeile 8: nur Stichpunkte/);
  });

  it("verlangt eindeutige Kennungen, neueste zuerst — und sortiert trotzdem", () => {
    const { releases, errors } = parseReleaseNotes(
      ["## 2026-11-21.1 — Alt", "- a", "## 2026-11-22.1 — Neu", "- b", "## 2026-11-22.1 — Doppelt", "- c"].join("\n"),
    );
    expect(releases.map((r) => r.title)).toEqual(["Neu", "Alt"]);
    expect(errors).toHaveLength(2);
  });
});

describe("releasesSince (Auswahl für „Was ist neu?“)", () => {
  const rel = (id: string): Release => ({ id, date: id.slice(0, 10), seq: Number(id.slice(11)), title: id, items: ["x"] });
  const all = ["2026-11-24.1", "2026-11-23.2", "2026-11-23.1", "2026-11-22.1", "2026-11-21.1"].map(rel);
  const ids = (r: { show: Release[] }) => r.show.map((x) => x.id);

  it("noch nichts gesehen: nur das neueste", () => {
    expect(ids(releasesSince(all, null))).toEqual(["2026-11-24.1"]);
    expect(ids(releasesSince(all, undefined))).toEqual(["2026-11-24.1"]);
    expect(ids(releasesSince(all, ""))).toEqual(["2026-11-24.1"]);
    expect(releasesSince(all, null).more).toBe(0);
  });

  it("unlesbare Kennung (z.B. von Hand gesetzt): wie nichts gesehen", () => {
    expect(ids(releasesSince(all, "abc1234"))).toEqual(["2026-11-24.1"]);
  });

  it("neuestes schon gesehen: nichts", () => {
    expect(releasesSince(all, "2026-11-24.1")).toEqual({ show: [], more: 0 });
  });

  it("alle seit dem zuletzt gesehenen, neueste zuerst", () => {
    expect(ids(releasesSince(all, "2026-11-23.1"))).toEqual(["2026-11-24.1", "2026-11-23.2"]);
  });

  it("höchstens drei, der Rest als Zahl", () => {
    const r = releasesSince(all, "2026-11-21.1");
    expect(ids(r)).toEqual(["2026-11-24.1", "2026-11-23.2", "2026-11-23.1"]);
    expect(r.more).toBe(1);
    expect(releasesSince(all, "2026-11-21.1", 10).more).toBe(0);
  });

  it("gesehene Kennung, die es nicht mehr gibt: nach Datum eingeordnet", () => {
    expect(ids(releasesSince(all, "2026-11-23.5"))).toEqual(["2026-11-24.1"]);
    // Kennung aus der Zukunft (z.B. nach Zurückrollen): nichts Neues.
    expect(releasesSince(all, "2027-01-01.1").show).toEqual([]);
  });

  it("ohne Releases: nichts", () => {
    expect(releasesSince([], null)).toEqual({ show: [], more: 0 });
  });
});

describe("formatReleaseDate", () => {
  it("schreibt das Datum aus", () => {
    expect(formatReleaseDate("2026-11-22")).toBe("22. November 2026");
  });
});

describe("CHANGELOG.md im Repository", () => {
  const text = readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
  const { releases, errors } = parseReleaseNotes(text);

  it("ist fehlerfrei und hat Einträge", () => {
    expect(errors).toEqual([]);
    expect(releases.length).toBeGreaterThan(0);
  });

  it("ist derselbe Stand wie der eingebaute Text (Build-Zeit-Import)", () => {
    expect(releaseNotes()).toEqual(releases);
    expect(latestReleaseId()).toBe(releases[0].id);
  });

  it("nennt keine Commit-Kennungen und keine Technikbegriffe", () => {
    for (const r of releases) {
      for (const line of [r.title, ...r.items]) {
        expect(line, `${r.id}: ${line}`).not.toMatch(/\b[0-9a-f]{7,40}\b/);
        expect(line, `${r.id}: ${line}`).not.toMatch(/\b(Migration|Prisma|API|Commit|Branch|MCP|SQL|Endpunkt)\b/i);
      }
    }
  });
});
