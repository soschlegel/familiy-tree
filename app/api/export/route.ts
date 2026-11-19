import { NextResponse } from "next/server";
import JSZip from "jszip";

import { route } from "@/lib/api";
import { getObjectBuffer } from "@/lib/storage";
import { buildExport } from "@/lib/services/exchange-export";
import { buildGedcomExport, buildGedcomZip } from "@/lib/services/gedcom-export";

export const runtime = "nodejs";

/**
 * Export als JSON (?format=json) oder als ZIP mit den Bilddateien
 * (?format=zip). Nur wer Bilder sehen darf, darf auch exportieren — der
 * Export enthält denselben Bestand.
 */
export const GET = route(null, async (ctx, req) => {
  const format = new URL(req.url).searchParams.get("format") ?? "json";

  // GEDCOM 5.5.1 (UTF-8) bzw. als ZIP mit den Bilddateien unter media/.
  if (format === "gedcom") {
    const g = await buildGedcomExport(ctx.scope);
    return new NextResponse(new Uint8Array(g.bytes), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${g.fileName}"`,
      },
    });
  }
  if (format === "gedzip") {
    const z = await buildGedcomZip(ctx.scope);
    return new NextResponse(new Uint8Array(z.buffer), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.fileName}"` },
    });
  }

  const { data, keyByFileName } = await buildExport(ctx.scope);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="stammbaum_${stamp}.json"`,
      },
    });
  }

  if (format !== "zip") {
    return NextResponse.json(
      { error: "format muss json, zip, gedcom oder gedzip sein" },
      { status: 400 },
    );
  }

  const zip = new JSZip();
  zip.file("stammbaum.json", JSON.stringify(data, null, 2));

  const folder = zip.folder("media")!;
  let missing = 0;

  for (const [fileName, storageKey] of keyByFileName) {
    try {
      const content = await getObjectBuffer(storageKey);
      if (!content) {
        missing++;
        continue;
      }
      folder.file(fileName, content);
    } catch (err) {
      // Ein einzelnes fehlendes Bild darf den gesamten Export nicht kippen.
      console.error("[export] Bild übersprungen:", storageKey, err);
      missing++;
    }
  }

  if (missing > 0) {
    zip.file(
      "HINWEIS.txt",
      `${missing} Bilddatei(en) konnten nicht gelesen werden und fehlen in diesem Archiv.\n` +
        `Die zugehörigen Einträge stehen weiterhin in stammbaum.json.\n`,
    );
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    // Bilder sind bereits WebP-komprimiert — hohe Stufen kosten viel Zeit
    // und bringen fast nichts.
    compressionOptions: { level: 1 },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="stammbaum_${stamp}.zip"`,
    },
  });
});
