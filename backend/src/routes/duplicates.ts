import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { HttpError } from "../http-error.js";
import { logChange } from "../tree-context.js";
import { individualFieldsSchema, deriveLineagesFromSurnames, type IndividualFieldsInput } from "./individuals.js";

// Case/accent-insensitive so "José" and "Jose", or "MAKSYM" and "Maksym",
// still match — the kind of variation a human typing the same name twice
// produces naturally, not a typo that should hide a real duplicate.
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function personLabel(individual: { givenNames: string; surname1: string }): string {
  return `${individual.givenNames} ${individual.surname1}`;
}

const mergeBodySchema = {
  type: "object",
  required: ["keepId", "mergeId", "individual"],
  properties: {
    keepId: { type: "string" },
    mergeId: { type: "string" },
    individual: individualFieldsSchema,
  },
  additionalProperties: false,
};

type MergeBody = {
  keepId: string;
  mergeId: string;
  individual: IndividualFieldsInput;
};

export default async function duplicateRoutes(fastify: FastifyInstance) {
  // Automatic suggestions: same normalized given name + surname1 is the
  // core signal (this is exactly the shape of the real duplicate this
  // feature was built after — two rows for "Lech Janusz Zawada"). A
  // matching birth year on top raises it to "high" confidence; nothing
  // here is a hard match, so both tiers still need a human to confirm.
  fastify.get("/suggestions", async (request) => {
    const treeId = request.treeId!;
    const individuals = await prisma.individual.findMany({ where: { treeId, deletedAt: null } });

    const suggestions: Array<{ aId: string; bId: string; confidence: "high" | "possible" }> = [];
    for (let i = 0; i < individuals.length; i++) {
      for (let j = i + 1; j < individuals.length; j++) {
        const a = individuals[i];
        const b = individuals[j];
        if (normalizeName(a.givenNames) !== normalizeName(b.givenNames)) continue;
        if (normalizeName(a.surname1) !== normalizeName(b.surname1)) continue;

        const sameBirthYear =
          !!a.birthDateValue && !!b.birthDateValue && a.birthDateValue.getUTCFullYear() === b.birthDateValue.getUTCFullYear();

        suggestions.push({ aId: a.id, bId: b.id, confidence: sameBirthYear ? "high" : "possible" });
      }
    }

    return suggestions;
  });

  // Applies the caller-resolved field values to `keepId`, reassigns every
  // relation `mergeId` had (families, children, lineages, media, copy
  // provenance) onto `keepId`, and soft-deletes `mergeId` — never a hard
  // delete, so a bad merge is still recoverable by hand from the data even
  // though the trash-restore UI won't reconstruct the reassigned relations.
  fastify.post("/merge", { schema: { body: mergeBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    const { keepId, mergeId, individual } = request.body as MergeBody;

    try {
      if (keepId === mergeId) {
        throw new HttpError(400, "No se puede fusionar una persona consigo misma");
      }

      const [keep, merge] = await Promise.all([
        prisma.individual.findFirst({ where: { id: keepId, treeId, deletedAt: null } }),
        prisma.individual.findFirst({ where: { id: mergeId, treeId, deletedAt: null } }),
      ]);
      if (!keep) throw new HttpError(404, `No existe el individuo ${keepId}`);
      if (!merge) throw new HttpError(404, `No existe el individuo ${mergeId}`);

      await prisma.$transaction(async (tx) => {
        await tx.individual.update({
          where: { id: keepId },
          data: {
            ...individual,
            birthDateValue:
              individual.birthDateValue === undefined
                ? undefined
                : individual.birthDateValue
                  ? new Date(individual.birthDateValue)
                  : null,
            deathDateValue:
              individual.deathDateValue === undefined
                ? undefined
                : individual.deathDateValue
                  ? new Date(individual.deathDateValue)
                  : null,
          },
        });

        // Families where the merged-away person is partner1: reassign to
        // keepId, unless keepId is already the *other* partner there (the
        // two duplicates were "married" to each other) — that would leave
        // a family with the same person on both sides, so instead drop the
        // now-redundant slot and keep it as keepId's single-parent family,
        // preserving whatever children were attached.
        for (const family of await tx.family.findMany({ where: { partner1Id: mergeId } })) {
          await tx.family.update({
            where: { id: family.id },
            data: family.partner2Id === keepId ? { partner1Id: null } : { partner1Id: keepId },
          });
        }
        for (const family of await tx.family.findMany({ where: { partner2Id: mergeId } })) {
          await tx.family.update({
            where: { id: family.id },
            data: family.partner1Id === keepId ? { partner2Id: null } : { partner2Id: keepId },
          });
        }

        // Child links: reassign unless keepId is already listed as a child
        // of that same family (both duplicates were separately added as
        // the same couple's child), in which case the merged-away link is
        // just a redundant row to drop.
        for (const link of await tx.familyChild.findMany({ where: { individualId: mergeId } })) {
          const existing = await tx.familyChild.findFirst({ where: { familyId: link.familyId, individualId: keepId } });
          if (existing) {
            await tx.familyChild.delete({ where: { id: link.id } });
          } else {
            await tx.familyChild.update({ where: { id: link.id }, data: { individualId: keepId } });
          }
        }

        // Lineage memberships: same reassign-or-drop-if-redundant pattern.
        for (const link of await tx.individualLineage.findMany({ where: { individualId: mergeId } })) {
          const existing = await tx.individualLineage.findFirst({
            where: { individualId: keepId, lineageId: link.lineageId },
          });
          if (existing) {
            await tx.individualLineage.delete({ where: { id: link.id } });
          } else {
            await tx.individualLineage.update({ where: { id: link.id }, data: { individualId: keepId } });
          }
        }

        // Media has no per-person uniqueness constraint to worry about.
        await tx.personMedia.updateMany({ where: { individualId: mergeId }, data: { individualId: keepId } });

        // Anyone previously copied *from* the merged-away record should
        // still resolve their provenance, now via keepId.
        await tx.individual.updateMany({ where: { originIndividualId: mergeId }, data: { originIndividualId: keepId } });

        await tx.individual.update({ where: { id: mergeId }, data: { deletedAt: new Date() } });

        // Same "hasta que la muerte os separe" rule as a normal edit (see
        // individuals.ts) — the chosen death date might be new information
        // the merge just surfaced, so it still needs to close out any of
        // keepId's unions still marked ongoing.
        if (individual.deathDateValue) {
          await tx.family.updateMany({
            where: { treeId, unionStatus: "ONGOING", OR: [{ partner1Id: keepId }, { partner2Id: keepId }] },
            data: { unionStatus: "ENDED_BY_DEATH" },
          });
        }

        await deriveLineagesFromSurnames(tx, treeId, keepId, [individual.surname1, individual.surname1BirthName]);
      });

      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "individual.merge",
        entityType: "Individual",
        entityId: keepId,
        summary: `${personLabel(merge)} → ${personLabel(keep)}`,
      });

      return reply.send({ keepId });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
