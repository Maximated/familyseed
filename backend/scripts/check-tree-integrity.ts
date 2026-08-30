// Standalone integrity check for one tree's family graph — no server, no
// browser, just the same TreePerson data the frontend renders from
// (buildTreeData). Written for the exact kind of scare a user reported:
// "I just linked an existing person as someone's child without being sure
// they really belong there — did I create a loop?" A parent/child cycle
// (someone ends up their own ancestor) is the one shape of bad data that
// can make the tree unrenderable, so that's the primary thing this looks
// for; the rest are cheaper consistency checks worth having in the same
// pass since they're already walking the same data.
//
// Usage (local dev): npx tsx scripts/check-tree-integrity.ts <treeId>
// Usage (production container — this file ships compiled under dist/,
// same as the rest of the backend, not as raw TS): docker compose exec
// app npm run check-tree:prod -- <treeId>
import { buildTreeData } from "../src/tree-data.js";

async function main() {
  const treeId = process.argv[2];
  if (!treeId) {
    console.error("Usage: npx tsx scripts/check-tree-integrity.ts <treeId>");
    process.exit(1);
  }

  const { people } = await buildTreeData(treeId);
  const byId = new Map(people.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.data["first name"]} ${p.data["last name"]} (${id})` : `<desconocido:${id}>`;
  };

  console.log(`Comprobando ${people.length} personas del árbol ${treeId}...\n`);

  let problems = 0;

  // Parent -> child cycle detection (a person can't be their own
  // ancestor). Standard DFS 3-color scheme: white = sin visitar, gray = en
  // la pila de recursión actual, black = ya procesado del todo. Encontrar
  // un nodo gris de nuevo significa que hemos vuelto sobre el mismo camino
  // = un ciclo.
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
      problems++;
      console.log("CICLO ENCONTRADO (alguien acaba siendo su propio ascendiente):");
      console.log("  " + cycle.map(name).join("\n  -> "));
      console.log();
      break; // one cycle is enough to explain an unrenderable tree; fix and re-run for more
    }
  }

  // Self-parent / self-child (a degenerate 1-node cycle the DFS above
  // would also catch, but calling it out by name is clearer).
  for (const p of people) {
    if (p.rels.children.includes(p.id)) {
      problems++;
      console.log("AUTO-HIJO:", name(p.id), "aparece como hijo de sí mismo.");
    }
    if (p.rels.parents.includes(p.id)) {
      problems++;
      console.log("AUTO-PADRE:", name(p.id), "aparece como padre/madre de sí mismo.");
    }
  }

  // Parent/child link recorded on one side but not the other — buildTreeData
  // derives both directions from the same FamilyChild rows, so this
  // shouldn't happen from normal use, but is cheap to confirm.
  for (const p of people) {
    for (const childId of p.rels.children) {
      const child = byId.get(childId);
      if (child && !child.rels.parents.includes(p.id)) {
        problems++;
        console.log("INCONSISTENTE:", name(p.id), "lista a", name(childId), "como hijo, pero esa persona no lo lista de vuelta como padre/madre.");
      }
    }
  }

  // Same check for spouses (should always be symmetric — each family's two
  // partners list each other).
  for (const p of people) {
    for (const spouseId of p.rels.spouses) {
      const spouse = byId.get(spouseId);
      if (spouse && !spouse.rels.spouses.includes(p.id)) {
        problems++;
        console.log("INCONSISTENTE:", name(p.id), "lista a", name(spouseId), "como cónyuge, pero no al revés.");
      }
    }
  }

  if (problems === 0) {
    console.log("Todo correcto: no se ha encontrado ningún ciclo ni inconsistencia en los datos.");
  } else {
    console.log(`\n${problems} problema(s) encontrado(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
