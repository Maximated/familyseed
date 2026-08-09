import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export default async function treeRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    const individuals = await prisma.individual.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        childOf: { include: { family: true } },
        familiesAsPartner1: { include: { children: true } },
        familiesAsPartner2: { include: { children: true } },
        lineages: { select: { lineageId: true } },
      },
    });

    // Families/family_children rows are never touched when an individual is
    // soft-deleted, so a reference (parent/spouse/child id) can still point
    // at someone who's now in the trash — drop those instead of rendering a
    // card family-chart has no data for.
    const activeIds = new Set(individuals.map((i) => i.id));

    return individuals.map((individual) => {
      const parents = new Set<string>();
      for (const familyChild of individual.childOf) {
        if (familyChild.family.partner1Id && activeIds.has(familyChild.family.partner1Id)) {
          parents.add(familyChild.family.partner1Id);
        }
        if (familyChild.family.partner2Id && activeIds.has(familyChild.family.partner2Id)) {
          parents.add(familyChild.family.partner2Id);
        }
      }

      const spouses = new Set<string>();
      const children = new Set<string>();
      for (const family of individual.familiesAsPartner1) {
        if (family.partner2Id && activeIds.has(family.partner2Id)) spouses.add(family.partner2Id);
        for (const child of family.children) {
          if (activeIds.has(child.individualId)) children.add(child.individualId);
        }
      }
      for (const family of individual.familiesAsPartner2) {
        if (family.partner1Id && activeIds.has(family.partner1Id)) spouses.add(family.partner1Id);
        for (const child of family.children) {
          if (activeIds.has(child.individualId)) children.add(child.individualId);
        }
      }

      const lastName = [individual.surname1, individual.surname2].filter(Boolean).join(" ");

      return {
        id: individual.id,
        data: {
          "first name": individual.givenNames,
          "last name": lastName,
          "birth name": individual.surname1BirthName ?? undefined,
          gender: individual.sex === "FEMALE" ? "F" : individual.sex === "MALE" ? "M" : undefined,
          birthday: individual.birthDateText ?? undefined,
          deathday: individual.deathDateText ?? undefined,
          "birth place": individual.birthPlace ?? undefined,
          "death place": individual.deathPlace ?? undefined,
          avatar: individual.photoUrl ?? undefined,
          // Used by the frontend's timeline navigation (bucket individuals by
          // era) and lineage highlight chips — purely navigational, not part
          // of the genealogical data itself.
          birthYear: individual.birthDateValue ? individual.birthDateValue.getUTCFullYear() : undefined,
          deathYear: individual.deathDateValue ? individual.deathDateValue.getUTCFullYear() : undefined,
          lineageIds: individual.lineages.map((l) => l.lineageId),
        },
        rels: {
          parents: [...parents],
          spouses: [...spouses],
          children: [...children],
        },
      };
    });
  });
}
