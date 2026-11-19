/**
 * Build-Angabe der Fußzeile (lib/build-info): Werte aus dem Build, Rückfall
 * „Build lokal“, ohne Anmeldung kein Commit.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildInfo, buildLabel } from "@/lib/build-info";

const saved = { date: process.env.NEXT_PUBLIC_BUILD_DATE, sha: process.env.NEXT_PUBLIC_BUILD_SHA };
afterEach(() => {
  process.env.NEXT_PUBLIC_BUILD_DATE = saved.date;
  process.env.NEXT_PUBLIC_BUILD_SHA = saved.sha;
  if (saved.date === undefined) delete process.env.NEXT_PUBLIC_BUILD_DATE;
  if (saved.sha === undefined) delete process.env.NEXT_PUBLIC_BUILD_SHA;
});

describe("Build-Angabe", () => {
  it("mit Datum und Commit: angemeldet beides, sonst nur das Datum", () => {
    process.env.NEXT_PUBLIC_BUILD_DATE = "2026.11.19";
    process.env.NEXT_PUBLIC_BUILD_SHA = "68C8471ABCDEF0123456789";
    const info = buildInfo();
    expect(info).toEqual({ date: "2026.11.19", sha: "68c8471" });
    expect(buildLabel(info, true)).toBe("Build 2026.11.19 · 68c8471");
    expect(buildLabel(info, false)).toBe("Build 2026.11.19");
  });

  it("ohne oder mit ungültigen Werten: „Build lokal“", () => {
    delete process.env.NEXT_PUBLIC_BUILD_DATE;
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    expect(buildLabel(buildInfo(), true)).toBe("Build lokal");
    process.env.NEXT_PUBLIC_BUILD_DATE = "19.11.2026";
    process.env.NEXT_PUBLIC_BUILD_SHA = "<script>";
    expect(buildInfo()).toEqual({ date: null, sha: null });
    expect(buildLabel(buildInfo(), false)).toBe("Build lokal");
  });

  it("nur Datum ohne Commit", () => {
    process.env.NEXT_PUBLIC_BUILD_DATE = "2026.11.19";
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    expect(buildLabel(buildInfo(), true)).toBe("Build 2026.11.19");
  });
});
