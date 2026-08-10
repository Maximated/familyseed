import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { DATE_PRECISION_VALUES, UNION_STATUS_VALUES, UNION_TYPE_VALUES } from "../enums.js";
import { getDefaultTreeId, logChange } from "../tree-context.js";

const createFamilyBodySchema = {
  type: "object",
  required: ["partner1Id"],
  properties: {
    partner1Id: { type: "string" },
    partner2Id: { type: "string" },
    unionType: { type: "string", enum: UNION_TYPE_VALUES },
    unionStatus: { type: "string", enum: UNION_STATUS_VALUES },
    unionDateText: { type: "string" },
    unionDateValue: { type: "string", format: "date" },
    unionDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    unionPlace: { type: "string" },
    childrenIds: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

type CreateFamilyBody = {
  partner1Id: string;
  partner2Id?: string;
  unionType?: (typeof UNION_TYPE_VALUES)[number];
  unionStatus?: (typeof UNION_STATUS_VALUES)[number];
  unionDateText?: string;
  unionDateValue?: string;
  unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
  unionPlace?: string;
  childrenIds?: string[];
};

const updateFamilyBodySchema = {
  type: "object",
  properties: {
    unionType: { type: "string", enum: UNION_TYPE_VALUES },
    unionStatus: { type: "string", enum: UNION_STATUS_VALUES },
    unionDateText: { type: "string" },
    unionDateValue: { type: "string", format: "date" },
    unionDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    unionPlace: { type: "string" },
    notes: { type: "string" },
  },
  additionalProperties: false,
};

type UpdateFamilyBody = {
  unionType?: (typeof UNION_TYPE_VALUES)[number];
  unionStatus?: (typeof UNION_STATUS_VALUES)[number];
  unionDateText?: string;
  unionDateValue?: string;
  unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
  unionPlace?: string;
  notes?: string;
};

export default async function familyRoutes(fastify: FastifyInstance) {
  fastify.post("/", { schema: { body: createFamilyBodySchema } }, async (request, reply) => {
    const {
      partner1Id,
      partner2Id,
      unionType,
      unionStatus,
      unionDateText,
      unionDateValue,
      unionDatePrecision,
      unionPlace,
      childrenIds,
    } = request.body as CreateFamilyBody;

    try {
      const treeId = await getDefaultTreeId();

      const family = await prisma.$transaction(async (tx) => {
        const partner1 = await tx.individual.findFirst({ where: { id: partner1Id, treeId } });
        if (!partner1) {
          throw new HttpError(404, `No existe el individuo ${partner1Id}`);
        }

        if (partner2Id) {
          const partner2 = await tx.individual.findFirst({ where: { id: partner2Id, treeId } });
          if (!partner2) {
            throw new HttpError(404, `No existe el individuo ${partner2Id}`);
          }
        }

        const created = await tx.family.create({
          data: {
            treeId,
            partner1Id,
            partner2Id: partner2Id ?? null,
            unionType: unionType ?? "UNKNOWN",
            unionStatus: unionStatus ?? "ONGOING",
            unionDateText,
            unionDateValue: unionDateValue ? new Date(unionDateValue) : undefined,
            unionDatePrecision,
            unionPlace,
          },
        });

        if (childrenIds?.length) {
          for (const childId of childrenIds) {
            const child = await tx.individual.findFirst({ where: { id: childId, treeId } });
            if (!child) {
              throw new HttpError(404, `No existe el individuo ${childId}`);
            }
            await tx.familyChild.create({
              data: { familyId: created.id, individualId: childId, relationType: "BIOLOGICAL" },
            });
          }
        }

        return created;
      });

      await logChange({ action: "family.create", entityType: "Family", entityId: family.id });

      return reply.code(201).send(family);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });

  fastify.patch("/:id", { schema: { body: updateFamilyBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as UpdateFamilyBody;
    const treeId = await getDefaultTreeId();

    const existing = await prisma.family.findFirst({ where: { id, treeId } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe la familia ${id}` });
    }

    const updated = await prisma.family.update({
      where: { id },
      data: {
        ...updates,
        unionDateValue: updates.unionDateValue ? new Date(updates.unionDateValue) : undefined,
      },
    });

    await logChange({ action: "family.update", entityType: "Family", entityId: updated.id });

    return updated;
  });
}
