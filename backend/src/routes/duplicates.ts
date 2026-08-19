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

const resolveFamilyBodySchema = {
  type: "object",
  required: ["familyId", "childId"],
  properties: {
    familyId: { type: "string" },
    childId: { type: "string" },
  },
  additionalProperties: false,
};

type ResolveFamilyBody = { familyId: string; childId: string };

// Removes one child's redundant link to a single-parent "ghost" family that
// duplicates a link they already have to a real family with the same known
// parent — see the GET .../family-suggestions handler below for how these
// are detected. Deletes the ghost family too once it has no children left,
// but only if it carries no date/place/notes of its own worth keeping.
async function resolveFamilyDuplicate(treeId: string, familyId: string, childId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const link = await tx.familyChild.findFirst({
      where: { familyId, individualId: childId, family: { treeId } },
    });
    if (!link) throw new HttpError(404, "No existe ese vínculo");

    await tx.familyChild.delete({ where: { id: link.id } });

    const remaining = await tx.familyChild.count({ where: { familyId } });
    if (remaining > 0) return;

    const family = await tx.family.findUnique({ where: { id: familyId } });
    if (family && !family.unionDateText && !family.unionPlace && !family.notes) {
      await tx.family.delete({ where: { id: familyId } });
    }
  });
}

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

        // A repeated surname within one family tree (common with Polish
        // village/family naming patterns) means same-given-name +
        // same-surname alone flags plenty of pairs who are actually
        // different people — birth year and birth/maiden name are the two
        // signals a genealogy record actually has to tell them apart, so
        // a clear mismatch on either rules the pair out entirely instead
        // of just downgrading it to "possible" noise.
        const yearGap =
          a.birthDateValue && b.birthDateValue
            ? Math.abs(a.birthDateValue.getUTCFullYear() - b.birthDateValue.getUTCFullYear())
            : null;
        if (yearGap !== null && yearGap > 2) continue;

        const aBirthName = a.surname1BirthName ? normalizeName(a.surname1BirthName) : null;
        const bBirthName = b.surname1BirthName ? normalizeName(b.surname1BirthName) : null;
        if (aBirthName && bBirthName && aBirthName !== bBirthName) continue;

        const sameBirthYear = yearGap === 0;
        const sameBirthName = !!aBirthName && !!bBirthName && aBirthName === bBirthName;

        suggestions.push({ aId: a.id, bId: b.id, confidence: sameBirthYear || sameBirthName ? "high" : "possible" });
      }
    }

    return suggestions;
  });

  // A different kind of duplicate than the person-merge feature above: a
  // "ghost" single-parent Family row left over from an import/edit that
  // never got consolidated — the same child already has a proper link to
  // another Family where the same person is a partner. attachParent()
  // prevents new ones of these going forward (see its comment), but never
  // retroactively cleans up rows that predate that guard, so this scans for
  // them directly instead.
  fastify.get("/family-suggestions", async (request) => {
    const treeId = request.treeId!;
    const families = await prisma.family.findMany({
      where: { treeId },
      include: { children: true },
    });

    const familiesByParent = new Map<string, typeof families>();
    for (const family of families) {
      for (const parentId of [family.partner1Id, family.partner2Id]) {
        if (!parentId) continue;
        const list = familiesByParent.get(parentId) ?? [];
        list.push(family);
        familiesByParent.set(parentId, list);
      }
    }

    const suggestions: Array<{ familyId: string; keepFamilyId: string; parentId: string; childId: string }> = [];
    for (const family of families) {
      const knownParentId = family.partner1Id && family.partner2Id ? null : (family.partner1Id ?? family.partner2Id);
      if (!knownParentId) continue;

      for (const link of family.children) {
        const other = (familiesByParent.get(knownParentId) ?? []).find(
          (f) => f.id !== family.id && f.children.some((c) => c.individualId === link.individualId),
        );
        if (other) {
          suggestions.push({ familyId: family.id, keepFamilyId: other.id, parentId: knownParentId, childId: link.individualId });
        }
      }
    }

    if (suggestions.length === 0) return [];

    const individuals = await prisma.individual.findMany({
      where: { treeId, deletedAt: null, id: { in: [...new Set(suggestions.flatMap((s) => [s.parentId, s.childId]))] } },
    });
    const labelById = new Map(individuals.map((i) => [i.id, personLabel(i)]));

    return suggestions
      .filter((s) => labelById.has(s.parentId) && labelById.has(s.childId))
      .map((s) => ({ ...s, parentName: labelById.get(s.parentId)!, childName: labelById.get(s.childId)! }));
  });

  fastify.post("/family-resolve", { schema: { body: resolveFamilyBodySchema } }, async (request, reply) => {
    const treeId = request.treeId!;
    const { familyId, childId } = request.body as ResolveFamilyBody;
    try {
      await resolveFamilyDuplicate(treeId, familyId, childId);
      await logChange({
        treeId,
        userId: request.userId ?? null,
        action: "family.dedupe",
        entityType: "Family",
        entityId: familyId,
        summary: "Eliminado vínculo duplicado a familia de un solo progenitor",
      });
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
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
