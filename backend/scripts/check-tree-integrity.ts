// Standalone integrity check for one tree's family graph — no server, no
// browser, just the same checks the app's own "Estadísticas y gestión"
// panel runs (see ../src/tree-integrity.ts, shared by both). Written for
// the exact kind of scare a user reported: "I just linked an existing
// person as someone's child without being sure they really belong there —
// did I create a loop?" A parent/child cycle (someone ends up their own
// ancestor) is the one shape of bad data that can make the tree
// unrenderable, so that's the primary thing this looks for; the rest are
// cheaper consistency checks worth having in the same pass.
//
// Usage (local dev): npx tsx scripts/check-tree-integrity.ts <treeId>
// Usage (production container — this file ships compiled under dist/,
// same as the rest of the backend, not as raw TS): docker compose exec
// app npm run check-tree:prod -- <treeId>
import { findIntegrityIssues } from "../src/tree-integrity.js";

async function main() {
  const treeId = process.argv[2];
  if (!treeId) {
    console.error("Usage: npx tsx scripts/check-tree-integrity.ts <treeId>");
    process.exit(1);
  }

  console.log(`Comprobando el árbol ${treeId}...\n`);

  const issues = await findIntegrityIssues(treeId);

  if (issues.length === 0) {
    console.log("Todo correcto: no se ha encontrado ningún ciclo ni inconsistencia en los datos.");
    return;
  }

  for (const issue of issues) {
    console.log(`[${issue.type}] ${issue.summary}`);
  }
  console.log(`\n${issues.length} problema(s) encontrado(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
