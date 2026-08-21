import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { logChange } from "../tree-context.js";
import { deriveLineagesFromSurnames, lineageMatchKey } from "./individuals.js";

// Catches lineages that already split apart *before* deriveLineagesFromSurnames
// started grouping by lineageMatchKey — e.g. "Jasiurkowski" and "Jasiurkowska"
// both already existing as their own lineage from before that fix. Groups
// every lineage in the tree by that same key and, for any group with more
// than one, folds the rest into whichever already has the most members (a
// tie-break by earliest createdAt, so the outcome is deterministic rather
// than depending on query order) — moving each membership over first since
// a person could in principle already belong to both, then deleting the
// merged-away lineage (its own now-empty membership rows cascade with it).
// Returns how many lineages were removed this way, purely for the response
// message; the caller already re-fetches the surviving set itself.
async function mergeGenderedLineageDuplicates(tx: Prisma.TransactionClient, treeId: string): Promise<number> {
  const lineages = await tx.lineage.findMany({
    where: { treeId },
    include: { _count: { select: { individuals: true } } },
  });

  const groups = new Map<string, typeof lineages>();
  for (const lineage of lineages) {
    const key = lineageMatchKey(lineage.name);
    const group = groups.get(key);
    if (group) group.push(lineage);
    else groups.set(key, [lineage]);
  }

  let mergedCount = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort((a, b) => {
      if (b._count.individuals !== a._count.individuals) return b._count.individuals - a._count.individuals;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    for (const loser of rest) {
      const memberships = await tx.individualLineage.findMany({ where: { lineageId: loser.id } });
      for (const membership of memberships) {
        await tx.individualLineage.upsert({
          where: { individualId_lineageId: { individualId: membership.individualId, lineageId: survivor.id } },
          create: { individualId: membership.individualId, lineageId: survivor.id },
          update: {},
        });
      }
      await tx.lineage.delete({ where: { id: loser.id } });
      mergedCount += 1;
    }
  }

  return mergedCount;
}

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
  // membership, never removes anything a user unchecked on purpose (the
  // one exception being mergeGenderedLineageDuplicates below, which only
  // ever removes a lineage by folding its members into another one that
  // stands in for the exact same family).
  fastify.post("/derive", async (request, reply) => {
    const treeId = request.treeId!;

    const individuals = await prisma.individual.findMany({
      where: { treeId, deletedAt: null },
      select: { id: true, surname1: true, surname1BirthName: true },
    });

    const mergedCount = await prisma.$transaction(
      async (tx) => {
        for (const ind of individuals) {
          await deriveLineagesFromSurnames(tx, treeId, ind.id, [ind.surname1, ind.surname1BirthName]);
        }
        return mergeGenderedLineageDuplicates(tx, treeId);
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
      summary: `${individuals.length} personas revisadas, ${mergedCount} ramas fusionadas`,
    });

    return reply.send({ lineages, mergedCount });
  });
}
