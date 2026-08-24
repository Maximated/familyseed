import { prisma } from "./db.js";
import { buildTreeData, walkGraph, type TreePerson } from "./tree-data.js";

export type GeneralStatistics = {
  sexCounts: { male: number; female: number; unknown: number; total: number };
  sexPercentages: { male: number; female: number; unknown: number };
  lineageCount: number;
  yearRange: { earliest: number; latest: number } | null;
  longestLived: { individualId: string; name: string; ageYears: number } | null;
  largestLineage: { lineageId: string; name: string; memberCount: number } | null;
  largestGeneration: { generation: number; count: number } | null;
  familyNucleiCount: number;
  incompleteData: { missingBirth: number; missingDeath: number; missingBoth: number };
  mostCommonBirthplace: { place: string; count: number } | null;
};

export type RelationshipResult =
  | { kind: "self" }
  | { kind: "direct-ancestor"; degree: number; labelEs: string }
  | { kind: "direct-descendant"; degree: number; labelEs: string }
  | { kind: "sibling"; half: boolean; labelEs: string }
  | { kind: "collateral"; cousinDegree: number; removal: number; labelEs: string }
  | { kind: "disconnected" };

export type PersonStatistics = {
  personId: string;
  ancestorGenerations: number;
  descendantGenerations: number;
  totalAncestors: number;
  totalDescendants: number;
  age: { years: number; exact: boolean; atDeath: boolean } | null;
  siblingsCount: number;
  childrenCount: number;
  unionsCount: number;
  parentsAgeAtBirth: { parentId: string; parentName: string; ageYears: number; exact: boolean }[];
  meNotSet: boolean;
  generationRelativeToMe: number | null;
  relationshipToMe: RelationshipResult | null;
};

function fullName(p: TreePerson): string {
  return `${p.data["first name"]} ${p.data["last name"]}`.trim();
}

// Whole years between two ISO instants (day-precision, not a bare year
// subtraction — Dec-born/Jan-died pairs would otherwise be off by one).
function ageInYears(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDay = (d: Date) => d.getUTCMonth() * 100 + d.getUTCDate();
  if (monthDay(to) < monthDay(from)) years -= 1;
  return years;
}

function sexOf(byId: Map<string, TreePerson>, id: string): "M" | "F" | "U" {
  const gender = byId.get(id)?.data.gender;
  return gender === "M" ? "M" : gender === "F" ? "F" : "U";
}

function gendered(male: string, female: string, neutral: string, sex: "M" | "F" | "U"): string {
  return sex === "M" ? male : sex === "F" ? female : neutral;
}

const ANCESTOR_LABELS: [string, string, string][] = [
  ["padre", "madre", "padre/madre"],
  ["abuelo", "abuela", "abuelo/a"],
  ["bisabuelo", "bisabuela", "bisabuelo/a"],
  ["tatarabuelo", "tatarabuela", "tatarabuelo/a"],
  ["trastatarabuelo", "trastatarabuela", "trastatarabuelo/a"],
];

const DESCENDANT_LABELS: [string, string, string][] = [
  ["hijo", "hija", "hijo/a"],
  ["nieto", "nieta", "nieto/a"],
  ["bisnieto", "bisnieta", "bisnieto/a"],
  ["tataranieto", "tataranieta", "tataranieto/a"],
  ["trastataranieto", "trastataranieta", "trastataranieto/a"],
];

const COUSIN_LABELS: [string, string, string][] = [
  ["primo hermano", "prima hermana", "primo/a hermano/a"],
  ["primo segundo", "prima segunda", "primo/a segundo/a"],
  ["primo tercero", "prima tercera", "primo/a tercero/a"],
];

function ancestorLabelEs(degree: number, sex: "M" | "F" | "U"): string {
  const entry = ANCESTOR_LABELS[degree - 1];
  if (entry) return gendered(entry[0], entry[1], entry[2], sex);
  return gendered(`antepasado directo (${degree}ª generación)`, `antepasada directa (${degree}ª generación)`, `antepasado/a directo/a (${degree}ª generación)`, sex);
}

function descendantLabelEs(degree: number, sex: "M" | "F" | "U"): string {
  const entry = DESCENDANT_LABELS[degree - 1];
  if (entry) return gendered(entry[0], entry[1], entry[2], sex);
  return gendered(`descendiente directo (${degree}ª generación)`, `descendiente directa (${degree}ª generación)`, `descendiente directo/a (${degree}ª generación)`, sex);
}

function removalSuffix(removal: number): string {
  if (removal <= 0) return "";
  if (removal === 1) return ", una vez removido/a";
  if (removal === 2) return ", dos veces removido/a";
  return `, ${removal} veces removido/a`;
}

function collateralLabelEs(cousinDegree: number, removal: number, meCloserToCommonAncestor: boolean, sex: "M" | "F" | "U"): string {
  if (cousinDegree === 0) {
    const base = meCloserToCommonAncestor
      ? gendered("sobrino", "sobrina", "sobrino/a", sex)
      : gendered("tío", "tía", "tío/tía", sex);
    return base + removalSuffix(removal);
  }
  const entry = COUSIN_LABELS[cousinDegree - 1];
  const base = entry ? gendered(entry[0], entry[1], entry[2], sex) : gendered(`primo en ${cousinDegree}º grado`, `prima en ${cousinDegree}º grado`, `primo/a en ${cousinDegree}º grado`, sex);
  return base + removalSuffix(removal);
}

// Ancestor depths from rootId (0 = rootId itself), reusing walkGraph's own
// "up" BFS — its generation values come back negative going up, so this is
// just a sign flip plus seeding the root at depth 0.
function ancestorDepths(people: TreePerson[], rootId: string): Map<string, number> {
  const walked = walkGraph(people, rootId, "up");
  const depths = new Map<string, number>([[rootId, 0]]);
  for (const [id, { generation }] of walked) depths.set(id, -generation);
  return depths;
}

function findRelationship(
  people: TreePerson[],
  byId: Map<string, TreePerson>,
  meId: string,
  targetId: string,
): { relationship: RelationshipResult; generationRelativeToMe: number | null } {
  if (meId === targetId) return { relationship: { kind: "self" }, generationRelativeToMe: 0 };

  const meDepths = ancestorDepths(people, meId);
  const targetDepths = ancestorDepths(people, targetId);

  let best: { id: string; meDepth: number; targetDepth: number } | null = null;
  for (const [id, meDepth] of meDepths) {
    const targetDepth = targetDepths.get(id);
    if (targetDepth === undefined) continue;
    if (!best || meDepth + targetDepth < best.meDepth + best.targetDepth) {
      best = { id, meDepth, targetDepth };
    }
  }

  if (!best) return { relationship: { kind: "disconnected" }, generationRelativeToMe: null };

  const { meDepth, targetDepth } = best;
  const generationRelativeToMe = targetDepth - meDepth;
  const targetSex = sexOf(byId, targetId);

  if (meDepth === 0) {
    return {
      relationship: { kind: "direct-descendant", degree: targetDepth, labelEs: descendantLabelEs(targetDepth, targetSex) },
      generationRelativeToMe,
    };
  }
  if (targetDepth === 0) {
    return {
      relationship: { kind: "direct-ancestor", degree: meDepth, labelEs: ancestorLabelEs(meDepth, targetSex) },
      generationRelativeToMe,
    };
  }
  if (meDepth === 1 && targetDepth === 1) {
    const meParents = new Set(byId.get(meId)?.rels.parents ?? []);
    const targetParents = new Set(byId.get(targetId)?.rels.parents ?? []);
    const sharedParents = [...meParents].filter((p) => targetParents.has(p)).length;
    const half = sharedParents < 2;
    const labelEs = half
      ? gendered("medio hermano", "media hermana", "medio hermano/a", targetSex)
      : gendered("hermano", "hermana", "hermano/a", targetSex);
    return { relationship: { kind: "sibling", half, labelEs }, generationRelativeToMe };
  }

  const cousinDegree = Math.min(meDepth, targetDepth) - 1;
  const removal = Math.abs(meDepth - targetDepth);
  const labelEs = collateralLabelEs(cousinDegree, removal, meDepth < targetDepth, targetSex);
  return { relationship: { kind: "collateral", cousinDegree, removal, labelEs }, generationRelativeToMe };
}

// Whole-tree, multi-root generation leveling (people with no recorded
// parents are generation 0). Kahn-style layering: a person resolves once
// every one of their recorded parents already has a generation number,
// taking the max of their parents' generations + 1 (handles a child whose
// two parents sit at different tree depths, common with age-gap
// marriages). Bounded to people.length + 1 passes so bad-data cycles
// degrade to "some people never get a generation" instead of looping
// forever.
function levelGenerations(people: TreePerson[]): Map<string, number> {
  const generation = new Map<string, number>();
  for (let pass = 0; pass < people.length + 1 && generation.size < people.length; pass++) {
    for (const person of people) {
      if (generation.has(person.id)) continue;
      if (person.rels.parents.length === 0) {
        generation.set(person.id, 0);
        continue;
      }
      if (!person.rels.parents.every((pid) => generation.has(pid))) continue;
      generation.set(person.id, Math.max(...person.rels.parents.map((pid) => generation.get(pid)!)) + 1);
    }
  }
  return generation;
}

export async function computeGeneralStatistics(treeId: string): Promise<GeneralStatistics> {
  const { people } = await buildTreeData(treeId);
  const total = people.length;

  let male = 0;
  let female = 0;
  let unknown = 0;
  for (const p of people) {
    if (p.data.gender === "M") male++;
    else if (p.data.gender === "F") female++;
    else unknown++;
  }
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  const lineageCount = await prisma.lineage.count({ where: { treeId } });

  let earliest: number | null = null;
  let latest: number | null = null;
  for (const p of people) {
    for (const iso of [p.data.birthDateValue, p.data.deathDateValue]) {
      if (!iso) continue;
      const year = new Date(iso).getUTCFullYear();
      if (earliest === null || year < earliest) earliest = year;
      if (latest === null || year > latest) latest = year;
    }
  }
  const yearRange = earliest !== null && latest !== null ? { earliest, latest } : null;

  let longestLived: GeneralStatistics["longestLived"] = null;
  for (const p of people) {
    if (!p.data.birthDateValue || !p.data.deathDateValue) continue;
    const ageYears = ageInYears(p.data.birthDateValue, p.data.deathDateValue);
    if (!longestLived || ageYears > longestLived.ageYears) {
      longestLived = { individualId: p.id, name: fullName(p), ageYears };
    }
  }

  const lineages = await prisma.lineage.findMany({
    where: { treeId },
    include: { individuals: { include: { individual: { select: { deletedAt: true } } } } },
  });
  let largestLineage: GeneralStatistics["largestLineage"] = null;
  for (const lineage of lineages) {
    const memberCount = lineage.individuals.filter((il) => il.individual.deletedAt === null).length;
    if (memberCount > 0 && (!largestLineage || memberCount > largestLineage.memberCount)) {
      largestLineage = { lineageId: lineage.id, name: lineage.name, memberCount };
    }
  }

  let largestGeneration: GeneralStatistics["largestGeneration"] = null;
  if (total > 0) {
    const generations = levelGenerations(people);
    const counts = new Map<number, number>();
    // Someone with no recorded parents anchors the leveling at generation 0
    // (needed so their descendants still level correctly), but they're
    // excluded from this particular count — otherwise a spouse who married
    // into the family with no ancestry entered would count as "generation
    // 0" alongside the tree's actual root ancestors, which in a real tree
    // tends to make generation 0 dominate this stat and say nothing useful.
    for (const person of people) {
      if (person.rels.parents.length === 0) continue;
      const gen = generations.get(person.id);
      if (gen === undefined) continue;
      counts.set(gen, (counts.get(gen) ?? 0) + 1);
    }
    for (const [generation, count] of counts) {
      if (!largestGeneration || count > largestGeneration.count) largestGeneration = { generation, count };
    }
  }

  const familyNucleiCount = await prisma.family.count({
    where: { treeId, OR: [{ partner1Id: { not: null } }, { partner2Id: { not: null } }] },
  });

  let missingBirth = 0;
  let missingDeath = 0;
  let missingBoth = 0;
  for (const p of people) {
    const hasBirth = Boolean(p.data.birthday || p.data.birthDateValue);
    const hasDeath = Boolean(p.data.deathday || p.data.deathDateValue);
    if (!hasBirth) missingBirth++;
    if (!hasDeath) missingDeath++;
    if (!hasBirth && !hasDeath) missingBoth++;
  }

  const placeCounts = new Map<string, { count: number; display: string }>();
  for (const p of people) {
    const place = p.data["birth place"]?.trim();
    if (!place) continue;
    const key = place.toLocaleLowerCase("es");
    const entry = placeCounts.get(key);
    if (entry) entry.count++;
    else placeCounts.set(key, { count: 1, display: place });
  }
  let mostCommonBirthplace: GeneralStatistics["mostCommonBirthplace"] = null;
  for (const { count, display } of placeCounts.values()) {
    if (count >= 2 && (!mostCommonBirthplace || count > mostCommonBirthplace.count)) {
      mostCommonBirthplace = { place: display, count };
    }
  }

  return {
    sexCounts: { male, female, unknown, total },
    sexPercentages: { male: pct(male), female: pct(female), unknown: pct(unknown) },
    lineageCount,
    yearRange,
    longestLived,
    largestLineage,
    largestGeneration,
    familyNucleiCount,
    incompleteData: { missingBirth, missingDeath, missingBoth },
    mostCommonBirthplace,
  };
}

export async function computePersonStatistics(
  treeId: string,
  personId: string,
  userId: string,
): Promise<PersonStatistics | null> {
  const { people } = await buildTreeData(treeId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const person = byId.get(personId);
  if (!person) return null;

  const ancestors = walkGraph(people, personId, "up");
  const descendants = walkGraph(people, personId, "down");
  const ancestorGenerations = ancestors.size ? Math.max(...[...ancestors.values()].map((v) => -v.generation)) : 0;
  const descendantGenerations = descendants.size ? Math.max(...[...descendants.values()].map((v) => v.generation)) : 0;

  const parentSet = new Set(person.rels.parents);
  const siblingsCount = people.filter(
    (p) => p.id !== personId && p.rels.parents.some((pid) => parentSet.has(pid)),
  ).length;

  let age: PersonStatistics["age"] = null;
  if (person.data.deathDateValue && person.data.birthDateValue) {
    age = {
      years: ageInYears(person.data.birthDateValue, person.data.deathDateValue),
      exact: person.data.birthPrecision === "EXACT" && person.data.deathPrecision === "EXACT",
      atDeath: true,
    };
  } else if (person.data.birthDateValue) {
    age = {
      years: ageInYears(person.data.birthDateValue, new Date().toISOString()),
      exact: person.data.birthPrecision === "EXACT",
      atDeath: false,
    };
  }

  const parentsAgeAtBirth: PersonStatistics["parentsAgeAtBirth"] = [];
  if (person.data.birthDateValue) {
    for (const parentId of person.rels.parents) {
      const parent = byId.get(parentId);
      if (!parent?.data.birthDateValue) continue;
      parentsAgeAtBirth.push({
        parentId,
        parentName: fullName(parent),
        ageYears: ageInYears(parent.data.birthDateValue, person.data.birthDateValue),
        // Either date being a "circa"/before/after estimate (not EXACT)
        // makes the computed gap an estimate too — surfaced so a small
        // resulting number (e.g. both dates rounded to the same decade)
        // doesn't read as a data error.
        exact: parent.data.birthPrecision === "EXACT" && person.data.birthPrecision === "EXACT",
      });
    }
  }

  const identityRow = await prisma.userTreeIdentity.findUnique({
    where: { userId_treeId: { userId, treeId } },
    include: { individual: { select: { deletedAt: true } } },
  });
  const meId = identityRow && identityRow.individual.deletedAt === null ? identityRow.individualId : null;

  let meNotSet = true;
  let generationRelativeToMe: number | null = null;
  let relationshipToMe: RelationshipResult | null = null;
  if (meId) {
    meNotSet = false;
    const result = findRelationship(people, byId, meId, personId);
    generationRelativeToMe = result.generationRelativeToMe;
    relationshipToMe = result.relationship;
  }

  return {
    personId,
    ancestorGenerations,
    descendantGenerations,
    totalAncestors: ancestors.size,
    totalDescendants: descendants.size,
    age,
    siblingsCount,
    childrenCount: person.rels.children.length,
    unionsCount: person.rels.spouses.length,
    parentsAgeAtBirth,
    meNotSet,
    generationRelativeToMe,
    relationshipToMe,
  };
}
