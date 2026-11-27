import Link from "next/link";

import { requireScope } from "@/lib/session";
import { getFamilyRecords } from "@/lib/services/records";
import {
  MAX_FATHER_AGE,
  MAX_MOTHER_AGE,
  MAX_PARTNER_AGE_GAP,
  MIN_MARRIAGE_AGE,
  MIN_NAME_COUNT,
  MIN_PARENT_AGE,
  type RecordKey,
} from "@/lib/records";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { HelpLink } from "@/components/HelpLink";
import { formatCount, StatsCard } from "@/components/StatisticsCharts";
import { NamesByCentury, RecordPlaces } from "@/components/RecordCards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rekorde" };

// Bewusst ohne loading.tsx: Ein Wechsel nur der Suchparameter (Familie)
// bliebe mit einer Ladeanzeige hängen (wie /statistics).

type Params = { family?: string };

/** Überschrift, Zählregel in einem Satz, Grundlage und Text ohne Treffer je Karte. */
const CARDS: { key: RecordKey; title: string; how: string; basis: string; empty: string }[] = [
  {
    key: "oldestDeceased",
    title: "Höchstes erreichtes Alter",
    how: "Verstorbene mit Geburts- und Sterbedatum, Alter in vollendeten Jahren.",
    basis: "Verstorbenen",
    empty: "Noch keine verstorbene Person mit Geburts- und Sterbedatum.",
  },
  {
    key: "oldestLiving",
    title: "Ältestes lebendes Familienmitglied",
    how: "Personen ohne Sterbeangabe, die laut Geburtsdatum höchstens 100 Jahre alt sind; Alter heute.",
    basis: "Lebenden mit Geburtsdatum",
    empty: "Noch keine lebende Person mit Geburtsdatum.",
  },
  {
    key: "youngest",
    title: "Jüngstes Familienmitglied",
    how: "Die zuletzt geborenen Personen, lebend oder verstorben.",
    basis: "Personen mit Geburtsdatum",
    empty: "Noch keine Person mit Geburtsdatum.",
  },
  {
    key: "earliest",
    title: "Frühester bekannter Vorfahr",
    how: "Das früheste Geburtsjahr; Angaben wie „vor 1700“ sind zu ungenau und zählen nicht.",
    basis: "Personen mit Geburtsjahr",
    empty: "Noch keine Person mit Geburtsjahr.",
  },
  {
    key: "longestPartnership",
    title: "Längste Ehe oder Partnerschaft",
    how: "Vom Beginn bis zur Scheidung, Trennung oder zum Tod des zuerst Verstorbenen; leben beide noch, bis heute.",
    basis: "Paaren mit Beginn und Ende",
    empty: "Noch keine Ehe oder Partnerschaft, deren Dauer sicher feststeht.",
  },
  {
    key: "mostChildren",
    title: "Meiste Kinder",
    how: "Leibliche und adoptierte Kinder je Person; ein Paar mit denselben Kindern steht zusammen.",
    basis: "Personen mit Kindern",
    empty: "Noch keine Eltern-Kind-Beziehungen erfasst.",
  },
  {
    key: "mostDescendants",
    title: "Meiste Nachkommen",
    how: "Kinder, Enkel, Urenkel und alle weiteren zusammen, jede Person einmal.",
    basis: "Personen mit Kindern",
    empty: "Noch keine Eltern-Kind-Beziehungen erfasst.",
  },
  {
    key: "longestLine",
    title: "Längste Abstammungslinie",
    how: "Generationen von einem Vorfahren ohne erfasste Eltern bis zum tiefsten Nachkommen — wenn möglich einem lebenden, sonst dem zuletzt geborenen.",
    basis: "Stammeltern",
    empty: "Noch keine Linie über zwei Generationen erfasst.",
  },
  {
    key: "largestSiblingGroup",
    title: "Größte Geschwisterschar",
    how: "Kinder mit denselben Eltern, leiblich oder adoptiert.",
    basis: "Geschwistergruppen",
    empty: "Noch keine Geschwister erfasst.",
  },
  {
    key: "youngestParent",
    title: "Jüngste Eltern",
    how: `Alter eines leiblichen Elternteils bei der Geburt eines Kindes; unter ${MIN_PARENT_AGE} Jahren gilt als Fehler in den Daten.`,
    basis: "Eltern mit beiden Geburtsdaten",
    empty: "Noch keine Eltern und Kinder mit Geburtsdatum.",
  },
  {
    key: "oldestParent",
    title: "Älteste Eltern",
    how: `Alter eines leiblichen Elternteils bei der Geburt eines Kindes; Mütter über ${MAX_MOTHER_AGE} und Väter über ${MAX_FATHER_AGE} Jahre gelten als Fehler in den Daten.`,
    basis: "Eltern mit beiden Geburtsdaten",
    empty: "Noch keine Eltern und Kinder mit Geburtsdatum.",
  },
  {
    key: "partnerAgeGap",
    title: "Größter Altersunterschied eines Paares",
    how: `Ehen und Partnerschaften, beide mit Geburtsdatum; über ${MAX_PARTNER_AGE_GAP} Jahre gilt als Fehler in den Daten.`,
    basis: "Paaren mit beiden Geburtsdaten",
    empty: "Noch kein Paar mit beiden Geburtsdaten.",
  },
  {
    key: "youngestCouple",
    title: "Jüngstes Brautpaar",
    how: `Ehen mit Heiratsdatum, beide mit Geburtsdatum; gereiht nach dem Alter beider zusammen, unter ${MIN_MARRIAGE_AGE} Jahren gilt als Fehler.`,
    basis: "Ehen mit allen Daten",
    empty: "Noch keine Ehe mit Heirats- und beiden Geburtsdaten.",
  },
  {
    key: "oldestCouple",
    title: "Ältestes Brautpaar",
    how: "Ehen mit Heiratsdatum, beide mit Geburtsdatum; gereiht nach dem Alter beider zusammen.",
    basis: "Ehen mit allen Daten",
    empty: "Noch keine Ehe mit Heirats- und beiden Geburtsdaten.",
  },
];

/**
 * Rekorde des Stammbaums — Bestwerte mit Namen, nur über Personen, die der
 * Benutzer sehen darf, wahlweise für eine einzelne Familie. Rechnung und
 * Regeln: lib/records.ts, Laden und Rechte: lib/services/records.ts.
 */
export default async function RecordsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { scope } = await requireScope();
  const params = await searchParams;
  const data = await getFamilyRecords(scope, { familyId: params.family });
  const statisticsHref = data.familyId ? `/statistics?family=${encodeURIComponent(data.familyId)}` : "/statistics";

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Forschung</p>
        <h1 className="page-title">Rekorde</h1>
        <p className="mt-1 max-w-2xl text-sm muted">
          Die Bestwerte deines Stammbaums — wer am ältesten wurde, wer die meisten Nachkommen hat und mehr. Gezählt werden
          nur Personen, die für dich freigegeben sind.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <HelpLink to="rekorde" />
          <Link href={statisticsHref} className="btn-link inline-flex min-h-11 items-center text-sm" data-testid="records-to-statistics">
            Zahlen und Diagramme: Statistik <span aria-hidden className="ml-1">→</span>
          </Link>
        </div>
      </div>

      {data.families.length > 1 && (
        <form
          aria-label="Rekorde filtern"
          className="card flex flex-wrap items-end gap-3 p-3 max-sm:[&>div]:grow max-sm:[&_.field]:w-full"
          data-testid="records-filter"
        >
          <div>
            <label htmlFor="records-family" className="field-label">
              Familie
            </label>
            <AutoSubmitSelect id="records-family" name="family" defaultValue={data.familyId ?? ""} className="field">
              <option value="">Alle Familien</option>
              {data.families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </div>
          <button className="btn-secondary">Anzeigen</button>
        </form>
      )}

      {data.persons === 0 ? (
        <div className="card px-6 py-10 text-center" data-testid="records-nothing">
          <p className="font-serif text-lg">Noch keine Rekorde.</p>
          <p className="mt-1 text-sm muted">
            {data.familyId
              ? "In dieser Familie sind noch keine Personen erfasst."
              : "Sobald dir eine Familie freigegeben ist und Personen erfasst sind, erscheinen hier die Rekorde."}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {CARDS.map((c) => {
            const card = data.cards[c.key];
            return (
              <StatsCard
                key={c.key}
                id={`records-${c.key}`}
                title={c.title}
                testId={`records-${c.key}`}
                basis={`${c.how} Grundlage: ${formatCount(card.basis)} ${c.basis}.`}
              >
                <RecordPlaces places={card.places} empty={c.empty} />
              </StatsCard>
            );
          })}
          <StatsCard
            id="records-names"
            title="Häufigster Vorname je Jahrhundert"
            testId="records-names"
            basis={`Erster Vorname nach Geburtsjahrhundert; genannt erst ab ${MIN_NAME_COUNT} Trägern. Grundlage: ${formatCount(data.givenNames.basis)} Personen mit Geburtsjahr und Vornamen.`}
          >
            {data.givenNames.rows.length ? (
              <NamesByCentury rows={data.givenNames.rows} />
            ) : (
              <p className="text-sm muted">Noch zu wenige Vornamen mit Geburtsjahr.</p>
            )}
          </StatsCard>
        </div>
      )}
    </div>
  );
}
