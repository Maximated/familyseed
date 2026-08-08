import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export default async function treeRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    const individuals = await prisma.individual.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        childOf: { include: { family: true } },
        familiesAsPartner1: { include: { children: true } },
        familiesAsPartner2: { include: { children: true } },
      },
    });

    return individuals.map((individual) => {
      const parents = new Set<string>();
      for (const familyChild of individual.childOf) {
        if (familyChild.family.partner1Id) parents.add(familyChild.family.partner1Id);
        if (familyChild.family.partner2Id) parents.add(familyChild.family.partner2Id);
      }

      const spouses = new Set<string>();
      const children = new Set<string>();
      for (const family of individual.familiesAsPartner1) {
        if (family.partner2Id) spouses.add(family.partner2Id);
        for (const child of family.children) children.add(child.individualId);
      }
      for (const family of individual.familiesAsPartner2) {
        if (family.partner1Id) spouses.add(family.partner1Id);
        for (const child of family.children) children.add(child.individualId);
      }

      return {
        id: individual.id,
        data: {
          "first name": individual.givenNames,
          "last name": individual.surname,
          "birth name": individual.birthSurname ?? undefined,
          gender: individual.sex === "FEMALE" ? "F" : individual.sex === "MALE" ? "M" : undefined,
          birthday: individual.birthDateText ?? undefined,
          deathday: individual.deathDateText ?? undefined,
          "birth place": individual.birthPlace ?? undefined,
          "death place": individual.deathPlace ?? undefined,
          avatar: individual.photoUrl ?? undefined,
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
