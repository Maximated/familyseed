import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { logChange } from "../tree-context.js";
import { buildTreeData, walkGraph } from "../tree-data.js";
import { importGedcomIntoTree, serializeGedcom } from "../gedcom.js";
import { downloadFilename } from "../filename.js";

export default async function gedcomRoutes(fastify: FastifyInstance) {
  // Drag&drop import: creates or updates individuals/families by their
  // GEDCOM xref (@I1@, @F1@, ...) — re-importing the same file (or a newer
  // export from another program that kept the same xrefs) updates existing
  // rows instead of duplicating them, via the unique (treeId, gedcomXref)
  // constraint already on both models.
  fastify.post("/import", async (request, reply) => {
    const treeId = request.treeId!;

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "No se recibió ningún archivo" });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString("utf-8");

    let result;
    try {
      result = await importGedcomIntoTree(treeId, text);
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "El archivo GEDCOM no se pudo interpretar";
      return reply.code(400).send({ error: message });
    }

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "gedcom.import",
      entityType: "Tree",
      entityId: treeId,
      summary: `${result.individuals} individuos, ${result.families} familias`,
    });

    return result;
  });

  // Export the whole tree, or (with personId + direction) just one
  // person's ancestor/descendant line — walking the exact same
  // rels.parents/rels.children graph the PDF report and the tree UI use,
  // not a separate query.
  fastify.get("/export", async (request, reply) => {
    const { personId, direction } = request.query as { personId?: string; direction?: string };
    const treeId = request.treeId!;
    const tree = await prisma.tree.findUniqueOrThrow({ where: { id: treeId } });

    let includedIds: Set<string> | null = null;
    if (personId && (direction === "ancestors" || direction === "descendants")) {
      const { people } = await buildTreeData(treeId);
      if (!people.some((p) => p.id === personId)) {
        return reply.code(404).send({ error: `No existe el individuo ${personId}` });
      }
      const walked = walkGraph(people, personId, direction === "ancestors" ? "up" : "down");
      includedIds = new Set([personId, ...walked.keys()]);
    }

    const individuals = await prisma.individual.findMany({
      where: { treeId, deletedAt: null, ...(includedIds ? { id: { in: [...includedIds] } } : {}) },
    });
    const includedSet = new Set(individuals.map((i) => i.id));

    const rawFamilies = await prisma.family.findMany({ where: { treeId }, include: { children: true } });
    // Only export families fully inside the exported set — otherwise a
    // partial (ancestors/descendants-only) export could reference a HUSB/
    // WIFE individual it never includes, producing an invalid GEDCOM file.
    const families = rawFamilies
      .filter((f) => f.partner1Id || f.partner2Id)
      .filter((f) => (!f.partner1Id || includedSet.has(f.partner1Id)) && (!f.partner2Id || includedSet.has(f.partner2Id)))
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
        childIds: f.children.map((c) => c.individualId).filter((id) => includedSet.has(id)),
      }));

    const gedcom = serializeGedcom(individuals, families);
    const filenameSafe = downloadFilename(tree.name, "arbol");

    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filenameSafe}.ged"`);
    return reply.send(gedcom);
  });
}
