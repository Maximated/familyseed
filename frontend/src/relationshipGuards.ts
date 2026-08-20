import type { TreePerson } from "./api";

export type ParentChildWarning = "SELF" | "CYCLE" | "SPOUSE";

// Checks whether recording `parentId` as a parent of `childId` would create
// a genealogically impossible loop — a person can't end up as their own
// ancestor, and (per an explicit report) shouldn't silently become a child
// of their own spouse either. Used before every addParent call, in both
// AddPersonForm and EditPersonForm, as a last check the picker itself
// doesn't already rule out.
export function checkParentChildWarning(
  people: TreePerson[],
  parentId: string,
  childId: string,
): ParentChildWarning | null {
  if (parentId === childId) return "SELF";

  const byId = new Map(people.map((p) => [p.id, p]));
  if (byId.get(childId)?.rels.spouses.includes(parentId)) return "SPOUSE";
  if (byId.get(parentId)?.rels.spouses.includes(childId)) return "SPOUSE";

  // A cycle forms exactly when `childId` is already one of `parentId`'s own
  // ancestors — walk up from parentId (parents, grandparents, ...) looking
  // for it. If found, this new edge would make parentId both an ancestor
  // and a descendant of childId.
  const seen = new Set<string>();
  const queue = [...(byId.get(parentId)?.rels.parents ?? [])];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === childId) return "CYCLE";
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(byId.get(current)?.rels.parents ?? []));
  }
  return null;
}
