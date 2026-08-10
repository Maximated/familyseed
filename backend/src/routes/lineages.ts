import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export default async function lineageRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const treeId = request.treeId!;
    return prisma.lineage.findMany({
      where: { treeId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
  });
}
