// Structural integrity checks for one tree's family graph, shared between
// the read-only diagnostic API (routes/integrity.ts, surfaced in the
// app's own UI) and the standalone CLI script (scripts/check-tree-
// integrity.ts, used against production). Deliberately read-only: after
// the automatic cycle-prevention guard once made a tree briefly
// unreachable in production, the call was made to never auto-fix data
// here — only report what's wrong and point at exactly who to open and
// edit, and let a human decide what "wrong" means for their own family.
import { prisma } from "./db.js";
import { buildTreeData } from "./tree-data.js";

export type IntegrityIssue = {
  type:
    | "cycle"
    | "self_link"
    | "asymmetric_child_link"
    | "asymmetric_spouse_link"
    | "multiple_biological_parents";
  summary: string;
  // Parallel arrays: personIds[i] is who's behind personNames[i] — lets
  // the UI offer a "open <name>" jump for each person involved instead of
  // a bare, unlabeled button.
  personIds: string[];
  personNames: string[];
};

export async function findIntegrityIssues(treeId: string): Promise<IntegrityIssue[]> {
  const { people } = await buildTreeData(treeId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.data["first name"]} ${p.data["last name"]}`.trim() || id : id;
  };

  const issues: IntegrityIssue[] = [];
  function addIssue(type: IntegrityIssue["type"], summary: string, personIds: string[]) {
    issues.push({ type, summary, personIds, personNames: personIds.map(name) });
  }

  // Parent -> child cycle detection (3-color DFS), same algorithm as the
  // CLI script this module was factored out of. One cycle is enough to
  // explain an unrenderable tree, so stop at the first found.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(people.map((p) => [p.id, WHITE]));
  const pathStack: string[] = [];
  function dfs(id: string): string[] | null {
    color.set(id, GRAY);
    pathStack.push(id);
    const person = byId.get(id);
    for (const childId of person?.rels.children ?? []) {
      const c = color.get(childId);
      if (c === GRAY) {
        const idx = pathStack.indexOf(childId);
        return [...pathStack.slice(idx), childId];
      }
      if (c === WHITE) {
        const cycle = dfs(childId);
        if (cycle) return cycle;
      }
    }
    pathStack.pop();
    color.set(id, BLACK);
    return null;
  }
  for (const p of people) {
    if (color.get(p.id) !== WHITE) continue;
    const cycle = dfs(p.id);
    if (cycle) {
      addIssue("cycle", `${cycle.map(name).join(" → ")}: acaba siendo su propio ascendiente.`, cycle);
      break;
    }
  }

  for (const p of people) {
    if (p.rels.children.includes(p.id)) {
      addIssue("self_link", `${name(p.id)} aparece como hijo/a de sí mismo/a.`, [p.id]);
    }
    if (p.rels.parents.includes(p.id)) {
      addIssue("self_link", `${name(p.id)} aparece como padre/madre de sí mismo/a.`, [p.id]);
    }
  }

  // Parent/child and spouse links should always be symmetric (buildTreeData
  // derives both directions from the same rows) — cheap to confirm since
  // this is already walking the same data.
  for (const p of people) {
    for (const childId of p.rels.children) {
      const child = byId.get(childId);
      if (child && !child.rels.parents.includes(p.id)) {
        addIssue(
          "asymmetric_child_link",
          `${name(p.id)} lista a ${name(childId)} como hijo/a, pero esa persona no lo lista de vuelta como padre/madre.`,
          [p.id, childId],
        );
      }
    }
    for (const spouseId of p.rels.spouses) {
      const spouse = byId.get(spouseId);
      if (spouse && !spouse.rels.spouses.includes(p.id)) {
        addIssue(
          "asymmetric_spouse_link",
          `${name(p.id)} lista a ${name(spouseId)} como cónyuge, pero no al revés.`,
          [p.id, spouseId],
        );
      }
    }
  }

  // More than one BIOLOGICAL family of origin for the same person — the
  // exact shape of "le asigné dos parejas de padres a la misma persona":
  // a person can only ever have one set of biological parents, so a
  // second BIOLOGICAL FamilyChild row is always a mistaken link, never a
  // legitimate second set. Adoptive/foster/step families are the one real
  // exception (a person can reasonably have both a biological family and
  // an adoptive one), so those relation types don't count here.
  const bioLinks = await prisma.familyChild.findMany({
    where: { relationType: "BIOLOGICAL", family: { treeId }, individual: { deletedAt: null } },
    select: { individualId: true, familyId: true },
  });
  const bioFamiliesByChild = new Map<string, string[]>();
  for (const link of bioLinks) {
    const list = bioFamiliesByChild.get(link.individualId) ?? [];
    list.push(link.familyId);
    bioFamiliesByChild.set(link.individualId, list);
  }
  for (const [childId, familyIds] of bioFamiliesByChild) {
    if (familyIds.length <= 1) continue;
    addIssue(
      "multiple_biological_parents",
      `${name(childId)} tiene ${familyIds.length} familias biológicas distintas registradas — revisa si alguna de ellas debería ser adoptiva o es un vínculo sobrante.`,
      [childId],
    );
  }

  return issues;
}
