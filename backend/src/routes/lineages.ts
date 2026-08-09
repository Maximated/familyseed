import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getDefaultTreeId } from "../tree-context.js";

export default async function lineageRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    const treeId = await getDefaultTreeId();
    return prisma.lineage.findMany({
      where: { treeId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
  });
}
