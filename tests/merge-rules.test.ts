/**
 * Regeln des Zusammenführens (lib/merge-rules.ts) — ohne Datenbank.
 * Nur erfundene Namen.
 */
import { describe, expect, it } from "vitest";

import { fuzzyColumns, toFuzzyDate } from "@/lib/dates";
import {
  compareFields,
  datesCompatible,
  moreSpecificSubtype,
  refinesDate,
  resolvePersonMerge,
  resolveRelationshipMerge,
  type PersonValues,
  type RelationshipValues,
} from "@/lib/merge-rules";

const d = (iso: string, precision: "DAY" | "MONTH" | "YEAR" = "DAY", qualifier = "EXACT") => toFuzzyDate(iso, precision, qualifier)!;

function person(p: Partial<PersonValues> & { birth?: ReturnType<typeof d> | null; death?: ReturnType<typeof d> | null }): PersonValues {
  const { birth, death, ...rest } = p;
  return {
    givenName: "Anna",
    familyName: null,
    birthName: null,
    nickname: null,
    namePrefix: null,
    nameSuffix: null,
    gender: "FEMALE",
    ...fuzzyColumns("birthDate", birth ?? null),
    birthDatePhrase: null,
    birthPlace: null,
    ...fuzzyColumns("deathDate", death ?? null),
    deathDatePhrase: null,
    deathPlace: null,
    deathCause: null,
    notes: null,
    ...rest,
  } as PersonValues;
}

describe("Datumsverfeinerung", () => {
  it("„12.03.1760“ verfeinert „um 1760“ und „1760“, nicht umgekehrt", () => {
    expect(refinesDate(d("1760-03-12"), d("1760-01-01", "YEAR", "ABOUT"))).toBe(true);
    expect(refinesDate(d("1760-03-12"), d("1760-01-01", "YEAR"))).toBe(true);
    expect(refinesDate(d("1760-01-01", "YEAR"), d("1760-03-12"))).toBe(false);
    expect(refinesDate(d("1765-03-12"), d("1760-01-01", "YEAR"))).toBe(false);
    expect(datesCompatible(d("1760-03-12"), d("1761-01-01", "YEAR", "ABOUT"))).toBe(true);
    expect(datesCompatible(d("1760-03-12"), d("1760-03-13"))).toBe(false);
  });
});

describe("Hauptangaben", () => {
  it("Ehename und Geburtsname: eine Person mit Ehename, gesetztem Geburtsnamen, ohne überflüssige Variante", () => {
    // Bleibend unter dem Geburtsnamen, die andere als „Müller geb. Schmidt“
    const keep = person({ familyName: "Schmidt", birth: d("1801-04-02"), birthPlace: "Probstadt" });
    const other = person({ familyName: "Müller", birthName: "Schmidt", birth: d("1801-04-02") });
    const cmp = compareFields(keep, other);
    expect(cmp.find((c) => c.field === "familyName")!.choice).toBe("other");
    expect(cmp.find((c) => c.field === "birthName")!.choice).toBe("other");
    const r = resolvePersonMerge(keep, other, {});
    expect(r.columns.familyName).toBe("Müller");
    expect(r.columns.birthName).toBe("Schmidt");
    expect(r.names).toEqual([]);
    expect(r.alternates).toEqual([]);

    // umgekehrt: bleibend „Müller geb. Schmidt“, die andere unter Geburtsname
    const r2 = resolvePersonMerge(other, keep, {});
    expect(r2.columns.familyName).toBe("Müller");
    expect(r2.columns.birthName).toBe("Schmidt");
    expect(r2.names).toEqual([]);
    expect(r2.columns.birthPlace).toBe("Probstadt");
  });

  it("ungenaues und genaues Datum: das genauere, keine Zweitangabe", () => {
    const keep = person({ familyName: "Probe", birth: d("1760-01-01", "YEAR", "ABOUT") });
    const other = person({ familyName: "Probe", birth: d("1760-03-12") });
    const r = resolvePersonMerge(keep, other, {});
    expect((r.columns.birthDate as Date).toISOString()).toBe("1760-03-12T00:00:00.000Z");
    expect(r.columns.birthDatePrecision).toBe("DAY");
    expect(r.alternates).toEqual([]);
  });

  it("widersprüchliches Datum: bleibende Angabe, die andere wird BIRTH-Zweitangabe (samt Ort)", () => {
    const keep = person({ familyName: "Probe", birth: d("1760-03-12"), birthPlace: "Probstadt" });
    const other = person({ familyName: "Probe", birth: d("1762-05-01"), birthPlace: "Musterdorf" });
    const r = resolvePersonMerge(keep, other, {});
    expect((r.columns.birthDate as Date).getUTCFullYear()).toBe(1760);
    expect(r.alternates).toHaveLength(1);
    expect(r.alternates[0]).toMatchObject({ type: "BIRTH", from: "other", place: "Musterdorf" });
    // Wahl der anderen Seite: dann wird die bleibende Angabe die Zweitangabe
    const r2 = resolvePersonMerge(keep, other, { birthDate: "other", birthPlace: "other" });
    expect(r2.alternates).toHaveLength(1);
    expect(r2.alternates[0]).toMatchObject({ type: "BIRTH", from: "keep", place: "Probstadt" });
  });

  it("abweichender Name wird Variante, Schreibvariante als VARIANT; Notizen beide; Geschlecht verworfen benannt", () => {
    const keep = person({ givenName: "Johann", familyName: "Meier", gender: "MALE", notes: "A" });
    const other = person({ givenName: "Johan", familyName: "Mayer", gender: "UNKNOWN", notes: "B" });
    const r = resolvePersonMerge(keep, other, {});
    expect(r.columns.givenName).toBe("Johann");
    expect(r.columns.gender).toBe("MALE");
    expect(r.columns.notes).toBe("A\n\n———\n\nB");
    expect(r.names).toEqual([expect.objectContaining({ type: "VARIANT", givenName: "Johan", familyName: "Mayer", from: "other" })]);
    expect(r.dropped).toEqual([]);

    const r2 = resolvePersonMerge(person({ gender: "MALE" }), person({ gender: "FEMALE" }), { gender: "other" });
    expect(r2.columns.gender).toBe("FEMALE");
    expect(r2.dropped[0]).toContain("männlich");
  });

  it("Name, der schon als Variante erfasst ist, wird nicht doppelt angelegt", () => {
    const keep = person({ familyName: "Krüger" });
    const other = person({ familyName: "Wendt" });
    const r = resolvePersonMerge(keep, other, {}, [{ type: "MARRIED", givenName: "Anna", familyName: "Wendt" }]);
    expect(r.names).toEqual([]);
  });

  it("leere Seite: Wert der anderen, ohne Zweitangabe", () => {
    const keep = person({ familyName: "Probe" });
    const other = person({ familyName: "Probe", death: d("1830-01-01", "YEAR"), deathPlace: "Musterdorf", deathCause: "Fieber" });
    const r = resolvePersonMerge(keep, other, {});
    expect(r.columns.deathPlace).toBe("Musterdorf");
    expect(r.columns.deathCause).toBe("Fieber");
    expect(r.alternates).toEqual([]);
  });
});

describe("Beziehungen", () => {
  const rel = (p: Partial<RelationshipValues>): RelationshipValues =>
    ({
      type: "PARTNER_OF",
      subtype: "PARTNER_UNKNOWN",
      ...fuzzyColumns("startDate", null),
      startDatePhrase: null,
      startPlace: null,
      ...fuzzyColumns("endDate", null),
      endDatePhrase: null,
      endPlace: null,
      notes: null,
      ...p,
    }) as RelationshipValues;

  it("Art: verheiratet schlägt unbekannt, geschieden schlägt verheiratet; Adoption schlägt leiblich", () => {
    expect(moreSpecificSubtype("PARTNER_OF", "PARTNER_UNKNOWN", "MARRIED")).toBe("MARRIED");
    expect(moreSpecificSubtype("PARTNER_OF", "DIVORCED", "MARRIED")).toBe("DIVORCED");
    expect(moreSpecificSubtype("PARTNER_OF", "UNMARRIED", "PARTNER_UNKNOWN")).toBe("UNMARRIED");
    expect(moreSpecificSubtype("PARENT_OF", "BIOLOGICAL", "ADOPTIVE")).toBe("ADOPTIVE");
  });

  it("Heirat: fehlendes ergänzt, abweichendes als MARRIAGE-Zweitangabe", () => {
    const keep = rel({ subtype: "PARTNER_UNKNOWN", ...fuzzyColumns("startDate", d("1825-06-01")) });
    const other = rel({ subtype: "MARRIED", ...fuzzyColumns("startDate", d("1826-06-01")), startPlace: "Probstadt" });
    const r = resolveRelationshipMerge(keep, other);
    expect(r.patch.subtype).toBe("MARRIED");
    expect(r.patch.startPlace).toBe("Probstadt");
    expect(r.alternates).toEqual([expect.objectContaining({ type: "MARRIAGE", from: "other" })]);
  });

  it("Eltern-Kind: abweichender Beginn landet in den Notizen", () => {
    const keep = rel({ type: "PARENT_OF", subtype: "ADOPTIVE", ...fuzzyColumns("startDate", d("1900-01-01", "YEAR")) });
    const other = rel({ type: "PARENT_OF", subtype: "BIOLOGICAL", ...fuzzyColumns("startDate", d("1905-01-01", "YEAR")) });
    const r = resolveRelationshipMerge(keep, other);
    expect(r.patch.subtype).toBeUndefined();
    expect(String(r.patch.notes)).toContain("1905");
  });
});
