// Removes one specific parent/child link (a single FamilyChild row) —
// built for exactly the scenario check-tree-integrity.ts is written to
// catch: linking the wrong same-named person as someone's child creates a
// parent/child cycle, which makes the tree unrenderable (the frontend never
// guards against a cycle when walking rels.children/rels.parents). Once
// that's happened, the user can't open the tree in the app to undo it
// themselves — this is the way out.
//
// Deliberately narrow: it removes one Family <-> Individual link, nothing
// else (not the two people, not the whole family, not any other
// relationship). Dry-run by default — pass --yes to actually delete, after
// checking the printed match is the one you meant.
//
// Usage (production container): docker compose exec app npm run
// remove-family-child:prod -- <treeId> <parentId> <childId> [--yes]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [treeId, parentId, childId, flag] = process.argv.slice(2);
  if (!treeId || !parentId || !childId) {
    console.error("Usage: remove-family-child.ts <treeId> <parentId> <childId> [--yes]");
    process.exit(1);
  }
  const confirmed = flag === "--yes";

  const families = await prisma.family.findMany({
    where: { treeId, OR: [{ partner1Id: parentId }, { partner2Id: parentId }] },
    include: {
      partner1: { select: { givenNames: true, surname1: true } },
      partner2: { select: { givenNames: true, surname1: true } },
      children: { where: { individualId: childId }, include: { individual: { select: { givenNames: true, surname1: true } } } },
    },
  });

  const matches = families.filter((f) => f.children.length > 0);

  if (matches.length === 0) {
    console.log("No se ha encontrado ningún vínculo de esa persona como hija/o de esa familia — nada que quitar.");
    return;
  }
  if (matches.length > 1) {
    console.log(`Se han encontrado ${matches.length} vínculos distintos — no se toca nada. Revísalos a mano:`);
    for (const f of matches) console.log(" - familyId:", f.id);
    return;
  }

  const family = matches[0];
  const child = family.children[0].individual;
  const p1 = family.partner1 ? `${family.partner1.givenNames} ${family.partner1.surname1}` : "(sin pareja)";
  const p2 = family.partner2 ? `${family.partner2.givenNames} ${family.partner2.surname1}` : "(sin pareja)";

  console.log(`Familia: ${p1} + ${p2} (familyId: ${family.id})`);
  console.log(`Hijo/a a desvincular: ${child.givenNames} ${child.surname1} (${childId})`);

  if (!confirmed) {
    console.log("\nEsto es una simulación — no se ha borrado nada todavía.");
    console.log("Si el vínculo de arriba es el correcto a eliminar, vuelve a ejecutar el mismo comando añadiendo --yes al final.");
    return;
  }

  await prisma.familyChild.delete({ where: { familyId_individualId: { familyId: family.id, individualId: childId } } });
  console.log("\nHecho: vínculo eliminado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
