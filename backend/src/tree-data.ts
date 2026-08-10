import { prisma } from "./db.js";

export type TreePerson = {
  id: string;
  data: {
    "first name": string;
    "last name": string;
    "birth name"?: string;
    alias?: string;
    gender?: string;
    birthday?: string;
    deathday?: string;
    "birth place"?: string;
    "death place"?: string;
    birthPrecision?: string;
    deathPrecision?: string;
    notes?: string;
    biography?: string;
    avatar?: string;
    birthYear?: number;
    deathYear?: number;
    lineageIds: string[];
  };
  rels: {
    parents: string[];
    spouses: string[];
    children: string[];
  };
};

export type TreeUnion = {
  id: string;
  partner1Id: string;
  partner2Id: string;
  unionType: string;
  unionStatus: string;
  unionDateText: string | null;
  unionPlace: string | null;
  notes: string | null;
  order: number;
};

// The single source of truth for "the family graph" — GET /tree hands this
// straight to family-chart for rendering/navigation (rels.parents/children
// is what it walks when a card is clicked), and the PDF report reuses the
// exact same rels to walk ancestors/descendants, instead of running a
// separate SQL traversal that could drift from what the tree UI shows.
export async function buildTreeData(treeId: string): Promise<{ people: TreePerson[]; unions: TreeUnion[] }> {
  const individuals = await prisma.individual.findMany({
    where: { treeId, deletedAt: null },
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

  // Chronological union order per individual (nulls-dated unions sort
  // last, in creation order) — this is how we know a union is somebody's
  // "2nd marriage" etc. without storing that redundantly on the Family
  // row itself.
  const unionOrderByIndividual = new Map<string, string[]>();
  for (const individual of individuals) {
    const unions = [...individual.familiesAsPartner1, ...individual.familiesAsPartner2]
      .filter((f) => f.partner1Id && f.partner2Id && activeIds.has(f.partner1Id) && activeIds.has(f.partner2Id))
      .sort((a, b) => {
        if (a.unionDateValue && b.unionDateValue) return a.unionDateValue.getTime() - b.unionDateValue.getTime();
        if (a.unionDateValue) return -1;
        if (b.unionDateValue) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    unionOrderByIndividual.set(
      individual.id,
      unions.map((f) => f.id),
    );
  }

  function orderOf(individualId: string, familyId: string): number {
    const list = unionOrderByIndividual.get(individualId) ?? [];
    return list.indexOf(familyId) + 1;
  }

  const unionsById = new Map<string, TreeUnion>();

  for (const individual of individuals) {
    for (const family of [...individual.familiesAsPartner1, ...individual.familiesAsPartner2]) {
      if (unionsById.has(family.id)) continue;
      if (!family.partner1Id || !family.partner2Id) continue;
      if (!activeIds.has(family.partner1Id) || !activeIds.has(family.partner2Id)) continue;

      unionsById.set(family.id, {
        id: family.id,
        partner1Id: family.partner1Id,
        partner2Id: family.partner2Id,
        unionType: family.unionType,
        unionStatus: family.unionStatus,
        unionDateText: family.unionDateText,
        unionPlace: family.unionPlace,
        notes: family.notes,
        order: Math.max(orderOf(family.partner1Id, family.id), orderOf(family.partner2Id, family.id)),
      });
    }
  }

  const people: TreePerson[] = individuals.map((individual) => {
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
        "birth name": individual.surname1BirthName ? `(${individual.surname1BirthName})` : undefined,
        alias: individual.alias ?? undefined,
        gender: individual.sex === "FEMALE" ? "F" : individual.sex === "MALE" ? "M" : undefined,
        birthday: individual.birthDateText ?? undefined,
        deathday: individual.deathDateText ?? undefined,
        "birth place": individual.birthPlace ?? undefined,
        "death place": individual.deathPlace ?? undefined,
        birthPrecision: individual.birthDatePrecision ?? undefined,
        deathPrecision: individual.deathDatePrecision ?? undefined,
        notes: individual.notes ?? undefined,
        biography: individual.biography ?? undefined,
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

  return { people, unions: [...unionsById.values()] };
}

// Walks the same rels.parents/rels.children graph the tree UI navigates by
// clicking a card — going up collects ancestors generation by generation,
// going down collects descendants the same way. `generation` is negative
// going up (-1 = parents, -2 = grandparents, ...) and positive going down.
export function walkGraph(
  people: TreePerson[],
  rootId: string,
  direction: "up" | "down",
): Map<string, { person: TreePerson; generation: number }> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const visited = new Map<string, { person: TreePerson; generation: number }>();
  let frontier = [rootId];
  let generation = 0;

  while (frontier.length > 0) {
    generation += direction === "up" ? -1 : 1;
    const next: string[] = [];
    for (const id of frontier) {
      const person = byId.get(id);
      if (!person) continue;
      const relIds = direction === "up" ? person.rels.parents : person.rels.children;
      for (const relId of relIds) {
        if (visited.has(relId) || relId === rootId) continue;
        const relPerson = byId.get(relId);
        if (!relPerson) continue;
        visited.set(relId, { person: relPerson, generation });
        next.push(relId);
      }
    }
    frontier = next;
  }

  return visited;
}
