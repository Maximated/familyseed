import type { FastifyInstance } from "fastify";
import { computeGeneralStatistics, computePersonStatistics } from "../statistics.js";

// GET-only, registered inside treeScopedRoutes — needs no membership
// relaxation, GET already bypasses the VIEWER write-block.
export default async function statisticsRoutes(fastify: FastifyInstance) {
  fastify.get("/statistics", async (request, reply) => {
    const treeId = request.treeId!;
    const { personId } = request.query as { personId?: string };

    const general = await computeGeneralStatistics(treeId);
    if (!personId) return { general };

    const person = await computePersonStatistics(treeId, personId, request.userId!);
    if (!person) return reply.code(404).send({ error: `No existe la persona ${personId}` });

    return { general, person };
  });
}
