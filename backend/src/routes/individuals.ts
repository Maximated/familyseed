import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import {
  CHILD_RELATION_TYPE_VALUES,
  DATE_PRECISION_VALUES,
  SEX_VALUES,
  UNION_STATUS_VALUES,
  UNION_TYPE_VALUES,
} from "../enums.js";

const individualFieldsSchema = {
  type: "object",
  required: ["givenNames", "surname1"],
  properties: {
    givenNames: { type: "string", minLength: 1 },
    surname1: { type: "string", minLength: 1 },
    surname2: { type: "string" },
    surname1BirthName: { type: "string" },
    alias: { type: "string" },
    sex: { type: "string", enum: SEX_VALUES },
    birthDateText: { type: "string" },
    birthDateValue: { type: "string", format: "date" },
    birthDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    birthPlace: { type: "string" },
    deathDateText: { type: "string" },
    deathDateValue: { type: "string", format: "date" },
    deathDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    deathPlace: { type: "string" },
    notes: { type: "string" },
    biography: { type: "string" },
    photoUrl: { type: "string" },
  },
  additionalProperties: false,
};

const relationshipSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["CHILD", "CHILD_OF_PARENTS", "PARTNER"] },
    familyId: { type: "string" },
    parent1Id: { type: "string" },
    parent2Id: { type: "string" },
    partnerId: { type: "string" },
    relationType: { type: "string", enum: CHILD_RELATION_TYPE_VALUES },
    unionType: { type: "string", enum: UNION_TYPE_VALUES },
    unionStatus: { type: "string", enum: UNION_STATUS_VALUES },
    unionDateText: { type: "string" },
    unionDateValue: { type: "string", format: "date" },
    unionDatePrecision: { type: "string", enum: DATE_PRECISION_VALUES },
    unionPlace: { type: "string" },
  },
  additionalProperties: false,
};

const createIndividualBodySchema = {
  type: "object",
  required: ["individual"],
  properties: {
    individual: individualFieldsSchema,
    relationship: relationshipSchema,
  },
  additionalProperties: false,
};

const updateIndividualBodySchema = {
  ...individualFieldsSchema,
  required: [],
};

type CreateIndividualBody = {
  individual: {
    givenNames: string;
    surname1: string;
    surname2?: string;
    surname1BirthName?: string;
    alias?: string;
    sex?: (typeof SEX_VALUES)[number];
    birthDateText?: string;
    birthDateValue?: string;
    birthDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
    birthPlace?: string;
    deathDateText?: string;
    deathDateValue?: string;
    deathDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
    deathPlace?: string;
    notes?: string;
    biography?: string;
    photoUrl?: string;
  };
  relationship?: {
    kind: "CHILD" | "CHILD_OF_PARENTS" | "PARTNER";
    familyId?: string;
    parent1Id?: string;
    parent2Id?: string;
    partnerId?: string;
    relationType?: (typeof CHILD_RELATION_TYPE_VALUES)[number];
    unionType?: (typeof UNION_TYPE_VALUES)[number];
    unionStatus?: (typeof UNION_STATUS_VALUES)[number];
    unionDateText?: string;
    unionDateValue?: string;
    unionDatePrecision?: (typeof DATE_PRECISION_VALUES)[number];
    unionPlace?: string;
  };
};

type UpdateIndividualBody = Partial<CreateIndividualBody["individual"]>;

// Soft-deleted individuals (deletedAt set) never show up in the tree or its
// relatives — they can still be referenced by families/family_children (we
// never sever those on delete, see DELETE /:id below), so every place that
// surfaces a *related* individual has to re-check this too, not just the
// top-level query.
function isActive<T extends { deletedAt: Date | null }>(person: T | null | undefined): person is T {
  return !!person && person.deletedAt === null;
}

export default async function individualRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { search, trashed } = request.query as { search?: string; trashed?: string };

    return prisma.individual.findMany({
      where: {
        deletedAt: trashed === "true" ? { not: null } : null,
        ...(search
          ? {
              OR: [
                { givenNames: { contains: search } },
                { surname1: { contains: search } },
                { surname2: { contains: search } },
                { surname1BirthName: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ surname1: "asc" }, { givenNames: "asc" }],
    });
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const individual = await prisma.individual.findUnique({
      where: { id },
      include: {
        childOf: {
          include: {
            family: {
              include: {
                partner1: true,
                partner2: true,
                children: { include: { individual: true } },
              },
            },
          },
        },
        familiesAsPartner1: {
          include: { partner2: true, children: { include: { individual: true } } },
        },
        familiesAsPartner2: {
          include: { partner1: true, children: { include: { individual: true } } },
        },
      },
    });

    if (!isActive(individual)) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    const parents = [];
    const siblings = new Map<string, unknown>();

    for (const familyChild of individual.childOf) {
      const { family } = familyChild;
      if (isActive(family.partner1)) {
        parents.push({ ...family.partner1, relationType: familyChild.relationType, familyId: family.id });
      }
      if (isActive(family.partner2)) {
        parents.push({ ...family.partner2, relationType: familyChild.relationType, familyId: family.id });
      }
      for (const sibling of family.children) {
        if (sibling.individualId !== id && isActive(sibling.individual)) {
          siblings.set(sibling.individualId, {
            ...sibling.individual,
            relationType: sibling.relationType,
            familyId: family.id,
          });
        }
      }
    }

    const partnerships = [];
    const children = new Map<string, unknown>();

    for (const family of individual.familiesAsPartner1) {
      if (family.partner2 && !isActive(family.partner2)) continue;
      partnerships.push({
        familyId: family.id,
        partner: family.partner2,
        unionType: family.unionType,
        unionDateText: family.unionDateText,
        unionPlace: family.unionPlace,
      });
      for (const child of family.children) {
        if (!isActive(child.individual)) continue;
        children.set(child.individualId, { ...child.individual, relationType: child.relationType, familyId: family.id });
      }
    }

    for (const family of individual.familiesAsPartner2) {
      if (family.partner1 && !isActive(family.partner1)) continue;
      partnerships.push({
        familyId: family.id,
        partner: family.partner1,
        unionType: family.unionType,
        unionDateText: family.unionDateText,
        unionPlace: family.unionPlace,
      });
      for (const child of family.children) {
        if (!isActive(child.individual)) continue;
        children.set(child.individualId, { ...child.individual, relationType: child.relationType, familyId: family.id });
      }
    }

    const { childOf, familiesAsPartner1, familiesAsPartner2, ...individualData } = individual;

    return {
      individual: individualData,
      parents,
      siblings: [...siblings.values()],
      partnerships,
      children: [...children.values()],
    };
  });

  fastify.post("/", { schema: { body: createIndividualBodySchema } }, async (request, reply) => {
    const { individual, relationship } = request.body as CreateIndividualBody;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.individual.create({
          data: {
            ...individual,
            birthDateValue: individual.birthDateValue ? new Date(individual.birthDateValue) : undefined,
            deathDateValue: individual.deathDateValue ? new Date(individual.deathDateValue) : undefined,
          },
        });

        let family = null;

        if (relationship) {
          switch (relationship.kind) {
            case "CHILD": {
              if (!relationship.familyId) {
                throw new HttpError(400, "familyId es obligatorio para relationship.kind = CHILD");
              }
              const existingFamily = await tx.family.findUnique({ where: { id: relationship.familyId } });
              if (!existingFamily) {
                throw new HttpError(404, `No existe la familia ${relationship.familyId}`);
              }
              await tx.familyChild.create({
                data: {
                  familyId: existingFamily.id,
                  individualId: created.id,
                  relationType: relationship.relationType ?? "BIOLOGICAL",
                },
              });
              family = existingFamily;
              break;
            }

            case "CHILD_OF_PARENTS": {
              if (!relationship.parent1Id) {
                throw new HttpError(400, "parent1Id es obligatorio para relationship.kind = CHILD_OF_PARENTS");
              }
              const parent1 = await tx.individual.findFirst({
                where: { id: relationship.parent1Id, deletedAt: null },
              });
              if (!parent1) {
                throw new HttpError(404, `No existe el individuo ${relationship.parent1Id}`);
              }

              let parent2 = null;
              if (relationship.parent2Id) {
                parent2 = await tx.individual.findFirst({
                  where: { id: relationship.parent2Id, deletedAt: null },
                });
                if (!parent2) {
                  throw new HttpError(404, `No existe el individuo ${relationship.parent2Id}`);
                }
              }

              family = await tx.family.findFirst({
                where: parent2
                  ? {
                      OR: [
                        { partner1Id: parent1.id, partner2Id: parent2.id },
                        { partner1Id: parent2.id, partner2Id: parent1.id },
                      ],
                    }
                  : { partner1Id: parent1.id, partner2Id: null },
              });

              if (!family) {
                family = await tx.family.create({
                  data: { partner1Id: parent1.id, partner2Id: parent2?.id ?? null, unionType: "UNKNOWN" },
                });
              }

              await tx.familyChild.create({
                data: {
                  familyId: family.id,
                  individualId: created.id,
                  relationType: relationship.relationType ?? "BIOLOGICAL",
                },
              });
              break;
            }

            case "PARTNER": {
              if (!relationship.partnerId) {
                throw new HttpError(400, "partnerId es obligatorio para relationship.kind = PARTNER");
              }
              const partner = await tx.individual.findFirst({
                where: { id: relationship.partnerId, deletedAt: null },
              });
              if (!partner) {
                throw new HttpError(404, `No existe el individuo ${relationship.partnerId}`);
              }

              family = await tx.family.create({
                data: {
                  partner1Id: partner.id,
                  partner2Id: created.id,
                  unionType: relationship.unionType ?? "UNKNOWN",
                  unionStatus: relationship.unionStatus ?? "ONGOING",
                  unionDateText: relationship.unionDateText,
                  unionDateValue: relationship.unionDateValue ? new Date(relationship.unionDateValue) : undefined,
                  unionDatePrecision: relationship.unionDatePrecision,
                  unionPlace: relationship.unionPlace,
                },
              });
              break;
            }

            default:
              throw new HttpError(400, `relationship.kind desconocido: ${(relationship as { kind: string }).kind}`);
          }
        }

        return { individual: created, family };
      });

      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });

  fastify.patch("/:id", { schema: { body: updateIndividualBodySchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as UpdateIndividualBody;

    const existing = await prisma.individual.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    const updated = await prisma.individual.update({
      where: { id },
      data: {
        ...updates,
        birthDateValue: updates.birthDateValue ? new Date(updates.birthDateValue) : undefined,
        deathDateValue: updates.deathDateValue ? new Date(updates.deathDateValue) : undefined,
      },
    });

    return updated;
  });

  // Soft delete: never touches families/family_children, so spouses and
  // children keep their links intact — this person just stops showing up
  // (see isActive/activeIds above) until restored or purged for good.
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.individual.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }

    await prisma.individual.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.code(204).send();
  });

  fastify.post("/:id/restore", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.individual.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: `No existe el individuo ${id}` });
    }
    if (existing.deletedAt === null) {
      return reply.code(400).send({ error: "Este individuo no está en la papelera" });
    }

    const restored = await prisma.individual.update({ where: { id }, data: { deletedAt: null } });
    return restored;
  });
}
