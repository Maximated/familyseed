import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "./auth.js";

const createTreeBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

function treeSummary(member: { role: string; tree: { id: string; name: string; createdAt: Date } }) {
  return { id: member.tree.id, name: member.tree.name, role: member.role, createdAt: member.tree.createdAt };
}

// Top-level (not nested under /trees/:treeId) — this is the entry point
// that lists/creates trees themselves, used by the home screen before any
// single tree is selected.
export default async function treesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);

  fastify.get("/", async (request) => {
    const memberships = await prisma.treeMember.findMany({
      where: { userId: request.userId },
      include: { tree: true },
      orderBy: { tree: { createdAt: "asc" } },
    });

    const owned = memberships.filter((m) => m.role === "OWNER").map(treeSummary);
    const shared = memberships.filter((m) => m.role !== "OWNER").map(treeSummary);

    return { owned, shared };
  });

  fastify.post("/", { schema: { body: createTreeBodySchema } }, async (request, reply) => {
    const { name } = request.body as { name: string };

    const tree = await prisma.$transaction(async (tx) => {
      const created = await tx.tree.create({ data: { name: name.trim() } });
      await tx.treeMember.create({ data: { treeId: created.id, userId: request.userId!, role: "OWNER" } });
      return created;
    });

    return reply.code(201).send({ id: tree.id, name: tree.name, role: "OWNER", createdAt: tree.createdAt });
  });
}
