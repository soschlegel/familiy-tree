import { NextResponse } from "next/server";
import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { processAndStoreImage } from "@/lib/media-processing";
import { PERSON_FACTS, relationshipFacts, subtypeMatchesType } from "@/lib/validation";
import {
  exchangeSchema,
  type ExchangeCitation,
  type ExchangeFile,
  type ExchangeRelationship,
} from "@/lib/exchange";

export const runtime = "nodejs";

type Plan = {
  persons: { create: number; update: number };
  relationships: { create: number; update: number };
  media: { create: number; skip: number; withoutFile: number };
  sources: { create: number; update: number };
  citations: { create: number; update: number };
  warnings: string[];
};

/** Liest JSON bzw. ZIP und liefert Inhalt plus die enthaltenen Bilddateien. */
async function readUpload(file: File): Promise<{
  data: ExchangeFile;
  files: Map<string, Buffer>;
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const files = new Map<string, Buffer>();

  // ZIP beginnt mit "PK" — verlässlicher als der Dateiname.
  const isZip = buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  let json: string;

  if (isZip) {
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file("stammbaum.json");
    if (!entry) {
      throw new Error("Im Archiv fehlt stammbaum.json.");
    }
    json = await entry.async("string");

    const folder = zip.folder("media");
    if (folder) {
      const jobs: Promise<void>[] = [];
      folder.forEach((relativePath, entry) => {
        if (entry.dir) return;
        jobs.push(
          entry.async("nodebuffer").then((content) => {
            files.set(relativePath, content);
          }),
        );
      });
      await Promise.all(jobs);
    }
  } else {
    json = buffer.toString("utf8");
  }

  const parsed = exchangeSchema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error(
      `Datei entspricht nicht dem Austauschformat: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }

  return { data: parsed.data, files };
}

/**
 * Beziehungen, die das Datenmodell nicht zulässt, werden nicht importiert —
 * sonst gelangten über den Import Daten hinein, die die API ablehnen würde.
 */
function invalidRelationship(r: ExchangeRelationship): string | null {
  if (r.fromPersonId === r.toPersonId) return "Beziehung einer Person zu sich selbst.";
  if (!subtypeMatchesType(r.type, r.subtype)) {
    return `Art ${r.subtype} passt nicht zu ${r.type}.`;
  }
  return null;
}

/**
 * Ein Beleg braucht genau einen Bezug, und die Angabe muss dazu passen
 * (Geburt an einer Person, Heirat an einer Partnerschaft …) — wie in der API.
 */
function invalidCitation(
  c: ExchangeCitation,
  relationshipType: (id: string) => "PARENT_OF" | "PARTNER_OF" | undefined,
): string | null {
  if (Boolean(c.personId) === Boolean(c.relationshipId)) {
    return "braucht genau eine Person oder eine Beziehung.";
  }
  if (c.personId && !PERSON_FACTS.includes(c.fact)) return `Angabe ${c.fact} passt nicht zu einer Person.`;
  if (c.relationshipId) {
    const type = relationshipType(c.relationshipId);
    if (type && !relationshipFacts(type).includes(c.fact)) {
      return `Angabe ${c.fact} passt nicht zur Beziehung.`;
    }
  }
  return null;
}

/**
 * Ermittelt, was der Import täte — ohne etwas zu ändern. Dieselbe Funktion
 * liefert die Vorschau und die Grundlage für den eigentlichen Lauf, damit
 * Vorschau und Ausführung nicht auseinanderlaufen können.
 */
async function makePlan(
  data: ExchangeFile,
  files: Map<string, Buffer>,
): Promise<Plan> {
  const [existingPersons, existingRelationships, existingMedia, existingSources, existingCitations] =
    await Promise.all([
      prisma.person.findMany({ select: { id: true } }),
      prisma.relationship.findMany({ select: { id: true, type: true } }),
      prisma.mediaAsset.findMany({ select: { id: true } }),
      prisma.source.findMany({ select: { id: true } }),
      prisma.citation.findMany({ select: { id: true } }),
    ]);

  const personIds = new Set(existingPersons.map((p) => p.id));
  const relationshipIds = new Set(existingRelationships.map((r) => r.id));
  const mediaIds = new Set(existingMedia.map((m) => m.id));

  const warnings: string[] = [];
  const plan: Plan = {
    persons: { create: 0, update: 0 },
    relationships: { create: 0, update: 0 },
    media: { create: 0, skip: 0, withoutFile: 0 },
    sources: { create: 0, update: 0 },
    citations: { create: 0, update: 0 },
    warnings,
  };

  for (const p of data.persons) {
    if (personIds.has(p.id)) plan.persons.update++;
    else plan.persons.create++;
  }

  // Personen aus der Datei zählen mit: eine Beziehung darf sich auf eine
  // Person beziehen, die im selben Import erst angelegt wird.
  const knownPersons = new Set([...personIds, ...data.persons.map((p) => p.id)]);

  for (const r of data.relationships) {
    if (!knownPersons.has(r.fromPersonId) || !knownPersons.has(r.toPersonId)) {
      warnings.push(
        `Beziehung ${r.id} verweist auf unbekannte Personen und wird übersprungen.`,
      );
      continue;
    }
    const invalid = invalidRelationship(r);
    if (invalid) {
      warnings.push(`Beziehung ${r.id} wird übersprungen: ${invalid}`);
      continue;
    }
    if (relationshipIds.has(r.id)) plan.relationships.update++;
    else plan.relationships.create++;
  }

  for (const m of data.media) {
    if (mediaIds.has(m.id)) {
      plan.media.skip++;
      continue;
    }
    if (!files.has(m.fileName)) {
      plan.media.withoutFile++;
      continue;
    }
    plan.media.create++;
  }

  const sourceIds = new Set(existingSources.map((x) => x.id));
  const citationIds = new Set(existingCitations.map((x) => x.id));
  for (const src of data.sources) {
    if (sourceIds.has(src.id)) plan.sources.update++;
    else plan.sources.create++;
  }
  const knownSources = new Set([...sourceIds, ...data.sources.map((x) => x.id)]);
  const relType = new Map<string, "PARENT_OF" | "PARTNER_OF">([
    ...existingRelationships.map((r) => [r.id, r.type] as const),
    ...data.relationships.map((r) => [r.id, r.type] as const),
  ]);
  for (const c of data.citations) {
    const invalid = invalidCitation(c, (id) => relType.get(id));
    if (invalid) {
      warnings.push(`Beleg ${c.id} wird übersprungen: ${invalid}`);
      continue;
    }
    if (
      !knownSources.has(c.sourceId) ||
      (c.personId && !knownPersons.has(c.personId)) ||
      (c.relationshipId && !relType.has(c.relationshipId))
    ) {
      warnings.push(`Beleg ${c.id} verweist auf eine unbekannte Quelle, Person oder Beziehung und wird übersprungen.`);
      continue;
    }
    if (citationIds.has(c.id)) plan.citations.update++;
    else plan.citations.create++;
  }

  if (plan.media.withoutFile > 0) {
    warnings.push(
      `${plan.media.withoutFile} Bild(er) sind nur als Verweis enthalten — ohne Bilddatei im Archiv können sie nicht angelegt werden.`,
    );
  }

  return plan;
}

export const POST = route("data:import", async (ctx, req) => {
  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "true";

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
  }

  let data: ExchangeFile;
  let files: Map<string, Buffer>;
  try {
    ({ data, files } = await readUpload(file));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Datei nicht lesbar" },
      { status: 400 },
    );
  }

  const plan = await makePlan(data, files);

  if (!apply) {
    return NextResponse.json({ preview: true, plan });
  }

  // --- Ausführung -----------------------------------------------------------
  const iso = (s: string | null | undefined) => (s ? new Date(s) : null);
  // Alte Exporte (Version 1) kennen keine Genauigkeit: dann tagesgenau.
  const precisionOf = (date: string | null | undefined, p: "DAY" | "MONTH" | "YEAR" | undefined) =>
    date ? (p ?? "DAY") : "DAY";
  const qualifierOf = (
    date: string | null | undefined,
    q: "EXACT" | "ABOUT" | "BEFORE" | "AFTER" | undefined,
  ) => (date ? (q ?? "EXACT") : "EXACT");

  // Personen zuerst: Beziehungen und Bildzuordnungen setzen sie voraus.
  for (const p of data.persons) {
    const fields = {
      givenName: p.givenName,
      familyName: p.familyName ?? null,
      birthName: p.birthName ?? null,
      gender: p.gender,
      birthDate: iso(p.birthDate),
      birthDatePrecision: precisionOf(p.birthDate, p.birthDatePrecision),
      birthDateQualifier: qualifierOf(p.birthDate, p.birthDateQualifier),
      birthPlace: p.birthPlace ?? null,
      deathDate: iso(p.deathDate),
      deathDatePrecision: precisionOf(p.deathDate, p.deathDatePrecision),
      deathDateQualifier: qualifierOf(p.deathDate, p.deathDateQualifier),
      deathPlace: p.deathPlace ?? null,
      notes: p.notes ?? null,
    };
    await prisma.person.upsert({
      where: { id: p.id },
      update: fields,
      create: { id: p.id, ...fields },
    });
  }

  const knownPersons = new Set(
    (await prisma.person.findMany({ select: { id: true } })).map((p) => p.id),
  );

  for (const r of data.relationships) {
    if (!knownPersons.has(r.fromPersonId) || !knownPersons.has(r.toPersonId)) {
      continue;
    }
    if (invalidRelationship(r)) continue;
    // Partnerschaften kanonisch (fromId < toId) speichern wie die API — sonst
    // umginge eine umgekehrt gespeicherte Ehe die Eindeutigkeitsprüfung.
    const [fromPersonId, toPersonId] =
      r.type === "PARTNER_OF" && r.fromPersonId > r.toPersonId
        ? [r.toPersonId, r.fromPersonId]
        : [r.fromPersonId, r.toPersonId];
    const fields = {
      type: r.type,
      subtype: r.subtype,
      fromPersonId,
      toPersonId,
      startDate: iso(r.startDate),
      startDatePrecision: precisionOf(r.startDate, r.startDatePrecision),
      startDateQualifier: qualifierOf(r.startDate, r.startDateQualifier),
      endDate: iso(r.endDate),
      endDatePrecision: precisionOf(r.endDate, r.endDatePrecision),
      endDateQualifier: qualifierOf(r.endDate, r.endDateQualifier),
      notes: r.notes ?? null,
    };
    try {
      await prisma.relationship.upsert({
        where: { id: r.id },
        update: {
          subtype: fields.subtype,
          startDate: fields.startDate,
          startDatePrecision: fields.startDatePrecision,
          startDateQualifier: fields.startDateQualifier,
          endDate: fields.endDate,
          endDatePrecision: fields.endDatePrecision,
          endDateQualifier: fields.endDateQualifier,
          notes: fields.notes,
        },
        create: { id: r.id, ...fields },
      });
    } catch {
      // Verstößt gegen die Eindeutigkeit (Beziehung existiert bereits unter
      // anderer ID) — überspringen statt den ganzen Import abzubrechen.
      plan.warnings.push(`Beziehung ${r.id} übersprungen: bereits vorhanden.`);
    }
  }

  // Bilder: Datei in den Medienordner legen, Vorschau neu erzeugen.
  const importedMedia = new Set<string>();

  for (const m of data.media) {
    const existing = await prisma.mediaAsset.findUnique({ where: { id: m.id } });
    if (existing) {
      importedMedia.add(m.id);
      continue;
    }

    const content = files.get(m.fileName);
    if (!content) continue;

    try {
      const stored = await processAndStoreImage(content, { checkFormat: false });

      await prisma.mediaAsset.create({
        data: {
          id: m.id,
          ...stored,
          fileName: m.fileName,
          caption: m.caption ?? null,
          uploadedById: ctx.userId,
        },
      });
      importedMedia.add(m.id);
    } catch {
      plan.warnings.push(`Bild ${m.fileName} übersprungen: nicht lesbar.`);
    }
  }

  // Zuordnungen erst jetzt, wenn Personen, Beziehungen und Bilder stehen.
  for (const p of data.persons) {
    for (const link of p.media) {
      if (!importedMedia.has(link.mediaId)) continue;
      await prisma.personMedia.upsert({
        where: { personId_mediaId: { personId: p.id, mediaId: link.mediaId } },
        update: { isPrimary: link.isPrimary },
        create: {
          personId: p.id,
          mediaId: link.mediaId,
          isPrimary: link.isPrimary,
        },
      });
    }
  }

  for (const r of data.relationships) {
    const exists = await prisma.relationship.findUnique({ where: { id: r.id } });
    if (!exists) continue;
    for (const link of r.media) {
      if (!importedMedia.has(link.mediaId)) continue;
      await prisma.relationshipMedia.upsert({
        where: {
          relationshipId_mediaId: {
            relationshipId: r.id,
            mediaId: link.mediaId,
          },
        },
        update: { isPrimary: link.isPrimary },
        create: {
          relationshipId: r.id,
          mediaId: link.mediaId,
          isPrimary: link.isPrimary,
        },
      });
    }
  }

  // Quellen und Belege zuletzt: sie verweisen auf Personen, Beziehungen und
  // (als Scan) auf Bilder.
  const existingMediaIds = new Set(
    (await prisma.mediaAsset.findMany({ select: { id: true } })).map((m) => m.id),
  );
  for (const src of data.sources) {
    const fields = {
      title: src.title,
      kind: src.kind,
      author: src.author ?? null,
      repository: src.repository ?? null,
      callNumber: src.callNumber ?? null,
      url: src.url ?? null,
      date: iso(src.date),
      datePrecision: precisionOf(src.date, src.datePrecision),
      dateQualifier: qualifierOf(src.date, src.dateQualifier),
      notes: src.notes ?? null,
      mediaId: src.mediaId && existingMediaIds.has(src.mediaId) ? src.mediaId : null,
    };
    await prisma.source.upsert({
      where: { id: src.id },
      update: fields,
      create: { id: src.id, ...fields, createdById: ctx.userId },
    });
  }

  const [personsNow, relationshipsNow, sourcesNow] = await Promise.all([
    prisma.person.findMany({ select: { id: true } }),
    prisma.relationship.findMany({ select: { id: true, type: true } }),
    prisma.source.findMany({ select: { id: true } }),
  ]);
  const personSet = new Set(personsNow.map((x) => x.id));
  const relTypeNow = new Map(relationshipsNow.map((r) => [r.id, r.type]));
  const sourceSet = new Set(sourcesNow.map((x) => x.id));
  for (const c of data.citations) {
    if (invalidCitation(c, (id) => relTypeNow.get(id))) continue;
    if (!sourceSet.has(c.sourceId)) continue;
    if (c.personId && !personSet.has(c.personId)) continue;
    if (c.relationshipId && !relTypeNow.has(c.relationshipId)) continue;
    const fields = {
      sourceId: c.sourceId,
      personId: c.personId ?? null,
      relationshipId: c.relationshipId ?? null,
      fact: c.fact,
      detail: c.detail ?? null,
      confidence: c.confidence ?? null,
    };
    await prisma.citation.upsert({
      where: { id: c.id },
      update: { fact: fields.fact, detail: fields.detail, confidence: fields.confidence },
      create: { id: c.id, ...fields },
    });
  }

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Person",
    entityId: "import",
    diff: plan,
  });

  return NextResponse.json({ preview: false, plan });
});
