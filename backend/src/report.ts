import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import type { TreePerson } from "./tree-data.js";
import { walkGraph } from "./tree-data.js";
import { uploadsRoot } from "./uploads.js";

export type ReportDirection = "ancestors" | "descendants" | "both";

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

export async function renderReportHtml(
  people: TreePerson[],
  rootId: string,
  treeName: string,
  direction: ReportDirection,
): Promise<string> {
  const root = people.find((p) => p.id === rootId);
  if (!root) throw new Error(`No existe el individuo ${rootId}`);

  const sections: string[] = [];

  if (direction === "ancestors" || direction === "both") {
    const ancestors = walkGraph(people, rootId, "up");
    const byGeneration = new Map<number, TreePerson[]>();
    for (const { person, generation } of ancestors.values()) {
      if (!byGeneration.has(generation)) byGeneration.set(generation, []);
      byGeneration.get(generation)!.push(person);
    }
    const generations = [...byGeneration.keys()].sort((a, b) => b - a);
    for (const generation of generations) {
      const group = byGeneration.get(generation)!.sort((a, b) => personName(a).localeCompare(personName(b)));
      sections.push(await generationSectionHtml(generation, group));
    }
  }

  const rootCard = await personCardHtml(root);

  const descendantSections: string[] = [];
  if (direction === "descendants" || direction === "both") {
    const descendants = walkGraph(people, rootId, "down");
    const byGeneration = new Map<number, TreePerson[]>();
    for (const { person, generation } of descendants.values()) {
      if (!byGeneration.has(generation)) byGeneration.set(generation, []);
      byGeneration.get(generation)!.push(person);
    }
    const generations = [...byGeneration.keys()].sort((a, b) => a - b);
    for (const generation of generations) {
      const group = byGeneration.get(generation)!.sort((a, b) => personName(a).localeCompare(personName(b)));
      descendantSections.push(await generationSectionHtml(generation, group));
    }
  }

  const title =
    direction === "ancestors"
      ? "Ascendientes"
      : direction === "descendants"
        ? "Descendientes"
        : "Ascendientes y descendientes";

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
  .root-heading {
    font-family: "Fraunces", Georgia, serif;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-amber);
    margin: 28px 0 10px;
    padding-bottom: 4px;
    border-bottom: 2px solid var(--color-amber);
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
  .generation-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
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
  ${sections.join("")}
  <div class="root-heading">${escapeHtml(personName(root))}</div>
  <div class="generation-grid">${rootCard}</div>
  ${descendantSections.join("")}
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
