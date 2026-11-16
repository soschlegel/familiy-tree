import { NextResponse } from "next/server";
import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { processAndStoreImage } from "@/lib/media-processing";
import { subtypeMatchesType } from "@/lib/validation";
import {
  exchangeSchema,
  type ExchangeFile,
  type ExchangeRelationship,
} from "@/lib/exchange";

export const runtime = "nodejs";

type Plan = {
  persons: { create: number; update: number };
  relationships: { create: number; update: number };
  media: { create: number; skip: number; withoutFile: number };
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
 * Ermittelt, was der Import täte — ohne etwas zu ändern. Dieselbe Funktion
 * liefert die Vorschau und die Grundlage für den eigentlichen Lauf, damit
 * Vorschau und Ausführung nicht auseinanderlaufen können.
 */
async function makePlan(
  data: ExchangeFile,
  files: Map<string, Buffer>,
): Promise<Plan> {
  const [existingPersons, existingRelationships, existingMedia] =
    await Promise.all([
      prisma.person.findMany({ select: { id: true } }),
      prisma.relationship.findMany({ select: { id: true } }),
      prisma.mediaAsset.findMany({ select: { id: true } }),
    ]);

  const personIds = new Set(existingPersons.map((p) => p.id));
  const relationshipIds = new Set(existingRelationships.map((r) => r.id));
  const mediaIds = new Set(existingMedia.map((m) => m.id));

  const warnings: string[] = [];
  const plan: Plan = {
    persons: { create: 0, update: 0 },
    relationships: { create: 0, update: 0 },
    media: { create: 0, skip: 0, withoutFile: 0 },
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

  // Personen zuerst: Beziehungen und Bildzuordnungen setzen sie voraus.
  for (const p of data.persons) {
    const fields = {
      givenName: p.givenName,
      familyName: p.familyName ?? null,
      birthName: p.birthName ?? null,
      gender: p.gender,
      birthDate: iso(p.birthDate),
      birthPlace: p.birthPlace ?? null,
      deathDate: iso(p.deathDate),
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
      endDate: iso(r.endDate),
      notes: r.notes ?? null,
    };
    try {
      await prisma.relationship.upsert({
        where: { id: r.id },
        update: { subtype: fields.subtype, startDate: fields.startDate, endDate: fields.endDate, notes: fields.notes },
        create: { id: r.id, ...fields },
      });
    } catch {
      // Verstößt gegen die Eindeutigkeit (Beziehung existiert bereits unter
      // anderer ID) — überspringen statt den ganzen Import abzubrechen.
      plan.warnings.push(`Beziehung ${r.id} übersprungen: bereits vorhanden.`);
    }
  }

  // Bilder: Datei in den Objektspeicher legen, Vorschau neu erzeugen.
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

  await audit({
    userId: ctx.userId,
    action: "CREATE",
    entityType: "Person",
    entityId: "import",
    diff: plan,
  });

  return NextResponse.json({ preview: false, plan });
});
