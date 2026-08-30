import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { logChange } from "../tree-context.js";
import { buildTreeData, expandWithSpouses, walkGraph } from "../tree-data.js";
import { csvTemplate, importCsvIntoTree, serializeCsv } from "../csv.js";
import { downloadFilename } from "../filename.js";

export default async function csvRoutes(fastify: FastifyInstance) {
  fastify.get("/template", async (_request, reply) => {
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="plantilla-familyseed.csv"');
    return reply.send(csvTemplate());
  });

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
      result = await importCsvIntoTree(treeId, text);
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "El archivo CSV no se pudo interpretar";
      return reply.code(400).send({ error: message });
    }

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "csv.import",
      entityType: "Tree",
      entityId: treeId,
      summary: `${result.individuals} individuos, ${result.families} familias`,
    });

    return result;
  });

  // Same ancestors/descendants scoping as GEDCOM export, reusing the same
  // walkGraph helper.
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
      includedIds = expandWithSpouses([personId, ...walked.keys()], people);
    }

    const individuals = await prisma.individual.findMany({
      where: { treeId, deletedAt: null, ...(includedIds ? { id: { in: [...includedIds] } } : {}) },
    });
    const includedSet = new Set(individuals.map((i) => i.id));

    const rawFamilies = await prisma.family.findMany({ where: { treeId }, include: { children: true } });
    const families = rawFamilies.map((f) => ({
      partner1Id: f.partner1Id && includedSet.has(f.partner1Id) ? f.partner1Id : null,
      partner2Id: f.partner2Id && includedSet.has(f.partner2Id) ? f.partner2Id : null,
      childIds: f.children.map((c) => c.individualId).filter((id) => includedSet.has(id)),
      unionType: f.unionType,
      unionStatus: f.unionStatus,
      unionDateText: f.unionDateText,
      unionDateValue: f.unionDateValue,
      unionDatePrecision: f.unionDatePrecision,
      unionPlace: f.unionPlace,
      notes: f.notes,
    }));

    const csv = serializeCsv(individuals, families);
    const filenameSafe = downloadFilename(tree.name, "arbol");

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filenameSafe}.csv"`);
    return reply.send(csv);
  });
}
