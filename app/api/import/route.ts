import { NextResponse } from "next/server";
import JSZip from "jszip";
import { safeHttpUrl } from "@/lib/source-classify";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { audit, auditActor } from "@/lib/audit";
import { nameChangeSet } from "@/lib/change-sets";
import { queuePlaceAutoAssign } from "@/lib/services/places";
import { placeKey } from "@/lib/places/normalize";
import { processAndStoreImage } from "@/lib/media-processing";
import type { Prisma } from "@prisma/client";

import { PERSON_FACTS, relationshipFacts, subtypeMatchesType } from "@/lib/validation";
import { eventIssues } from "@/lib/events";
import {
  exchangeDateColumns,
  exchangeSchema,
  type ExchangeCitation,
  type ExchangeEvent,
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
  events: { create: number; update: number };
  personNames: { create: number; update: number };
  externalIds: { create: number; update: number };
  rawRecords: { create: number; update: number };
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
  if (c.eventId) return c.fact === "EVENT" ? null : `Angabe ${c.fact} passt nicht zu einem Ereignis.`;
  if (c.fact === "EVENT") return "Angabe EVENT ohne Ereignis.";
  if (c.personId && !PERSON_FACTS.includes(c.fact)) return `Angabe ${c.fact} passt nicht zu einer Person.`;
  if (c.relationshipId) {
    const type = relationshipType(c.relationshipId);
    if (type && !relationshipFacts(type).includes(c.fact)) {
      return `Angabe ${c.fact} passt nicht zur Beziehung.`;
    }
  }
  return null;
}

/** Ereignis: genau ein Träger, Art passend (lib/events.ts). */
function invalidEvent(
  e: ExchangeEvent,
  relationshipType: (id: string) => "PARENT_OF" | "PARTNER_OF" | undefined,
): string | null {
  if (Boolean(e.personId) === Boolean(e.relationshipId)) return "braucht genau eine Person oder eine Beziehung.";
  const type = e.relationshipId ? relationshipType(e.relationshipId) : undefined;
  if (e.relationshipId && !type) return null; // unbekannte Beziehung: eigene Warnung
  const issues = eventIssues({
    type: e.type,
    isAlternative: e.isAlternative,
    label: e.label,
    owner: e.personId ? { kind: "person" } : { kind: "relationship", type: type! },
  });
  return issues.length ? issues.map((i) => i.message).join("; ") : null;
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
  const [
    existingPersons,
    existingRelationships,
    existingMedia,
    existingSources,
    existingCitations,
    existingEvents,
    existingNames,
    existingExternal,
    existingRaw,
  ] = await Promise.all([
    prisma.person.findMany({ select: { id: true } }),
    prisma.relationship.findMany({ select: { id: true, type: true } }),
    prisma.mediaAsset.findMany({ select: { id: true } }),
    prisma.source.findMany({ select: { id: true } }),
    prisma.citation.findMany({ select: { id: true } }),
    prisma.event.findMany({ select: { id: true } }),
    prisma.personName.findMany({ select: { id: true } }),
    prisma.externalId.findMany({ select: { id: true } }),
    prisma.importRawRecord.findMany({ select: { id: true } }),
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
    events: { create: 0, update: 0 },
    personNames: { create: 0, update: 0 },
    externalIds: { create: 0, update: 0 },
    rawRecords: { create: 0, update: 0 },
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
  const eventIds = new Set(existingEvents.map((x) => x.id));
  const knownEvents = new Set<string>(eventIds);
  for (const e of data.events) {
    const invalid = invalidEvent(e, (id) => relType.get(id));
    if (invalid) {
      warnings.push(`Ereignis ${e.id} wird übersprungen: ${invalid}`);
      continue;
    }
    if ((e.personId && !knownPersons.has(e.personId)) || (e.relationshipId && !relType.has(e.relationshipId))) {
      warnings.push(`Ereignis ${e.id} verweist auf eine unbekannte Person oder Beziehung und wird übersprungen.`);
      continue;
    }
    knownEvents.add(e.id);
    if (eventIds.has(e.id)) plan.events.update++;
    else plan.events.create++;
  }
  const nameIds = new Set(existingNames.map((x) => x.id));
  for (const n of data.personNames) {
    if (!knownPersons.has(n.personId)) {
      warnings.push(`Name ${n.id} verweist auf eine unbekannte Person und wird übersprungen.`);
      continue;
    }
    if (nameIds.has(n.id)) plan.personNames.update++;
    else plan.personNames.create++;
  }
  const externalIdSet = new Set(existingExternal.map((x) => x.id));
  for (const x of data.externalIds) {
    if (externalIdSet.has(x.id)) plan.externalIds.update++;
    else plan.externalIds.create++;
  }
  const rawIdSet = new Set(existingRaw.map((x) => x.id));
  for (const r of data.rawRecords) {
    if (rawIdSet.has(r.id)) plan.rawRecords.update++;
    else plan.rawRecords.create++;
  }

  for (const c of data.citations) {
    const invalid = invalidCitation(c, (id) => relType.get(id));
    if (invalid) {
      warnings.push(`Beleg ${c.id} wird übersprungen: ${invalid}`);
      continue;
    }
    if (
      !knownSources.has(c.sourceId) ||
      (c.personId && !knownPersons.has(c.personId)) ||
      (c.relationshipId && !relType.has(c.relationshipId)) ||
      (c.eventId && !knownEvents.has(c.eventId))
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
  nameChangeSet(ctx.scope, `Daten eingespielt („${file.name || "Datei"}“)`, "IMPORT");
  // Alte Exporte (Version 1/2) kennen weder Genauigkeit noch Bereichsende
  // bzw. Wortlaut: dann tagesgenau, genau, ohne Ende (exchangeDateColumns).
  const dates = (key: string, r: object) => exchangeDateColumns(key, r as Record<string, unknown>);

  // Personen zuerst: Beziehungen und Bildzuordnungen setzen sie voraus.
  for (const p of data.persons) {
    const fields = {
      givenName: p.givenName,
      familyName: p.familyName ?? null,
      birthName: p.birthName ?? null,
      nickname: p.nickname ?? null,
      namePrefix: p.namePrefix ?? null,
      nameSuffix: p.nameSuffix ?? null,
      gender: p.gender,
      ...dates("birthDate", p),
      birthPlace: p.birthPlace ?? null,
      ...dates("deathDate", p),
      deathPlace: p.deathPlace ?? null,
      deathCause: p.deathCause ?? null,
      notes: p.notes ?? null,
    } as Prisma.PersonUncheckedCreateInput;
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
      ...dates("startDate", r),
      startPlace: r.startPlace ?? null,
      ...dates("endDate", r),
      endPlace: r.endPlace ?? null,
      notes: r.notes ?? null,
    } as Prisma.RelationshipUncheckedCreateInput;
    // Die verknüpften Personen und der Typ bleiben beim Aktualisieren fest.
    const { type: _type, fromPersonId: _from, toPersonId: _to, ...updatable } = fields;
    try {
      await prisma.relationship.upsert({
        where: { id: r.id },
        update: updatable,
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
      kindLabel: src.kindLabel ?? null,
      provider: src.provider ?? null,
      author: src.author ?? null,
      repository: src.repository ?? null,
      callNumber: src.callNumber ?? null,
      url: safeHttpUrl(src.url),
      ...dates("date", src),
      notes: src.notes ?? null,
      mediaId: src.mediaId && existingMediaIds.has(src.mediaId) ? src.mediaId : null,
    } as Prisma.SourceUncheckedCreateInput;
    await prisma.source.upsert({
      where: { id: src.id },
      update: fields,
      create: { id: src.id, ...fields, createdById: ctx.userId },
    });
    // Ab Version 4: weitere Bilder der Quelle (ergänzend, vorhandene bleiben).
    const links = src.media.filter((m) => existingMediaIds.has(m.mediaId));
    if (links.length) {
      await prisma.sourceMedia.createMany({
        data: links.map((m) => ({ sourceId: src.id, mediaId: m.mediaId, sortOrder: m.sortOrder })),
        skipDuplicates: true,
      });
    }
  }

  const [personsNow, relationshipsNow, sourcesNow] = await Promise.all([
    prisma.person.findMany({ select: { id: true } }),
    prisma.relationship.findMany({ select: { id: true, type: true } }),
    prisma.source.findMany({ select: { id: true } }),
  ]);
  const personSet = new Set(personsNow.map((x) => x.id));
  const relTypeNow = new Map(relationshipsNow.map((r) => [r.id, r.type]));
  const sourceSet = new Set(sourcesNow.map((x) => x.id));

  // Ereignisse und Namen (ab Version 3) — vor den Belegen, die auf
  // Ereignisse verweisen können. Der Träger bleibt beim Aktualisieren fest.
  for (const e of data.events) {
    if (invalidEvent(e, (id) => relTypeNow.get(id))) continue;
    if (e.personId && !personSet.has(e.personId)) continue;
    if (e.relationshipId && !relTypeNow.has(e.relationshipId)) continue;
    const fields = {
      type: e.type,
      label: e.label ?? null,
      isAlternative: e.isAlternative,
      ...dates("date", e),
      place: e.place ?? null,
      address: e.address ?? null,
      value: e.value ?? null,
      cause: e.cause ?? null,
      age: e.age ?? null,
      agency: e.agency ?? null,
      notes: e.notes ?? null,
      sortOrder: e.sortOrder,
    } as Prisma.EventUncheckedUpdateInput;
    await prisma.event.upsert({
      where: { id: e.id },
      update: fields,
      create: {
        ...(fields as Prisma.EventUncheckedCreateInput),
        id: e.id,
        personId: e.personId ?? null,
        relationshipId: e.relationshipId ?? null,
      },
    });
    const links = e.media.filter((m) => existingMediaIds.has(m.mediaId));
    if (links.length) {
      await prisma.eventMedia.createMany({
        data: links.map((m) => ({ eventId: e.id, mediaId: m.mediaId, sortOrder: m.sortOrder })),
        skipDuplicates: true,
      });
    }
  }
  const eventOwnerNow = new Map(
    (await prisma.event.findMany({ select: { id: true, personId: true, relationshipId: true } })).map((e) => [e.id, e]),
  );
  for (const n of data.personNames) {
    if (!personSet.has(n.personId)) continue;
    const { id, personId, ...fields } = n;
    await prisma.personName.upsert({
      where: { id },
      update: fields,
      create: { id, personId, ...fields },
    });
  }

  for (const c of data.citations) {
    if (invalidCitation(c, (id) => relTypeNow.get(id))) continue;
    if (!sourceSet.has(c.sourceId)) continue;
    if (c.personId && !personSet.has(c.personId)) continue;
    if (c.relationshipId && !relTypeNow.has(c.relationshipId)) continue;
    // Ein Ereignisbeleg trägt den Träger des Ereignisses — so wie die API ihn anlegt.
    const owner = c.eventId ? eventOwnerNow.get(c.eventId) : null;
    if (c.eventId && !owner) continue;
    const fields = {
      sourceId: c.sourceId,
      personId: owner ? owner.personId : (c.personId ?? null),
      relationshipId: owner ? owner.relationshipId : (c.relationshipId ?? null),
      eventId: c.eventId ?? null,
      fact: c.fact,
      detail: c.detail ?? null,
      url: safeHttpUrl(c.url),
      confidence: c.confidence ?? null,
      text: c.text ?? null,
    };
    await prisma.citation.upsert({
      where: { id: c.id },
      update: { fact: fields.fact, detail: fields.detail, url: fields.url, confidence: fields.confidence, text: fields.text },
      create: { id: c.id, ...fields },
    });
    const links = c.media.filter((m) => existingMediaIds.has(m.mediaId));
    if (links.length) {
      await prisma.citationMedia.createMany({
        data: links.map((m) => ({ citationId: c.id, mediaId: m.mediaId, sortOrder: m.sortOrder })),
        skipDuplicates: true,
      });
    }
  }

  // Fremdkennungen und Rohdaten: nur mit vorhandenem Träger; unverändert
  // übernommen (ohne Importlauf — der gehört zur Quellinstanz).
  const mediaNow = new Set((await prisma.mediaAsset.findMany({ select: { id: true } })).map((m) => m.id));
  const exists = (x: { personId?: string | null; relationshipId?: string | null; eventId?: string | null; sourceId?: string | null; mediaId?: string | null }) => {
    const refs = [
      x.personId ? personSet.has(x.personId) : null,
      x.relationshipId ? relTypeNow.has(x.relationshipId) : null,
      x.eventId ? eventOwnerNow.has(x.eventId) : null,
      x.sourceId ? sourceSet.has(x.sourceId) : null,
      x.mediaId ? mediaNow.has(x.mediaId) : null,
    ].filter((v) => v !== null);
    return refs.length === 1 && refs[0] === true;
  };
  for (const x of data.externalIds) {
    if (!exists(x)) {
      plan.warnings.push(`Fremdkennung ${x.id} übersprungen: Bezug fehlt.`);
      continue;
    }
    const fields = {
      system: x.system,
      value: x.value,
      personId: x.personId ?? null,
      relationshipId: x.relationshipId ?? null,
      eventId: x.eventId ?? null,
      sourceId: x.sourceId ?? null,
      mediaId: x.mediaId ?? null,
    };
    await prisma.externalId.upsert({ where: { id: x.id }, update: fields, create: { id: x.id, ...fields } });
  }
  for (const r of data.rawRecords) {
    if (!exists({ personId: r.personId, relationshipId: r.relationshipId, sourceId: r.sourceId })) {
      plan.warnings.push(`Rohdaten ${r.id} übersprungen: Bezug fehlt.`);
      continue;
    }
    const content = (r.content ?? null) as Prisma.InputJsonValue;
    const fields = {
      personId: r.personId ?? null,
      relationshipId: r.relationshipId ?? null,
      sourceId: r.sourceId ?? null,
      recordType: r.recordType,
      xref: r.xref ?? null,
      content,
      reason: r.reason ?? null,
      sizeBytes: Buffer.byteLength(JSON.stringify(r.content ?? null), "utf8"),
      supersededAt: r.superseded ? new Date() : null,
    };
    await prisma.importRawRecord.upsert({ where: { id: r.id }, update: fields, create: { id: r.id, ...fields } });
  }

  // Ortszuordnungen (ab Version 5): nur für Texte ohne vorhandene Zuordnung —
  // was hier schon zugeordnet ist (automatisch, KI, von Hand), bleibt.
  for (const pl of data.places) {
    const key = placeKey(pl.text);
    if (!key || (await prisma.place.findUnique({ where: { key }, select: { id: true } }))) continue;
    const created = await prisma.place.create({
      data: {
        key,
        text: pl.text.trim(),
        source: pl.source,
        unresolvable: pl.unresolvable,
        precision: pl.precision ?? null,
        latitude: pl.latitude ?? null,
        longitude: pl.longitude ?? null,
        label: pl.label ?? null,
        countryCode: pl.countryCode ?? null,
        gazetteerId: pl.gazetteerId ?? null,
        note: pl.note ?? null,
        uncertain: pl.uncertain ?? false,
      },
    });
    await audit({
      ...auditActor(ctx.scope),
      action: "CREATE",
      entityType: "Place",
      entityId: created.id,
      diff: { subject: created.text, source: created.source, label: created.label, latitude: created.latitude, longitude: created.longitude },
    });
  }

  await audit({
    ...auditActor(ctx.scope),
    action: "CREATE",
    // Bis zum Changelog „Person“/„import“; der Lauf ist keine Person.
    entityType: "ImportBatch",
    entityId: "exchange",
    diff: { exchange: true, ...plan },
    // Für den Verlauf der Personen: alle Personen der Datei (eingespielt
    // oder aktualisiert), samt ihren Familien.
    personIds: data.persons.map((p) => p.id),
  });
  // Neue Ortstexte im Hintergrund zuordnen (alle offenen).
  queuePlaceAutoAssign(ctx.scope);

  return NextResponse.json({ preview: false, plan });
});
