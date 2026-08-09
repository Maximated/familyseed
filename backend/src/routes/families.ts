import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { DATE_PRECISION_VALUES, UNION_STATUS_VALUES, UNION_TYPE_VALUES } from "../enums.js";

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
      const family = await prisma.$transaction(async (tx) => {
        const partner1 = await tx.individual.findUnique({ where: { id: partner1Id } });
        if (!partner1) {
          throw new HttpError(404, `No existe el individuo ${partner1Id}`);
        }

        if (partner2Id) {
          const partner2 = await tx.individual.findUnique({ where: { id: partner2Id } });
          if (!partner2) {
            throw new HttpError(404, `No existe el individuo ${partner2Id}`);
          }
        }

        const created = await tx.family.create({
          data: {
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
            const child = await tx.individual.findUnique({ where: { id: childId } });
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

      return reply.code(201).send(family);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "Error interno" });
    }
  });
}
