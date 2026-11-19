import { NextResponse } from "next/server";

import { route } from "@/lib/api";
import { validationError } from "@/lib/services";
import { startGedcomImport } from "@/lib/services/gedcom-import";

export const runtime = "nodejs";

/**
 * GEDCOM hochladen (.ged oder .zip mit einer .ged): Lauf anlegen, Original
 * aufbewahren, Vorschau berechnen. Ändert keine Stammbaumdaten. Nur Admins.
 */
export const POST = route("data:import", async (ctx, req) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw validationError([{ path: "file", message: "Bitte eine GEDCOM-Datei wählen" }]);
  const bytes = Buffer.from(await file.arrayBuffer());
  return NextResponse.json(await startGedcomImport(ctx.scope, { fileName: file.name || "import.ged", bytes }));
});
