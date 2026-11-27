import Link from "next/link";
import { cookies } from "next/headers";

import type { Scope } from "@/lib/scope";
import { loadReferenceFor } from "@/lib/services";
import { REFERENCE_COOKIE } from "@/lib/reference";
import { ReferenceChip } from "./ReferenceChip";
import { SelfPersonButton } from "./SelfPersonButton";
import { HelpLink } from "./HelpLink";
import { kinshipHref } from "./kinship-url";

/**
 * Bezugsperson auf der Personenseite (docs/fachlich/bezugsperson.md): was diese
 * Person für die Bezugsperson ist, „Das bin ich“ und „Baum aus ihrer Sicht“.
 * Eigene Komponente, damit die Personenseite nur eine Zeile dazubekommt.
 *
 * Die Verwandtschaft wird wie im Baum nur über sichtbare Personen berechnet;
 * die Person selbst ist sichtbar, sonst gäbe es die Seite nicht.
 */
export async function ReferencePanel({
  scope,
  personId,
  personName,
  bezug,
}: {
  scope: Scope;
  personId: string;
  personName: string;
  /** Roher Wert von `?bezug=`. */
  bezug?: string;
}) {
  const jar = await cookies();
  const { choice, view, selfName } = await loadReferenceFor(
    scope,
    { param: bezug ?? null, cookie: jar.get(REFERENCE_COOKIE)?.value ?? null },
    personId,
  );
  const isRef = view?.id === personId;
  const term = view && !isRef ? (view.relatives[personId]?.term ?? null) : null;

  return (
    <section
      aria-label="Bezugsperson"
      data-testid="person-reference"
      className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm"
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        {view && isRef && (
          <p data-testid="person-reference-self">
            <strong className="font-semibold">{personName}</strong> ist die Bezugsperson
            {view.isSelf ? " — das bist du." : "."}
          </p>
        )}
        {view && !isRef && (
          <p data-testid="person-reference-term">
            Für{" "}
            <Link href={`/people/${view.id}`} className="font-medium underline underline-offset-2">
              {view.isSelf ? `dich (${view.name})` : view.name}
            </Link>{" "}
            ist {personName}:{" "}
            {term ? (
              <strong className="font-semibold" data-testid="person-reference-kinship">{term}</strong>
            ) : (
              <span className="muted">keine Verwandtschaft über freigegebene Personen bekannt</span>
            )}
          </p>
        )}
        {!view && (
          <p className="muted">
            Wähle mit „Das bin ich“ deine eigene Person — dann zeigen Baum und Personenseiten den
            Verwandtschaftsgrad zu dir.
          </p>
        )}
        <ReferenceChip
          id={view && view.source !== "self" ? view.id : null}
          name={view?.name ?? null}
          source={view?.source ?? null}
          hasSelf={view?.hasSelf ?? false}
          param={bezug ?? null}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <SelfPersonButton
          personId={personId}
          personName={personName}
          isSelf={choice.selfId === personId}
          currentSelfName={choice.selfId && choice.selfId !== personId ? selfName : null}
        />
        {!isRef && (
          <Link
            href={`/tree?focus=${encodeURIComponent(personId)}&bezug=${encodeURIComponent(personId)}`}
            data-testid="person-reference-view"
            className="btn-secondary"
          >
            Baum aus dieser Sicht
          </Link>
        )}
        <Link
          href={kinshipHref(personId, view && !isRef ? view.id : null)}
          data-testid="person-kinship-link"
          className="btn-secondary"
        >
          Wie sind wir verwandt?
        </Link>
        <HelpLink to="bezugsperson" compact label="Wie funktionieren Bezugsperson und Verwandtschaftsgrad?" className="self-center" />
      </div>
    </section>
  );
}
