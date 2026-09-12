import type { FastifyInstance } from "fastify";
import archiver from "archiver";
import { stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { serializeCsv } from "../csv.js";
import { serializeGedcom } from "../gedcom.js";
import { downloadFilename } from "../filename.js";
import { uploadsRoot } from "../uploads.js";

// GEDCOM/CSV export never included photos or documents — neither format
// really has a place to put a file people actually intend to open years
// from now with no app around to interpret it. This bundles the exact
// same full-tree CSV and GEDCOM export as a proper standalone backup: one
// folder per person (named so it reads on its own, not just a bare id),
// holding every photo/document that person has, so a restore — or just
// digging through the zip by hand — never loses track of whose photo is
// whose.
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

function personFolderName(individual: { id: string; givenNames: string; surname1: string }): string {
  const safeName = `${individual.givenNames}_${individual.surname1}`
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safeName || "persona"}_${individual.id}`;
}

// Every url this app ever writes for a person's photo/document is exactly
// "/uploads/<treeId>/<individualId>/<storedFilename>" (see saveUpload in
// uploads.ts) — trusting that shape here instead of re-deriving the disk
// path from separate treeId/individualId fields keeps this in sync with
// however that helper is written, not a second copy of its logic.
function urlToDiskPath(url: string): string {
  return path.join(uploadsRoot(), url.replace(/^\/uploads\//, ""));
}

// Zip entry names collide easily (two uploads both literally named
// "foto.jpg") in a way the disk storage never does (each gets its own
// uuid-prefixed filename) — dedupe per person folder rather than let
// archiver silently overwrite one entry with another.
function uniqueEntryName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) {
    n++;
    candidate = `${base} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

const README = `Copia de seguridad de FamilySeed
================================

- arbol.csv y arbol.ged: los mismos datos del árbol en dos formatos —
  cualquiera de los dos basta para reconstruirlo (en FamilySeed o en otro
  programa de genealogía compatible con GEDCOM/CSV).
- fotos/<nombre>_<id>/: las fotos y documentos de cada persona, en su
  propia carpeta. El "<id>" del nombre de carpeta es exactamente el
  mismo valor que aparece en la columna "id" de arbol.csv, así que
  siempre se puede saber a quién pertenece cada carpeta aunque el nombre
  por sí solo no fuera suficiente (dos personas con el mismo nombre,
  etc.).
`;

export default async function backupRoutes(fastify: FastifyInstance) {
  fastify.get("/backup", async (request, reply) => {
    const treeId = request.treeId!;
    const tree = await prisma.tree.findUniqueOrThrow({ where: { id: treeId } });

    const individuals = await prisma.individual.findMany({ where: { treeId, deletedAt: null } });
    const rawFamilies = await prisma.family.findMany({ where: { treeId }, include: { children: true } });
    const families = rawFamilies
      .filter((f) => f.partner1Id || f.partner2Id)
      .map((f) => ({
        id: f.id,
        partner1Id: f.partner1Id,
        partner2Id: f.partner2Id,
        unionType: f.unionType,
        unionStatus: f.unionStatus,
        unionDateText: f.unionDateText,
        unionDateValue: f.unionDateValue,
        unionDatePrecision: f.unionDatePrecision,
        unionPlace: f.unionPlace,
        notes: f.notes,
        childIds: f.children.map((c) => c.individualId),
      }));

    const media = await prisma.personMedia.findMany({ where: { treeId } });
    const mediaByIndividual = new Map<string, typeof media>();
    for (const m of media) {
      const list = mediaByIndividual.get(m.individualId) ?? [];
      list.push(m);
      mediaByIndividual.set(m.individualId, list);
    }

    const csv = serializeCsv(individuals, families);
    const gedcom = serializeGedcom(individuals, families);
    const filenameSafe = downloadFilename(tree.name, "backup");

    // reply.hijack() stops Fastify from touching the raw response any
    // further — including never writing out anything queued via
    // reply.header(), so those have to be set directly on reply.raw
    // instead (before anything is written to it).
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filenameSafe}.zip"`,
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => {
      request.log.error(err);
      reply.raw.destroy(err);
    });
    archive.pipe(reply.raw);

    archive.append(README, { name: "LEEME.txt" });
    archive.append(csv, { name: "arbol.csv" });
    archive.append(gedcom, { name: "arbol.ged" });

    for (const individual of individuals) {
      const folder = personFolderName(individual);
      const files: { url: string; filename: string }[] = [];
      if (individual.photoUrl) {
        files.push({ url: individual.photoUrl, filename: `foto_perfil${path.extname(individual.photoUrl)}` });
      }
      for (const m of mediaByIndividual.get(individual.id) ?? []) {
        files.push({ url: m.url, filename: m.filename });
      }

      const usedNames = new Set<string>();
      for (const file of files) {
        const diskPath = urlToDiskPath(file.url);
        try {
          await stat(diskPath);
        } catch {
          // A media row whose file no longer exists on disk shouldn't
          // abort the whole backup — just leave it out.
          continue;
        }
        const entryName = uniqueEntryName(usedNames, file.filename);
        archive.file(diskPath, { name: `fotos/${folder}/${entryName}` });
      }
    }

    await archive.finalize();
  });
}
