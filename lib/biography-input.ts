/**
 * Eingabe des Lebenslaufs (lib/biography.ts) aus den Daten der Personenseite
 * (getPersonDetail) und den Eltern-Kind-Kanten rund um Eltern und Kinder.
 * Rein und ohne Datenbank — das Laden macht lib/services/biography.ts.
 *
 * Datenschutz: getPersonDetail liefert nicht sichtbare Verwandte als
 * Platzhalter ohne Angaben. Sie werden hier verworfen — weder genannt noch
 * gezählt. Die Kanten enthalten nur Kennungen; sie dienen dem Zuordnen von
 * Kindern zu einer Partnerschaft und der Stellung unter den Geschwistern,
 * die nur entsteht, wenn alle dafür nötigen Personen sichtbar sind.
 */
import { certainlyBefore, fuzzyField } from "./dates";
import type { BioEvent, BioRef, BiographyInput } from "./biography";
import type { CalendarDay } from "./today";
import type { PersonRef } from "./services/dto";
import type { EventDto } from "./services/events";
import type { PersonDetail } from "./services/persons";

export type ParentEdge = { from: string; to: string; subtype: string };

const BIO = "BIOLOGICAL";

const refOf = (p: PersonRef): BioRef | null =>
  p.restricted
    ? null
    : {
        id: p.id,
        givenName: p.givenName,
        familyName: p.familyName,
        birthName: p.birthName,
        gender: p.gender,
        birth: fuzzyField(p, "birthDate"),
        death: fuzzyField(p, "deathDate"),
      };

const eventOf = (e: EventDto): BioEvent => ({
  type: e.type,
  label: e.label,
  date: fuzzyField(e, "date"),
  phrase: e.datePhrase,
  place: e.place,
  value: e.value,
});

/**
 * Stellung unter den leiblichen Kindern beider Eltern. Nur, wenn genau zwei
 * leibliche Eltern erfasst und beide sichtbar sind und jedes gemeinsame
 * leibliche Kind sichtbar ist; die Position nur, wenn jedes Geschwister sicher
 * vor oder nach der Person geboren ist (ungenaue Daten großzügig gelesen).
 */
export function siblingRankOf(
  detail: Pick<PersonDetail, "person" | "parents" | "siblings">,
  edges: ParentEdge[],
): BiographyInput["siblingRank"] {
  const bioParents = detail.parents.filter((r) => r.subtype === BIO);
  if (bioParents.length !== 2 || bioParents.some((r) => r.other.restricted)) return null;
  const [a, b] = bioParents.map((r) => r.other.id);
  const childrenOf = (parent: string) =>
    new Set(edges.filter((e) => e.from === parent && e.subtype === BIO).map((e) => e.to));
  const ofA = childrenOf(a);
  const ofB = childrenOf(b);
  const shared = [...ofA].filter((id) => ofB.has(id) && id !== detail.person.id);
  if (shared.length === 0) return null;
  const sibById = new Map(detail.siblings.map((s) => [s.person.id, s.person]));
  const sibs = shared.map((id) => sibById.get(id));
  if (sibs.some((s) => !s || s.restricted)) return null;
  const total = shared.length + 1;
  const own = fuzzyField(detail.person, "birthDate");
  const births = sibs.map((s) => fuzzyField(s!, "birthDate"));
  if (!own || births.some((d) => !d)) return { position: null, total };
  let earlier = 0;
  for (const d of births) {
    if (certainlyBefore(d!, own)) earlier++;
    else if (!certainlyBefore(own, d!)) return { position: null, total };
  }
  return { position: earlier + 1, total };
}

/** Eingabe des Lebenslaufs aus den Daten der Personenseite. */
export function biographyInputOf(detail: PersonDetail, edges: ParentEdge[], today: CalendarDay): BiographyInput {
  const p = detail.person;
  const assigned = new Set<string>();
  const partnerships: BiographyInput["partnerships"] = [];
  for (const r of detail.partners) {
    const partner = refOf(r.other);
    if (!partner) continue; // nicht sichtbar: weder genannt noch gezählt, samt Ereignissen
    const children = detail.children
      .filter(
        (c) =>
          !c.other.restricted &&
          c.subtype === BIO &&
          !assigned.has(c.other.id) &&
          edges.some((e) => e.from === partner.id && e.to === c.other.id && e.subtype === BIO),
      )
      .map((c) => refOf(c.other)!);
    for (const c of children) assigned.add(c.id);
    partnerships.push({
      partner,
      subtype: r.subtype,
      start: fuzzyField(r, "startDate"),
      startPhrase: r.startDatePhrase,
      startPlace: r.startPlace,
      end: fuzzyField(r, "endDate"),
      endPhrase: r.endDatePhrase,
      endPlace: r.endPlace,
      events: r.events.filter((e) => !e.isAlternative).map(eventOf),
      children,
    });
  }
  return {
    person: {
      givenName: p.givenName,
      familyName: p.familyName,
      birthName: p.birthName,
      nickname: p.nickname,
      namePrefix: p.namePrefix,
      nameSuffix: p.nameSuffix,
      gender: p.gender,
      birth: fuzzyField(p, "birthDate"),
      birthPhrase: p.birthDatePhrase,
      birthPlace: p.birthPlace,
      death: fuzzyField(p, "deathDate"),
      deathPhrase: p.deathDatePhrase,
      deathPlace: p.deathPlace,
      deathCause: p.deathCause,
    },
    otherNames: detail.names.map((n) => ({ type: n.type, text: n.display })),
    parents: detail.parents.flatMap((r) => {
      const ref = refOf(r.other);
      return ref ? [{ person: ref, subtype: r.subtype }] : [];
    }),
    siblingRank: siblingRankOf(detail, edges),
    partnerships,
    otherChildren: detail.children.flatMap((r) => {
      const ref = refOf(r.other);
      return ref && !assigned.has(ref.id) ? [{ person: ref, subtype: r.subtype }] : [];
    }),
    events: detail.events.filter((e) => !e.isAlternative).map(eventOf),
    today,
  };
}
