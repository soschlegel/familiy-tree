import { describe, expect, it } from "vitest";

import {
  canEditPerson,
  canEditRelationshipBetween,
  canViewPerson,
  editableFamilyIds,
  maskPerson,
  personVisibilityFilter,
  viewableFamilyIds,
  visibleFamilyIds,
  type Scope,
} from "@/lib/scope";

const scope = (
  families: Record<string, "EDITOR" | "VIEWER">,
  isAdmin = false,
): Scope => ({
  userId: "u1",
  isAdmin,
  families: new Map(Object.entries(families)),
});

const admin = scope({}, true);
const editorA_viewerB = scope({ A: "EDITOR", B: "VIEWER" });
const viewerA = scope({ A: "VIEWER" });
const nobody = scope({});

describe("canViewPerson", () => {
  it("Admin sieht alles, auch Personen ohne Familie", () => {
    expect(canViewPerson(admin, [])).toBe(true);
    expect(canViewPerson(admin, ["X"])).toBe(true);
  });

  it("sichtbar, sobald eine Familie geteilt wird", () => {
    expect(canViewPerson(viewerA, ["A"])).toBe(true);
    expect(canViewPerson(viewerA, ["B", "A"])).toBe(true);
    expect(canViewPerson(viewerA, ["B"])).toBe(false);
  });

  it("Personen ohne Familie sind nur für Admins sichtbar", () => {
    expect(canViewPerson(viewerA, [])).toBe(false);
    expect(canViewPerson(editorA_viewerB, [])).toBe(false);
  });

  it("ohne Familienzuordnung sieht ein Benutzer nichts", () => {
    expect(canViewPerson(nobody, ["A"])).toBe(false);
  });
});

describe("canEditPerson", () => {
  it("braucht EDITOR in mindestens einer gemeinsamen Familie", () => {
    expect(canEditPerson(editorA_viewerB, ["A"])).toBe(true);
    expect(canEditPerson(editorA_viewerB, ["B", "A"])).toBe(true);
    expect(canEditPerson(editorA_viewerB, ["B"])).toBe(false);
    expect(canEditPerson(viewerA, ["A"])).toBe(false);
  });

  it("Admin darf alles", () => {
    expect(canEditPerson(admin, [])).toBe(true);
  });
});

describe("canEditRelationshipBetween", () => {
  it("eine Seite bearbeitbar, die andere sichtbar genügt (Heirat zwischen Familien)", () => {
    expect(canEditRelationshipBetween(editorA_viewerB, ["A"], ["B"])).toBe(true);
  });

  it("verweigert, wenn die Gegenseite unsichtbar ist", () => {
    expect(canEditRelationshipBetween(editorA_viewerB, ["A"], ["C"])).toBe(false);
    expect(canEditRelationshipBetween(editorA_viewerB, ["A"], [])).toBe(false);
  });

  it("verweigert, wenn keine Seite bearbeitbar ist", () => {
    expect(canEditRelationshipBetween(editorA_viewerB, ["B"], ["B"])).toBe(false);
    expect(canEditRelationshipBetween(viewerA, ["A"], ["A"])).toBe(false);
  });

  it("Admin darf alles", () => {
    expect(canEditRelationshipBetween(admin, [], ["X"])).toBe(true);
  });
});

describe("Familienlisten und Filter", () => {
  it("viewable/editableFamilyIds", () => {
    expect(viewableFamilyIds(editorA_viewerB).sort()).toEqual(["A", "B"]);
    expect(editableFamilyIds(editorA_viewerB)).toEqual(["A"]);
    expect(editableFamilyIds(viewerA)).toEqual([]);
  });

  it("visibleFamilyIds blendet fremde Familien aus", () => {
    expect(visibleFamilyIds(viewerA, ["A", "C"])).toEqual(["A"]);
    expect(visibleFamilyIds(admin, ["A", "C"])).toEqual(["A", "C"]);
  });

  it("personVisibilityFilter", () => {
    expect(personVisibilityFilter(admin)).toEqual({});
    expect(personVisibilityFilter(nobody)).toEqual({
      families: { some: { familyId: { in: [] } } },
    });
    expect(personVisibilityFilter(viewerA)).toEqual({
      families: { some: { familyId: { in: ["A"] } } },
    });
  });
});

describe("maskPerson", () => {
  it("behält nur die ID", () => {
    const m = maskPerson("p1");
    expect(m).toEqual({
      id: "p1",
      givenName: "Nicht freigegeben",
      familyName: null,
      gender: "UNKNOWN",
      birthDate: null,
      deathDate: null,
      primaryMediaId: null,
      restricted: true,
    });
  });
});
