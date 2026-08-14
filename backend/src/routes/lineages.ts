import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { logChange } from "../tree-context.js";
import { deriveLineagesFromSurnames } from "./individuals.js";

const createLineageBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    color: { type: "string" },
  },
  additionalProperties: false,
};

type CreateLineageBody = {
  name: string;
  color?: string;
};

const updateLineageBodySchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    color: { type: "string" },
  },
  additionalProperties: false,
};

type UpdateLineageBody = {
  name?: string;
  color?: string;
};

export default async function lineageRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const treeId = request.treeId!;
    return prisma.lineage.findMany({
      where: { treeId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
  });

  fastify.post("/", { schema: { body: createLineageBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    const { name, color } = request.body as CreateLineageBody;

    const lineage = await prisma.lineage.create({ data: { treeId, name: name.trim(), color } });
    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "lineage.create",
      entityType: "Lineage",
      entityId: lineage.id,
      summary: lineage.name,
    });

    return reply.code(201).send(lineage);
  });

  fastify.patch("/:id", { schema: { body: updateLineageBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    const { id } = request.params as { id: string };
    const updates = request.body as UpdateLineageBody;

    try {
      const existing = await prisma.lineage.findFirst({ where: { id, treeId } });
      if (!existing) throw new HttpError(404, `No existe la rama ${id}`);

      const lineage = await prisma.lineage.update({
        where: { id },
        data: { name: updates.name?.trim(), color: updates.color },
      });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "lineage.update",
        entityType: "Lineage",
        entityId: lineage.id,
        summary: lineage.name,
      });

      return reply.send(lineage);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });

  fastify.delete("/:id", async (request, reply) => {
    const treeId = request.treeId!;
    const { id } = request.params as { id: string };

    try {
      const existing = await prisma.lineage.findFirst({ where: { id, treeId } });
      if (!existing) throw new HttpError(404, `No existe la rama ${id}`);

      await prisma.lineage.delete({ where: { id } });
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "lineage.delete",
        entityType: "Lineage",
        entityId: id,
        summary: existing.name,
      });

      return reply.code(204).send();
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });

  // Manual fallback for the auto-derivation every create/edit/import
  // already does on its own — covers data that predates that feature, or
  // slipped through some path that doesn't call it (an older import, a
  // direct DB write, etc). Re-running it is always safe: it only ever
  // creates a lineage the first time a given name is seen and upserts the
  // membership, never removes anything a user unchecked on purpose.
  fastify.post("/derive", async (request, reply) => {
    const treeId = request.treeId!;

    const individuals = await prisma.individual.findMany({
      where: { treeId, deletedAt: null },
      select: { id: true, surname1: true, surname1BirthName: true },
    });

    await prisma.$transaction(
      async (tx) => {
        for (const ind of individuals) {
          await deriveLineagesFromSurnames(tx, treeId, ind.id, [ind.surname1, ind.surname1BirthName]);
        }
      },
      { timeout: 30_000 },
    );

    const lineages = await prisma.lineage.findMany({ where: { treeId }, orderBy: { name: "asc" } });

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "lineage.derive",
      entityType: "Tree",
      entityId: treeId,
      summary: `${individuals.length} personas revisadas`,
    });

    return reply.send(lineages);
  });
}
