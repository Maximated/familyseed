import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { logChange } from "../tree-context.js";
import { buildTreeData } from "../tree-data.js";
import { deleteTreeUploads } from "../uploads.js";

const updateTreeBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

const deleteTreeBodySchema = {
  type: "object",
  required: ["confirmName"],
  properties: {
    // A second, server-side check that the caller really means it — typing
    // the tree's own name is the same friction GitHub uses for deleting a
    // repo, appropriate here since this has no trash/undo the way deleting
    // a single person does: everything in the tree is gone for good.
    confirmName: { type: "string" },
  },
  additionalProperties: false,
};

// Registered under /trees/:treeId — GET/PATCH the one tree the membership
// preHandler already resolved and validated.
export default async function treeRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const treeId = request.treeId!;
    const [tree, memberCount] = await Promise.all([
      prisma.tree.findUniqueOrThrow({ where: { id: treeId } }),
      prisma.treeMember.count({ where: { treeId } }),
    ]);
    const { people, unions } = await buildTreeData(treeId);

    return { id: tree.id, name: tree.name, role: request.treeRole, memberCount, people, unions };
  });

  fastify.patch("/", { schema: { body: updateTreeBodySchema } }, async (request) => {
    const { name } = request.body as { name: string };
    const treeId = request.treeId!;

    const updated = await prisma.tree.update({ where: { id: treeId }, data: { name: name.trim() } });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "tree.rename",
      entityType: "Tree",
      entityId: treeId,
      summary: updated.name,
    });

    return { id: updated.id, name: updated.name };
  });

  fastify.delete("/", { schema: { body: deleteTreeBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    if (request.treeRole !== "OWNER") {
      return reply.code(403).send({ error: "Solo el propietario puede eliminar el árbol" });
    }

    const { confirmName } = request.body as { confirmName: string };
    const tree = await prisma.tree.findUniqueOrThrow({ where: { id: treeId } });
    if (confirmName !== tree.name) {
      return reply.code(400).send({ error: "El nombre no coincide" });
    }

    // Cascades away every individual, family, lineage, member, and change
    // log entry in the same transaction the schema already sets up for
    // this — only the uploaded files on disk need a separate cleanup pass.
    await prisma.tree.delete({ where: { id: treeId } });
    await deleteTreeUploads(treeId);

    return reply.code(204).send();
  });
}
