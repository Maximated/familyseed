import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getDefaultTreeId } from "../tree-context.js";

// No auth exists yet (see tree-context.ts) — this resolves to the sole
// owner of the default tree. Once hosted mode adds real sessions, this
// becomes "the logged-in user" instead; the response shape doesn't change.
export default async function meRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_request, reply) => {
    const treeId = await getDefaultTreeId();

    const membership = await prisma.treeMember.findFirst({
      where: { treeId, role: "OWNER" },
      include: { user: true },
    });

    if (!membership) {
      return reply.code(404).send({ error: "No hay ningún usuario configurado todavía." });
    }

    return {
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
    };
  });
}
