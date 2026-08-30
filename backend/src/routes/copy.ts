import type { FastifyInstance } from "fastify";
import type { Individual } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "./auth.js";
import { buildTreeData, expandWithSpouses, walkGraph } from "../tree-data.js";
import { logChange } from "../tree-context.js";

const copyBodySchema = {
  type: "object",
  required: ["destTreeId", "mode"],
  properties: {
    destTreeId: { type: "string" },
    mode: { type: "string", enum: ["single", "lineage"] },
    direction: { type: "string", enum: ["ancestors", "descendants"] },
  },
  additionalProperties: false,
};

type CopyBody = {
  destTreeId: string;
  mode: "single" | "lineage";
  direction?: "ancestors" | "descendants";
};

// Deliberately excludes photoUrl/media (files live under the source tree's
// upload directory — cross-tree file copying is out of scope) and
// gedcomXref (that's an identity within the source tree, not a fact worth
// carrying over).
const INDIVIDUAL_COPY_FIELDS = [
  "givenNames",
  "surname1",
  "surname2",
  "surname1BirthName",
  "alias",
  "sex",
  "birthDateText",
  "birthDateValue",
  "birthDatePrecision",
  "birthPlace",
  "deathDateText",
  "deathDateValue",
  "deathDatePrecision",
  "deathPlace",
  "notes",
  "biography",
] as const satisfies readonly (keyof Individual)[];

function pickCopyFields(individual: Individual) {
  const picked = {} as Pick<Individual, (typeof INDIVIDUAL_COPY_FIELDS)[number]>;
  for (const field of INDIVIDUAL_COPY_FIELDS) {
    (picked as Record<string, unknown>)[field] = individual[field];
  }
  return picked;
}

// Spans two trees at once (source + destination), so this lives outside the
// /trees/:treeId nested plugin — it does its own dual-membership check
// instead of relying on that plugin's single-tree preHandler.
export default async function copyRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);

  fastify.post("/:id/copy", { schema: { body: copyBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { destTreeId, mode, direction } = request.body as CopyBody;
    const userId = request.userId!;

    const source = await prisma.individual.findFirst({ where: { id, deletedAt: null } });
    if (!source) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    // Reading the source only requires membership (any role); writing into
    // the destination requires editor-or-better, same rule the tree-scoped
    // plugin enforces for a single tree.
    const sourceMembership = await prisma.treeMember.findUnique({
      where: { treeId_userId: { treeId: source.treeId, userId } },
    });
    if (!sourceMembership) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    const destMembership = await prisma.treeMember.findUnique({
      where: { treeId_userId: { treeId: destTreeId, userId } },
    });
    if (!destMembership) {
      return reply.code(404).send({ error: `No existe el árbol ${destTreeId}` });
    }
    if (destMembership.role === "VIEWER") {
      return reply.code(403).send({ error: "No tienes permiso de edición en el árbol de destino" });
    }

    if (mode === "single") {
      const created = await prisma.individual.create({
        data: {
          ...pickCopyFields(source),
          treeId: destTreeId,
          originIndividualId: source.id,
        },
      });
      await logChange({
        treeId: destTreeId,
        userId,
        action: "individual.copy",
        entityType: "Individual",
        entityId: created.id,
        summary: `${created.givenNames} ${created.surname1}`,
      });
      return reply.code(201).send({ individuals: 1, families: 0 });
    }

    // mode === "lineage" — walks the exact same rels.parents/rels.children
    // graph the PDF report and GEDCOM partial-export already use, so "copy
    // ancestors/descendants" can never disagree with what those show.
    if (!direction) {
      return reply.code(400).send({ error: "direction es obligatorio para mode = lineage" });
    }

    const { people } = await buildTreeData(source.treeId);
    if (!people.some((p) => p.id === id)) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }
    const walked = walkGraph(people, id, direction === "ancestors" ? "up" : "down");
    const copyIds = [...expandWithSpouses([id, ...walked.keys()], people)];

    const sourceIndividuals = await prisma.individual.findMany({
      where: { id: { in: copyIds }, deletedAt: null },
    });
    const copyIdSet = new Set(sourceIndividuals.map((i) => i.id));

    const rawFamilies = await prisma.family.findMany({
      where: { treeId: source.treeId },
      include: { children: true },
    });
    // Only copy families fully inside the copied set — otherwise a partial
    // (ancestors/descendants-only) copy could reference a HUSB/WIFE
    // individual it never brings along, same reasoning as the GEDCOM
    // partial-export filter.
    const families = rawFamilies
      .filter((f) => f.partner1Id || f.partner2Id)
      .filter((f) => (!f.partner1Id || copyIdSet.has(f.partner1Id)) && (!f.partner2Id || copyIdSet.has(f.partner2Id)))
      .map((f) => ({
        ...f,
        childLinks: f.children
          .filter((c) => copyIdSet.has(c.individualId))
          .map((c) => ({ individualId: c.individualId, relationType: c.relationType })),
      }));

    const result = await prisma.$transaction(
      async (tx) => {
        const idMap = new Map<string, string>();
        for (const individual of sourceIndividuals) {
          const created = await tx.individual.create({
            data: {
              ...pickCopyFields(individual),
              treeId: destTreeId,
              originIndividualId: individual.id,
            },
          });
          idMap.set(individual.id, created.id);
        }

        let familiesWritten = 0;
        for (const family of families) {
          const newPartner1Id = family.partner1Id ? (idMap.get(family.partner1Id) ?? null) : null;
          const newPartner2Id = family.partner2Id ? (idMap.get(family.partner2Id) ?? null) : null;

          const createdFamily = await tx.family.create({
            data: {
              treeId: destTreeId,
              partner1Id: newPartner1Id,
              partner2Id: newPartner2Id,
              unionType: family.unionType,
              unionStatus: family.unionStatus,
              unionDateText: family.unionDateText,
              unionDateValue: family.unionDateValue,
              unionDatePrecision: family.unionDatePrecision,
              unionPlace: family.unionPlace,
              notes: family.notes,
            },
          });
          familiesWritten++;

          for (const link of family.childLinks) {
            const newChildId = idMap.get(link.individualId);
            if (!newChildId) continue;
            await tx.familyChild.create({
              data: { familyId: createdFamily.id, individualId: newChildId, relationType: link.relationType },
            });
          }
        }

        return { individuals: idMap.size, families: familiesWritten };
      },
      { timeout: 30_000 },
    );

    await logChange({
      treeId: destTreeId,
      userId,
      action: "individual.copyLineage",
      entityType: "Individual",
      entityId: id,
      summary: `${result.individuals} individuos, ${result.families} familias copiadas`,
    });

    return reply.code(201).send(result);
  });
}
