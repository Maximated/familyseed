import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getDefaultTreeId, logChange } from "../tree-context.js";
import { buildTreeData } from "../tree-data.js";

const updateTreeBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export default async function treeRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    const treeId = await getDefaultTreeId();
    const tree = await prisma.tree.findUniqueOrThrow({ where: { id: treeId } });
    const { people, unions } = await buildTreeData(treeId);

    return { id: tree.id, name: tree.name, people, unions };
  });

  fastify.patch("/", { schema: { body: updateTreeBodySchema } }, async (request) => {
    const { name } = request.body as { name: string };
    const treeId = await getDefaultTreeId();

    const updated = await prisma.tree.update({ where: { id: treeId }, data: { name: name.trim() } });
    await logChange({ action: "tree.rename", entityType: "Tree", entityId: treeId, summary: updated.name });

    return { id: updated.id, name: updated.name };
  });
}
