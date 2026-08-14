import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { CHILD_RELATION_TYPE_VALUES, DATE_PRECISION_VALUES, UNION_STATUS_VALUES, UNION_TYPE_VALUES } from "../enums.js";
import { logChange } from "../tree-context.js";

const addFamilyChildBodySchema = {
  type: "object",
  required: ["individualId"],
  properties: {
    individualId: { type: "string" },
    relationType: { type: "string", enum: CHILD_RELATION_TYPE_VALUES },
  },
  additionalProperties: false,
};

type AddFamilyChildBody = {
  individualId: string;
  relationType?: (typeof CHILD_RELATION_TYPE_VALUES)[number];
};

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

// Nullable (not just omittable) for the same reason as individuals.ts's
// optionalNullableString: an omitted key means "leave this column alone"
// to Prisma, so clearing a field for real means sending `null`, not
// leaving it out of the request.
const optionalNullableString = { type: ["string", "null"] } as const;

const updateFamilyBodySchema = {
  type: "object",
  properties: {
    unionType: { type: "string", enum: UNION_TYPE_VALUES },
    unionStatus: { type: "string", enum: UNION_STATUS_VALUES },
    unionDateText: optionalNullableString,
    unionDateValue: { type: ["string", "null"], format: "date" },
    unionDatePrecision: { type: ["string", "null"], enum: [...DATE_PRECISION_VALUES, null] },
    unionPlace: optionalNullableString,
    notes: optionalNullableString,
  },
  additionalProperties: false,
};

type UpdateFamilyBody = {
  unionType?: (typeof UNION_TYPE_VALUES)[number];
  unionStatus?: (typeof UNION_STATUS_VALUES)[number];
  unionDateText?: string | null;
  unionDateValue?: string | null;
  unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number] | null;
  unionPlace?: string | null;
  notes?: string | null;
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
      const treeId = request.treeId!;

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

          // Nothing at the DB level stops two Family rows existing for the
          // exact same couple — guard here instead of silently creating a
          // duplicate union (order-independent, since partner1/partner2 are
          // just "which side" not a meaningful ranking).
          const existingCouple = await tx.family.findFirst({
            where: {
              treeId,
              OR: [
                { partner1Id, partner2Id },
                { partner1Id: partner2Id, partner2Id: partner1Id },
              ],
            },
          });
          if (existingCouple) {
            throw new HttpError(400, "Ya existe una unión entre estas dos personas");
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

      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "family.create",
        entityType: "Family",
        entityId: family.id,
      });

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
    const treeId = request.treeId!;

    const existing = await prisma.family.findFirst({ where: { id, treeId } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe la familia ${id}` });
    }

    const updated = await prisma.family.update({
      where: { id },
      data: {
        ...updates,
        unionDateValue:
          updates.unionDateValue === undefined ? undefined : updates.unionDateValue ? new Date(updates.unionDateValue) : null,
      },
    });

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "family.update",
      entityType: "Family",
      entityId: updated.id,
    });

    return updated;
  });

  // Permanently removes a union — no trash/undo for this (unlike
  // individuals), since a union is a relationship record rather than a
  // person: FamilyChild rows cascade-delete with it (schema-level
  // onDelete: Cascade), which unlinks any children from these two
  // partners specifically without touching the children's own Individual
  // rows or any other family they belong to.
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;

    const existing = await prisma.family.findFirst({ where: { id, treeId } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe la unión ${id}` });
    }

    await prisma.family.delete({ where: { id } });

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "family.delete",
      entityType: "Family",
      entityId: id,
    });

    return reply.code(204).send();
  });

  // Attaches an existing individual as a child of this specific union —
  // unlike POST /individuals/:id/parents (which links one parent at a time
  // and has to guess/merge which family a second parent belongs to), this
  // is unambiguous by construction: both partner1Id and partner2Id are
  // already fixed to this one Family row, so adding a child here links
  // them to both parents at once, with no separate step needed on the
  // other partner's own page.
  fastify.post("/:id/children", { schema: { body: addFamilyChildBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const treeId = request.treeId!;
    const { individualId, relationType } = request.body as AddFamilyChildBody;

    const family = await prisma.family.findFirst({ where: { id, treeId } });
    if (!family) {
      return reply.code(404).send({ error: `No existe la unión ${id}` });
    }
    if (individualId === family.partner1Id || individualId === family.partner2Id) {
      return reply.code(400).send({ error: "Una persona no puede ser su propio hijo/a" });
    }
    const child = await prisma.individual.findFirst({ where: { id: individualId, treeId, deletedAt: null } });
    if (!child) {
      return reply.code(404).send({ error: `No existe el individuo ${individualId}` });
    }

    await prisma.familyChild.upsert({
      where: { familyId_individualId: { familyId: id, individualId } },
      create: { familyId: id, individualId, relationType: relationType ?? "BIOLOGICAL" },
      update: {},
    });

    await logChange({
      treeId,
      userId: request.userId ?? null,
      action: "family.addChild",
      entityType: "Family",
      entityId: id,
      summary: `${child.givenNames} ${child.surname1}`,
    });

    return reply.code(204).send();
  });
}
