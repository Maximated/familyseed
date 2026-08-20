import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import type { TreePerson } from "./tree-data.js";
import { walkGraph } from "./tree-data.js";
import { uploadsRoot } from "./uploads.js";

export type ReportDirection = "ancestors" | "descendants" | "both";
export type ReportLayout = "vertical" | "horizontal" | "descending";

const UP_LABELS = ["Padres", "Abuelos", "Bisabuelos", "Tatarabuelos"];
const DOWN_LABELS = ["Hijos", "Nietos", "Bisnietos", "Tataranietos"];

function generationLabel(generation: number): string {
  const magnitude = Math.abs(generation);
  const labels = generation < 0 ? UP_LABELS : DOWN_LABELS;
  if (magnitude <= labels.length) return labels[magnitude - 1];
  const ordinal = `${magnitude}ª generación`;
  return generation < 0 ? `Ascendientes (${ordinal})` : `Descendientes (${ordinal})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function personName(person: TreePerson): string {
  return `${person.data["first name"] ?? ""} ${person.data["last name"] ?? ""}`.trim();
}

function lifespan(person: TreePerson): string {
  const birth = person.data.birthday;
  const death = person.data.deathday;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `n. ${birth}`;
  if (death) return `† ${death}`;
  return "";
}

// Avatars are stored on disk as a short /uploads/... URL — for the PDF
// (rendered by a headless browser with no access to the running API) they
// get inlined as data: URIs instead of left as a relative link.
async function avatarDataUri(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const relative = url.replace(/^\/uploads\//, "");
    const filePath = path.join(uploadsRoot(), relative);
    const buffer = await readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

const PERSON_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#1b4332" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`;

async function personCardHtml(person: TreePerson): Promise<string> {
  const avatar = await avatarDataUri(person.data.avatar);
  const avatarHtml = avatar
    ? `<img class="avatar" src="${avatar}" alt="" />`
    : `<div class="avatar avatar-placeholder">${PERSON_ICON_SVG}</div>`;
  const span = lifespan(person);
  const place = [person.data["birth place"], person.data["death place"]].filter(Boolean).join(" · ");
  const alias = person.data.alias ? `<span class="alias">«${escapeHtml(String(person.data.alias))}»</span>` : "";

  return `
    <div class="person-card">
      ${avatarHtml}
      <div class="person-info">
        <div class="person-name">${escapeHtml(personName(person))} ${alias}</div>
        ${span ? `<div class="person-lifespan">${escapeHtml(span)}</div>` : ""}
        ${place ? `<div class="person-place">${escapeHtml(place)}</div>` : ""}
      </div>
    </div>`;
}

async function generationSectionHtml(
  generation: number,
  people: TreePerson[],
): Promise<string> {
  const cards = await Promise.all(people.map(personCardHtml));
  return `
    <section class="generation">
      <h2>${escapeHtml(generationLabel(generation))}</h2>
      <div class="generation-grid">${cards.join("")}</div>
    </section>`;
}

async function rootSectionHtml(root: TreePerson): Promise<string> {
  const card = await personCardHtml(root);
  return `
    <section class="generation root-section">
      <h2 class="root-heading">${escapeHtml(personName(root))}</h2>
      <div class="generation-grid">${card}</div>
    </section>`;
}

// Merges every root's walkGraph(...) result into one map, keyed by person —
// when the same person is reached from more than one root (e.g. a shared
// great-grandparent between two grandparents both picked as roots), the
// shallowest/closest relationship wins, so they're shown once under the
// generation label that's actually most relevant, not duplicated or
// mislabeled as more distant than they are from at least one root. Any
// person who is themselves one of the selected roots is excluded — they
// get their own root-section instead of also appearing folded into a
// generation.
function mergeWalks(
  people: TreePerson[],
  rootIds: string[],
  direction: "up" | "down",
): Map<string, { person: TreePerson; generation: number }> {
  const rootIdSet = new Set(rootIds);
  const merged = new Map<string, { person: TreePerson; generation: number }>();
  for (const rootId of rootIds) {
    for (const [id, entry] of walkGraph(people, rootId, direction)) {
      if (rootIdSet.has(id)) continue;
      const existing = merged.get(id);
      if (!existing || Math.abs(entry.generation) < Math.abs(existing.generation)) {
        merged.set(id, entry);
      }
    }
  }
  return merged;
}

async function generationSections(
  merged: Map<string, { person: TreePerson; generation: number }>,
  sortAscending: boolean,
): Promise<string[]> {
  const byGeneration = new Map<number, TreePerson[]>();
  for (const { person, generation } of merged.values()) {
    if (!byGeneration.has(generation)) byGeneration.set(generation, []);
    byGeneration.get(generation)!.push(person);
  }
  const generations = [...byGeneration.keys()].sort((a, b) => (sortAscending ? a - b : b - a));
  const sections: string[] = [];
  for (const generation of generations) {
    const group = byGeneration.get(generation)!.sort((a, b) => personName(a).localeCompare(personName(b)));
    sections.push(await generationSectionHtml(generation, group));
  }
  return sections;
}

export async function renderReportHtml(
  people: TreePerson[],
  rootIds: string[],
  treeName: string,
  direction: ReportDirection,
  layout: ReportLayout = "vertical",
): Promise<string> {
  const roots = rootIds.map((id) => {
    const person = people.find((p) => p.id === id);
    if (!person) throw new Error(`No existe el individuo ${id}`);
    return person;
  });

  // "descending" only changes generation order (youngest-first instead of
  // oldest-first) — it's the same two sort calls the single-root version
  // always had, just both flipped together.
  const ascendingSort = layout === "descending";

  const sections: string[] = [];
  if (direction === "ancestors" || direction === "both") {
    sections.push(...(await generationSections(mergeWalks(people, rootIds, "up"), !ascendingSort)));
  }

  const rootSections = await Promise.all(roots.map(rootSectionHtml));

  const descendantSections: string[] = [];
  if (direction === "descendants" || direction === "both") {
    descendantSections.push(...(await generationSections(mergeWalks(people, rootIds, "down"), ascendingSort)));
  }

  const title =
    direction === "ancestors"
      ? "Ascendientes"
      : direction === "descendants"
        ? "Descendientes"
        : "Ascendientes y descendientes";

  const bodyBlocks = [...sections, ...rootSections, ...descendantSections];
  const bodyHtml =
    layout === "horizontal"
      ? `<div class="generations-row">${bodyBlocks.join("")}</div>`
      : bodyBlocks.join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500;1,600&family=Inter:wght@400;600;700&display=swap"
/>
<style>
  :root {
    --color-bg: #faf6ef;
    --color-forest: #1b4332;
    --color-amber: #e07a29;
    --color-text-secondary: #374151;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 40px;
    background: var(--color-bg);
    font-family: "Inter", system-ui, sans-serif;
    color: var(--color-forest);
  }
  h1 {
    font-family: "Fraunces", Georgia, serif;
    font-size: 26px;
    margin: 0 0 4px;
  }
  .subtitle {
    margin: 0 0 24px;
    color: var(--color-text-secondary);
    font-size: 13px;
  }
  .generation {
    margin-bottom: 20px;
    break-inside: avoid;
  }
  .generation h2 {
    font-family: "Fraunces", Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--color-forest);
  }
  /* Wins over the plain ".generation h2" rule above (two classes beats one
     class + one element) so a root's own heading keeps its amber/underline
     treatment even though it's now rendered inside the same ".generation"
     wrapper as every other section, for the horizontal-layout column CSS
     below to apply to it too. */
  .generation h2.root-heading {
    color: var(--color-amber);
    font-size: 16px;
    border-bottom: 2px solid var(--color-amber);
    padding-bottom: 4px;
  }
  .generation-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  /* Horizontal layout: generations (and each root's own section) become
     columns side by side instead of stacked rows — no chart library
     involved, just a flex-direction swap on the same markup. */
  .generations-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 24px;
  }
  .generations-row .generation {
    flex-shrink: 0;
    width: 260px;
  }
  .generations-row .generation-grid {
    flex-direction: column;
    flex-wrap: nowrap;
  }
  .person-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 260px;
    padding: 8px 10px;
    border: 1px solid rgba(27, 67, 50, 0.15);
    border-radius: 8px;
    background: white;
    break-inside: avoid;
  }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eee6d8;
  }
  .avatar-placeholder svg {
    width: 18px;
    height: 18px;
  }
  .person-name {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 600;
    font-size: 13px;
  }
  .alias {
    font-weight: 400;
    font-style: italic;
    color: var(--color-text-secondary);
  }
  .person-lifespan,
  .person-place {
    font-size: 11px;
    color: var(--color-text-secondary);
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(treeName)}</p>
  ${bodyHtml}
</body>
</html>`;
}

export async function renderReportPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Google Fonts load asynchronously after the initial content — give
    // them a moment so the PDF doesn't fall back to the system serif/sans.
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
