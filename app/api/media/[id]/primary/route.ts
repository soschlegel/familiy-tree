import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { route, badRequest, forbidden } from "@/lib/api";
import { audit, auditActor } from "@/lib/audit";
import {
  canUploadForPerson,
  canUploadForRelationship,
} from "@/lib/media-scope";

type Params = { id: string };

const input = z.object({
  personId: z.string().min(1).optional(),
  relationshipId: z.string().min(1).optional(),
});

/**
 * Legt dieses Bild als Primärbild fest — bei einer Person das Bild, das im
 * Stammbaum erscheint, bei einer Hochzeit das Bild am Ereignis.
 *
 * Das Zurücksetzen der übrigen Bilder und das Setzen laufen in einer
 * Transaktion: sonst gäbe es bei einem Abbruch dazwischen entweder zwei
 * Primärbilder oder gar keins.
 */
export const POST = route<Params>(
  null,
  async (ctx, req, { id: mediaId }) => {
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.issues);

    const { personId, relationshipId } = parsed.data;
    if (!personId === !relationshipId) {
      return NextResponse.json(
        { error: "Genau eines von personId oder relationshipId angeben." },
        { status: 400 },
      );
    }

    const allowed = personId
      ? await canUploadForPerson(ctx.scope, personId)
      : await canUploadForRelationship(ctx.scope, relationshipId!);
    if (!allowed) return forbidden("das Primärbild hier festzulegen");

    if (personId) {
      const link = await prisma.personMedia.findUnique({
        where: { personId_mediaId: { personId, mediaId } },
      });
      if (!link) {
        return NextResponse.json(
          { error: "Dieses Bild gehört nicht zu dieser Person." },
          { status: 404 },
        );
      }

      await prisma.$transaction([
        prisma.personMedia.updateMany({
          where: { personId },
          data: { isPrimary: false },
        }),
        prisma.personMedia.update({
          where: { personId_mediaId: { personId, mediaId } },
          data: { isPrimary: true },
        }),
      ]);
    } else {
      const link = await prisma.relationshipMedia.findUnique({
        where: {
          relationshipId_mediaId: { relationshipId: relationshipId!, mediaId },
        },
      });
      if (!link) {
        return NextResponse.json(
          { error: "Dieses Bild gehört nicht zu diesem Ereignis." },
          { status: 404 },
        );
      }

      await prisma.$transaction([
        prisma.relationshipMedia.updateMany({
          where: { relationshipId: relationshipId! },
          data: { isPrimary: false },
        }),
        prisma.relationshipMedia.update({
          where: {
            relationshipId_mediaId: {
              relationshipId: relationshipId!,
              mediaId,
            },
          },
          data: { isPrimary: true },
        }),
      ]);
    }

    await audit({
      ...auditActor(ctx.scope),
      action: "UPDATE",
      entityType: "MediaAsset",
      entityId: mediaId,
      diff: { isPrimary: true, personId, relationshipId },
    });

    return NextResponse.json({ ok: true });
  },
);
