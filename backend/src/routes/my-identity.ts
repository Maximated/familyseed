import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireTreeMembershipAnyRole } from "../tree-membership.js";
import { requireAuth } from "./auth.js";

const setIdentityBodySchema = {
  type: "object",
  required: ["individualId"],
  properties: {
    individualId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

// Registered directly on the app at the same /trees/:treeId prefix as
// treeScopedRoutes, but as its own sibling plugin with a relaxed membership
// check (requireTreeMembershipAnyRole instead of requireTreeMembership) —
// marking "this is me" is a personal preference any tree member can set,
// including a VIEWER, unlike every other write under /trees/:treeId.
export default async function myIdentityRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook("preHandler", requireTreeMembershipAnyRole);

  fastify.get("/my-identity", async (request) => {
    const row = await prisma.userTreeIdentity.findUnique({
      where: { userId_treeId: { userId: request.userId!, treeId: request.treeId! } },
      include: { individual: { select: { deletedAt: true } } },
    });

    // A stale pointer at a soft-deleted person reads as "nothing set" —
    // never surface a trashed individual as someone's "this is me".
    if (!row || row.individual.deletedAt !== null) return { individualId: null };
    return { individualId: row.individualId };
  });

  fastify.put("/my-identity", { schema: { body: setIdentityBodySchema } }, async (request, reply) => {
    const { individualId } = request.body as { individualId: string };
    const treeId = request.treeId!;

    const person = await prisma.individual.findFirst({ where: { id: individualId, treeId, deletedAt: null } });
    if (!person) return reply.code(404).send({ error: `No existe la persona ${individualId}` });

    // upsert on the unique [userId, treeId] key is the atomic "unset
    // whatever I had picked before, set this instead" swap.
    const row = await prisma.userTreeIdentity.upsert({
      where: { userId_treeId: { userId: request.userId!, treeId } },
      update: { individualId },
      create: { userId: request.userId!, treeId, individualId },
    });

    return { individualId: row.individualId };
  });

  fastify.delete("/my-identity", async (request) => {
    await prisma.userTreeIdentity.deleteMany({ where: { userId: request.userId!, treeId: request.treeId! } });
    return { individualId: null };
  });
}
