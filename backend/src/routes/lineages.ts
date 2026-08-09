import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export default async function lineageRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    return prisma.lineage.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
  });
}
