import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePage } from "@/lib/session";
import { getHelpTopic, listHelpTopics } from "@/lib/help/content";
import { renderHelpBlocks } from "@/components/help-render";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: { params: Promise<{ thema: string }> }) {
  const { thema } = await params;
  const found = SLUG.test(thema) ? getHelpTopic(thema) : null;
  return { title: found ? `${found.topic.title} · Hilfe` : "Hilfe" };
}

/** Ein Thema der Anwender-Hilfe (docs/anwender/NN-thema.md). */
export default async function HelpTopicPage({ params }: { params: Promise<{ thema: string }> }) {
  await requirePage();
  const { thema } = await params;
  const found = SLUG.test(thema) ? getHelpTopic(thema) : null;
  if (!found) notFound();
  const { topic, doc } = found;
  const topics = listHelpTopics();
  const index = topics.findIndex((t) => t.slug === topic.slug);
  const prev = index > 0 ? topics[index - 1] : null;
  const next = index >= 0 && index < topics.length - 1 ? topics[index + 1] : null;

  return (
    <article className="space-y-5" aria-labelledby="help-title">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/hilfe" className="btn-link text-sm">
          ← Alle Hilfethemen
        </Link>
      </nav>
      <div>
        <p className="eyebrow">Hilfe</p>
        <h1 id="help-title" className="page-title">
          {doc.title}
        </h1>
      </div>
      {renderHelpBlocks(doc.blocks)}
      {(prev || next) && (
        <nav aria-label="Weitere Hilfethemen" className="flex max-w-3xl flex-wrap justify-between gap-3 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
          {prev ? (
            <Link href={`/hilfe/${prev.slug}`} className="btn-secondary max-w-full whitespace-normal" rel="prev">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/hilfe/${next.slug}`} className="btn-secondary max-w-full whitespace-normal" rel="next">
              {next.title} →
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}
