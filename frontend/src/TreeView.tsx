import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import i18n from "./i18n";
import {
  deriveLineages,
  fetchLineages,
  fetchTree,
  mediaUrl,
  updateTreeName,
  type Lineage,
  type TreePerson,
  type TreeRole,
  type UnionInfo,
} from "./api";
import AddPersonForm from "./AddPersonForm";
import EditPersonForm from "./EditPersonForm";
import TrashView from "./TrashView";
import IndividualsSearchView from "./IndividualsSearchView";
import LineageChips from "./LineageChips";
import Legend from "./Legend";
import HoverPreview from "./HoverPreview";
import IOSToggle from "./IOSToggle";
import InfoPanel, { type InfoPanelData, type InfoPanelSection } from "./InfoPanel";
import { unionMarkMarkup, UnionMarkIcon } from "./unionMarkIcons";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ColumnsIcon,
  DuplicatesIcon,
  UnresolvedIcon,
  ImageIcon,
  GitBranchIcon,
  HomeIcon,
  LinkIcon,
  MaximizeIcon,
  MenuIcon,
  RowsIcon,
  SearchIcon,
  ShareIcon,
  Trash2Icon,
  UserIcon,
  UserPlusIcon,
} from "./Icons";
import ShareTreeModal from "./ShareTreeModal";
import DuplicatesView from "./DuplicatesView";
import LinkPeopleModal from "./LinkPeopleModal";
import LineagesManageView from "./LineagesManageView";
import PhotoLightbox from "./PhotoLightbox";
import GedcomView from "./GedcomView";
import RelationshipWizard from "./RelationshipWizard";
import { getDefaultOrientation } from "./preferences";

// Generous enough that a realistic family tree's every reachable ancestor/
// descendant renders — family-chart has no separate "show every person"
// mode, it only ever renders what's reachable from the current main person
// within these depth limits (plus that person's own siblings, see
// setShowSiblingsOfMain above), so "show the whole tree" means widening
// this rather than switching rendering modes.
const FIT_ALL_DEPTH = 50;
const DEFAULT_DEPTH = 3;

// family-chart's own Datum type requires `gender: 'M' | 'F'`, but our data
// can omit it (unknown sex) — the library renders a genderless card fine at
// runtime, its type just doesn't spell out that case. Cast at the boundary
// rather than fighting the stricter type throughout this file.
type ChartData = Parameters<typeof f3.createChart>[1];

// Walks up via each person's first recorded parent until there's no parent
// left on file — used to pick a starting point for "ver todo el árbol" that
// makes every sibling-of-a-sibling (and their spouses) a proper descendant
// instead of a bolted-on sibling node (see handleFitAll for why that
// distinction matters to family-chart's renderer). Picking parents[0]
// consistently (rather than trying both sides) keeps this a single
// deterministic walk up one lineage rather than a multi-root search.
//
// A person with no parents on file (someone who married into the family,
// with their own ancestry never entered) is a dead end for that walk even
// though their spouse's side may go back further — without crossing over,
// centering on that in-law would leave the button doing nothing at all.
// So whenever the walk hits someone with no recorded parents, it checks
// their spouses for one that *does* have parents and continues from there.
function findTopAncestorId(startId: string, people: TreePerson[]): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const visited = new Set<string>([startId]);
  let topId = startId;
  let current = byId.get(startId);
  while (current) {
    if (current.rels.parents.length > 0) {
      const nextId = current.rels.parents[0];
      if (visited.has(nextId)) break;
      const next = byId.get(nextId);
      if (!next) break;
      visited.add(nextId);
      topId = nextId;
      current = next;
      continue;
    }
    const spouseWithParents = current.rels.spouses
      .map((id) => byId.get(id))
      .find((sp): sp is TreePerson => !!sp && !visited.has(sp.id) && sp.rels.parents.length > 0);
    if (!spouseWithParents) break;
    visited.add(spouseWithParents.id);
    topId = spouseWithParents.id;
    current = spouseWithParents;
  }
  return topId;
}

function applyLineageHighlight(container: HTMLElement, people: TreePerson[], selectedIds: Set<string>) {
  const lineagesById = new Map(people.map((p) => [p.id, p.data.lineageIds ?? []]));
  const cards = container.querySelectorAll<HTMLElement>(".card[data-id]");

  cards.forEach((card) => {
    const id = card.dataset.id;
    if (!id) return;

    if (selectedIds.size === 0) {
      card.classList.remove("lineage-highlight", "lineage-dim");
      return;
    }

    const personLineageIds = lineagesById.get(id) ?? [];
    const isMatch = personLineageIds.some((lineageId) => selectedIds.has(lineageId));
    card.classList.toggle("lineage-highlight", isMatch);
    card.classList.toggle("lineage-dim", !isMatch);
  });
}

function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join("_");
}

// The datum d3 binds onto each `g.link-text` element for the marriage/
// divorce/etc. mark on a spouse link — enough to recover which two people
// it joins, plus their own laid-out coordinates (see correctLinkTextTransform
// below, which needs those to fix family-chart's own positioning bug).
type LinkTextNode = { data: { id: string }; x: number; y: number };
type LinkTextDatum = { nodes: [LinkTextNode, LinkTextNode] };

// The datum d3 binds onto each `path.link` element — the actual connecting
// line, as opposed to g.link-text's marriage/divorce mark on top of it.
// `source` is an array for a child's link to its two parents, or a single
// node for a spouse link — only the single-node (spouse) case actually
// carries `x`/`y` to any use here (see the overlapping-union-lines comment
// below), so they're optional rather than a second, near-identical type.
// A single-parent family (the other parent unknown) leaves that slot in
// `source` empty rather than omitted, so it must be tolerated here too.
type PathLinkNode = { data: { id: string }; x?: number; y?: number };
type PathLinkDatum = { source: PathLinkNode | (PathLinkNode | null | undefined)[]; target: PathLinkNode };

// How close two nodes' depth coordinate has to be to count as "the same
// row" — well under family-chart's actual row spacing (150 local units),
// so it can't mistake an adjacent generation for this one. "Depth" is
// whichever screen axis that actually is for the current orientation (see
// correctLinkTextTransform).
const SAME_ROW_TOLERANCE = 20;

// family-chart positions a spouse-link mark (marriage/divorce/etc. symbol)
// using a heuristic — one card's x plus half the fixed inter-card spacing —
// that assumes the two spouses are the only couple in their row, sitting
// exactly one spacing unit apart. That's true for a single marriage, but
// false the moment someone has two-plus spouses rendered side by side (a
// remarriage): the mark for whichever pair *isn't* horizontally adjacent
// lands at that wrong fixed offset instead of their real midpoint —
// reported as union icons drifting to one side or hovering over blank
// space. The fix is just the true midpoint of the two spouses' own laid-out
// x — those coordinates are right there on the bound datum, unlike the
// heuristic family-chart derives them with.
//
// That true midpoint is sometimes still a bad place to put it, though: when
// the two spouses aren't adjacent (someone else's card sits between them,
// e.g. an ex-partner whose own remarriage put a third card in this row),
// the midpoint can land almost exactly on that third card. Lifting the mark
// up instead (an earlier attempt at this) trades that for a different
// collision: family-chart routes its own ancestor/descendant connector
// lines through the strip between rows, at a fixed height that turned out
// to overlap the lift too. Neither problem exists at the row's own height,
// where the actual spouse-to-spouse line is drawn — so instead this slots
// the mark into whichever real gap between adjacent cards in the row falls
// closest to the true midpoint, which is always clear of every card by
// construction (same uniform spacing family-chart lays every row out with).
// family-chart swaps which screen axis is "spread" (spouses/siblings laid
// out side by side within a row) vs "depth" (generation) when the tree is
// horizontal — see its own d.psx/d.psy assignment, which reads `p.sx`/`p.y`
// in one order for vertical and the other for horizontal. Everything below
// used to hardcode x=spread/y=depth, which is only correct in vertical
// mode; in horizontal mode it was grouping "same row" by the wrong axis and
// searching for gaps along the wrong axis too, landing the mark on the
// wrong spot (or on top of another card) — this is orientation-aware so
// both modes use whichever axis actually is "spread" for them.
//
// Only ever called from handleExportTreeImage now — the live canvas hangs
// its union interaction off the connecting line itself instead (see
// wireCardAndUnionClicks), which sidesteps this whole positioning problem
// rather than solving it. A static export has no line-hover to fall back
// on, so it still needs the mark placed somewhere real; a card's own
// silhouette being covered doesn't matter there the way it did live —
// nothing to click in a picture — so this stays tuned to just clear the
// connecting line, the same distance as before the live canvas ever needed
// to also dodge a card's own click target.
function correctLinkTextTransform(
  g: SVGGElement,
  allNodes: LinkTextNode[],
  orientation: "vertical" | "horizontal",
): string | null {
  const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
  if (!datum) return null;
  const [sp1, sp2] = datum.nodes;
  if (typeof sp1.x !== "number" || typeof sp2.x !== "number" || typeof sp1.y !== "number") return null;

  const spread = (n: { x: number; y: number }) => (orientation === "horizontal" ? n.y : n.x);
  const depth = (n: { x: number; y: number }) => (orientation === "horizontal" ? n.x : n.y);
  const toTransform = (mid: number, rowDepth: number) =>
    orientation === "horizontal" ? `translate(${rowDepth}, ${mid})` : `translate(${mid}, ${rowDepth})`;

  const markGroup = g.querySelector<SVGGElement>(".union-mark-icons");
  const markBox = markGroup?.getBBox();
  const markWidth = markBox?.width ?? 20;
  const markHeight = markBox?.height ?? 20;

  // Vertical mode: the mark sits right on the row's own connecting line —
  // the old fixed -3 was tuned for family-chart's own baseline-anchored
  // <text>, which sat mostly above its own y coordinate. The icons that
  // replaced it are vertically centered on that same point instead, so the
  // same -3 left roughly half the icon hanging below the line, visibly
  // overlapping it. Lifting by the icon's own half-height (plus a small
  // margin) clears the line regardless of whether it's one icon or two —
  // there's no card to collide with going this direction: the mark only
  // ever sits in a horizontal gap between cards in its own row (see the
  // "between" gap search below), and the next row up is a good 22 units of
  // clear space further away than this reaches.
  //
  // Horizontal mode: spouses stack in a vertical column sharing one
  // connecting line straight down that column, and the mark is centered on
  // the same point, so a nudge only wide enough to clear the line itself
  // would leave it straddling one spouse's own card in the export image —
  // by request, left as-is here (see this function's own header comment
  // for why that's fine for a static picture, unlike the live canvas).
  const depthNudge = orientation === "horizontal" ? -(markWidth / 2 + 18) : -(markHeight / 2 + 4);
  // And, only in horizontal mode, dropped a few px along the spread axis
  // (screen-y there) so it clears the line vertically too, not just
  // sideways.
  // The geometric midpoint between the two avatar centers doesn't account
  // for a two-line name+lifespan text block hanging well below the upper
  // spouse's own avatar — a small nudge cleared the avatar but still left
  // the mark sitting against that text. Sized closer to a real text
  // block's height instead of a token few px.
  const spreadNudge = orientation === "horizontal" ? 30 : 0;

  const sp1Spread = spread(sp1);
  const sp2Spread = spread(sp2);
  const rowDepth = depth(sp1) + depthNudge;
  const loSpread = Math.min(sp1Spread, sp2Spread);
  const hiSpread = Math.max(sp1Spread, sp2Spread);
  const rawMidSpread = (sp1Spread + sp2Spread) / 2;

  const between = allNodes
    .filter(
      (node) =>
        node.data.id !== sp1.data.id &&
        node.data.id !== sp2.data.id &&
        Math.abs(depth(node) - depth(sp1)) < SAME_ROW_TOLERANCE &&
        spread(node) > loSpread &&
        spread(node) < hiSpread,
    )
    .sort((a, b) => spread(a) - spread(b));

  if (between.length === 0) return toTransform(rawMidSpread + spreadNudge, rowDepth);

  const boundaries = [loSpread, ...between.map((node) => spread(node)), hiSpread];
  let bestMid = rawMidSpread;
  let bestDist = Infinity;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapCenter = (boundaries[i] + boundaries[i + 1]) / 2;
    const dist = Math.abs(gapCenter - rawMidSpread);
    if (dist < bestDist) {
      bestDist = dist;
      bestMid = gapCenter;
    }
  }
  return toTransform(bestMid + spreadNudge, rowDepth);
}

// Minimal shape of the d3-zoom behavior family-chart attaches to
// `#f3Canvas` as a plain DOM property (`el.__zoomObj`, set by its own
// internal setupZoom) — not part of family-chart's public API, but the
// library exposes no other way to constrain how far the canvas can be
// panned, and a bare property read/call like this is stable enough to
// rely on (it isn't a private class field family-chart could rename
// without also breaking its own zoom wiring).
type ZoomBehaviorLike = { translateExtent: (extent: [[number, number], [number, number]]) => unknown };

// Without this, the canvas pans infinitely in every direction — nothing
// stops a stray scroll/drag from wandering the tree off into empty space
// with no way back except re-fitting. Constrains panning to the tree's own
// footprint (plus a card's worth of margin so the outermost cards aren't
// flush against the edge), read straight from each rendered card's own
// position rather than family-chart's internal layout math (see
// correctLinkTextTransform's CARD_WIDTH comment for why: not exposed to
// read from here either way, and this reads what's actually on screen,
// which stays correct across orientations without needing to know which
// screen axis is "depth" this time). d3's translateExtent scales the
// pannable range with the current zoom level on its own, so this stays
// correct whether zoomed out to fit everything or zoomed in tight — it
// never traps part of the tree outside where a pan can reach it.
function applyPanBounds(container: HTMLElement) {
  const canvasEl = container.querySelector<HTMLElement & { __zoomObj?: ZoomBehaviorLike }>("#f3Canvas");
  const zoomObj = canvasEl?.__zoomObj;
  if (!zoomObj) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  container.querySelectorAll<HTMLElement>(".card[data-id]").forEach((card) => {
    const wrapper = card.parentElement;
    const style = wrapper?.getAttribute("style");
    const match = style?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (!match) return;
    const x = Number(match[1]);
    const y = Number(match[2]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  if (!Number.isFinite(minX)) return;

  const MARGIN = 220;
  zoomObj.translateExtent([
    [minX - MARGIN, minY - MARGIN],
    [maxX + MARGIN, maxY + MARGIN],
  ]);
}

// Resolves once every g.link-text's `transform` attribute has stopped
// changing for `quietMs` — used before a tree-image capture (see
// handleExportTreeImage) instead of a fixed delay, since a fit-all's own
// d3 transition (and correctLinkTextTransform's own settle-correction
// chasing it) can take a variable amount of time depending on how much
// the tree actually moved. `maxWaitMs` is just a safety net in case
// something never truly goes quiet.
function waitForLinkTextSettle(container: HTMLElement, quietMs = 200, maxWaitMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer: number | undefined;
    let hardCap: number | undefined;
    const done = () => {
      observer.disconnect();
      window.clearTimeout(quietTimer);
      window.clearTimeout(hardCap);
      resolve();
    };
    const observer = new MutationObserver(() => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(done, quietMs);
    });
    observer.observe(container, { attributes: true, attributeFilter: ["transform"], subtree: true });
    quietTimer = window.setTimeout(done, quietMs);
    hardCap = window.setTimeout(done, maxWaitMs);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "c." (circa) in front of an approximate year — exact/unknown precision
// years are shown plain.
function yearLabel(year: number | undefined, precision: unknown): string | null {
  if (year === undefined) return null;
  return precision === "ABOUT" ? i18n.t("common.circaYear", { year }) : String(year);
}

function formatLifespan(
  birthYear: number | undefined,
  deathYear: number | undefined,
  birthPrecision: unknown,
  deathPrecision: unknown,
): string {
  const birth = yearLabel(birthYear, birthPrecision);
  const death = yearLabel(deathYear, deathPrecision);
  if (birth && death) return i18n.t("common.lifespanRange", { birth, death });
  if (birth) return i18n.t("common.bornYear", { value: birth });
  if (death) return i18n.t("common.diedYear", { value: death });
  return "";
}

// family-chart's TreeDatum — loosely typed to match its own (`any`-valued)
// Datum.data, since we only read a few known keys off it here.
type CardDatum = { data: { id: string; data: Record<string, unknown> } };

// The card body itself stays a compact summary (name + birth surname, so
// the lineage-highlight chips still make sense at a glance, + a lifespan
// line) — the expand button opens the full record instead of growing the
// card in place, which would overlap neighboring cards in the tree layout.
// Lucide's "message-square-text" glyph (MIT) — a rounded speech bubble
// with a couple of lines inside, standing in for the plain "ⓘ" character
// that didn't read as an inviting "see more" affordance.
const EXPAND_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 8h10"/><path d="M7 12h6"/></svg>`;

// Lucide's "pencil" glyph — same path data as Icons.tsx's PencilIcon,
// duplicated here as a raw string since cardTemplate builds plain HTML
// (family-chart owns that DOM, not React).
const EDIT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .622.622l4.353-1.321a2 2 0 0 0 .83-.497Z"/><path d="m15 5 4 4"/></svg>`;

// Same glyph as Icons.tsx's LinkIcon — the "create a relationship" affordance,
// now living on the card itself (see .card-relate-toggle's drag-to-link
// wiring in wireCardAndUnionClicks) instead of only a global button.
const RELATE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

// Lucide's "chevrons-up" glyph — sits in the card's one remaining free
// corner, and (unlike the three above) is only ever shown on cards whose
// own recorded parents aren't part of the currently-rendered tree: a
// spouse who married into the family, whose own ancestry is real data but
// never gets drawn from the current root (see wireCardAndUnionClicks,
// where visibility is decided per render from cardIds + rels.parents).
const ANCESTRY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/></svg>`;

// Lucide's "user" glyph — the neutral placeholder shown on a card when the
// person has no uploaded photo.
const PERSON_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`;

function cardTemplate(d: CardDatum): string {
  const data = d.data.data;
  const name = escapeHtml(`${data["first name"] ?? ""} ${data["last name"] ?? ""}`.toString().trim());
  const alias = data.alias ? escapeHtml(String(data.alias)) : "";
  const birthName = data["birth name"] ? escapeHtml(String(data["birth name"])) : "";
  const lifespan = formatLifespan(
    data.birthYear as number | undefined,
    data.deathYear as number | undefined,
    data.birthPrecision,
    data.deathPrecision,
  );
  const avatarHtml = data.avatar
    ? `<img class="card-avatar" src="${escapeHtml(mediaUrl(String(data.avatar)))}" alt="" />`
    : `<div class="card-avatar card-avatar-placeholder">${PERSON_ICON_SVG}</div>`;
  return `
    <div class="card-inner" data-person-id="${d.data.id}">
      ${avatarHtml}
      <div class="card-text">
        <div class="card-name name-text">${name}</div>
        ${alias ? `<div class="card-alias alias-text">«${alias}»</div>` : ""}
        ${birthName ? `<div class="card-birthname name-text">${birthName}</div>` : ""}
        ${lifespan ? `<div class="card-lifespan">${escapeHtml(lifespan)}</div>` : ""}
      </div>
    </div>
    <button type="button" class="card-expand-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("card.viewFull"))}" aria-label="${escapeHtml(i18n.t("card.viewFull"))}">${EXPAND_ICON_SVG}</button>
    <button type="button" class="card-edit-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("app.edit"))}" aria-label="${escapeHtml(i18n.t("app.edit"))}">${EDIT_ICON_SVG}</button>
    <button type="button" class="card-relate-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("card.relate"))}" aria-label="${escapeHtml(i18n.t("card.relate"))}">${RELATE_ICON_SVG}</button>
    <button type="button" class="card-ancestry-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("card.moreAncestry"))}" aria-label="${escapeHtml(i18n.t("card.moreAncestry"))}">${ANCESTRY_ICON_SVG}</button>
  `;
}

// Notes/biography are free text a user typed — split on blank lines so
// each paragraph becomes its own bullet instead of one giant block.
function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildPersonInfoPanel(person: TreePerson): InfoPanelData {
  const d = person.data;
  const sections: InfoPanelSection[] = [];

  const identity: string[] = [];
  const surnameLine = [d["last name"], d["birth name"]].filter(Boolean).join(" ");
  if (surnameLine) identity.push(i18n.t("infoPanel.surnames", { value: surnameLine }));
  if (d.alias) identity.push(i18n.t("infoPanel.alias", { value: String(d.alias) }));
  const sexKey = d.gender === "F" ? "FEMALE" : d.gender === "M" ? "MALE" : "UNKNOWN";
  identity.push(i18n.t("infoPanel.sexLine", { value: i18n.t(`sex.${sexKey}`) }));
  sections.push({ heading: i18n.t("infoPanel.sectionIdentity"), items: identity });

  const birth = [d.birthday, d["birth place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
  sections.push({ heading: i18n.t("infoPanel.sectionBirth"), items: birth.length ? birth : [i18n.t("infoPanel.unknown")] });

  if (d.deathday || d["death place"]) {
    const death = [d.deathday, d["death place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
    sections.push({ heading: i18n.t("infoPanel.sectionDeath"), items: death });
  }

  if (d.notes) sections.push({ heading: i18n.t("infoPanel.sectionNotes"), items: splitLines(String(d.notes)) });
  if (d.biography) sections.push({ heading: i18n.t("infoPanel.sectionBiography"), items: splitLines(String(d.biography)) });

  return {
    icon: <UserIcon size={20} />,
    iconClassName:
      d.gender === "F" ? "info-panel-icon-female" : d.gender === "M" ? "info-panel-icon-male" : "info-panel-icon-other",
    photoUrl: d.avatar ? mediaUrl(String(d.avatar)) : undefined,
    title: `${d["first name"]} ${d["last name"]}`.trim(),
    subtitle: d["birth name"] ? String(d["birth name"]) : undefined,
    personId: person.id,
    sections,
  };
}

function buildUnionInfoPanel(union: UnionInfo, people: TreePerson[]): InfoPanelData {
  const partner1 = people.find((p) => p.id === union.partner1Id);
  const partner2 = people.find((p) => p.id === union.partner2Id);
  const name = (p?: TreePerson) => (p ? `${p.data["first name"]} ${p.data["last name"]}`.trim() : "?");

  // Both partners are already fixed for a union, so a child of theirs is
  // simply anyone whose parent list contains both ids — no separate
  // per-family child lookup needed, `rels.parents` already has it.
  const children = people
    .filter((p) => p.rels.parents.includes(union.partner1Id) && p.rels.parents.includes(union.partner2Id))
    .map((p) => ({ id: p.id, name: name(p) }));

  // Was previously empty — InfoPanel's own edit-only sub-components
  // (UnionDetailsEditor etc., driven by the separate `union`/`familyId`
  // fields below) covered this when the full panel was opened by clicking,
  // but HoverPreview only ever renders `sections`, so a hovered union mark
  // showed nothing beyond its own two names. Same read-only wording
  // UnionDetailsEditor/UnionChildrenEditor already use, just not gated
  // behind a click.
  const sections: InfoPanelSection[] = [
    {
      heading: i18n.t("infoPanel.unionHeading"),
      items: [
        i18n.t("infoPanel.unionType", { value: i18n.t(`unionType.${union.unionType}`) }),
        i18n.t("infoPanel.unionStatus", { value: i18n.t(`unionStatus.${union.unionStatus}`) }),
        i18n.t("infoPanel.unionDate", { value: union.unionDateText || i18n.t("infoPanel.unknownDate") }),
        ...(union.unionPlace ? [i18n.t("infoPanel.unionPlace", { value: union.unionPlace })] : []),
      ],
    },
  ];
  if (union.notes) sections.push({ heading: i18n.t("infoPanel.sectionNotes"), items: splitLines(union.notes) });
  if (children.length > 0) {
    sections.push({ heading: i18n.t("editPerson.childrenLegend"), items: children.map((c) => c.name) });
  }

  return {
    icon: <UnionMarkIcon unionType={union.unionType} unionStatus={union.unionStatus} />,
    iconClassName: "info-panel-icon-union",
    title: `${name(partner1)} & ${name(partner2)}`,
    subtitle: union.order >= 2 ? i18n.t("infoPanel.unionOrder", { order: union.order }) : undefined,
    sections,
    familyId: union.id,
    notes: union.notes,
    union: {
      unionType: union.unionType,
      unionStatus: union.unionStatus,
      unionDateText: union.unionDateText,
      unionPlace: union.unionPlace,
      partner1Id: union.partner1Id,
      partner2Id: union.partner2Id,
      children,
    },
  };
}

function App() {
  const { t } = useTranslation();
  const { treeId } = useParams<{ treeId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const relateOverlayRef = useRef<SVGSVGElement>(null);
  const relateDragTargetRef = useRef<HTMLElement | null>(null);
  const chartRef = useRef<ReturnType<typeof f3.createChart> | null>(null);
  const backStackRef = useRef<string[]>([]);
  const depthModeRef = useRef<"default" | "fitAll">("default");
  const currentMainIdRef = useRef<string | null>(null);
  const isGoingBackRef = useRef(false);
  const treeDataRef = useRef<TreePerson[]>([]);
  const unionsByPairKeyRef = useRef<Map<string, UnionInfo>>(new Map());
  const linkTextCleanupRef = useRef<Array<() => void>>([]);
  const selectedLineageIdsRef = useRef<Set<string>>(new Set());
  const lineageMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuCloseTimerRef = useRef<number | undefined>(undefined);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showLineagesManage, setShowLineagesManage] = useState(false);
  const [derivingLineages, setDerivingLineages] = useState(false);
  const [deriveLineagesMessage, setDeriveLineagesMessage] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showLinkPeople, setShowLinkPeople] = useState(false);
  const [showGedcom, setShowGedcom] = useState(false);
  const [wizardIds, setWizardIds] = useState<string[] | null>(null);
  const [noUnrelatedMessage, setNoUnrelatedMessage] = useState(false);
  // Set by dragging a relation branch from one card onto another (see
  // startRelateDrag) — both people are already chosen, unlike
  // showLinkPeople's blank "pick two people" entry point.
  const [relateDraft, setRelateDraft] = useState<{ personAId: string; personBId: string } | null>(null);
  const [treeData, setTreeData] = useState<TreePerson[]>([]);
  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [selectedLineageIds, setSelectedLineageIds] = useState<Set<string>>(new Set());
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [treeName, setTreeName] = useState("");
  const [treeRole, setTreeRole] = useState<TreeRole | null>(null);
  const [treeMemberCount, setTreeMemberCount] = useState(1);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showLineageMenu, setShowLineageMenu] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png" | "svg">("png");
  const [exportBackground, setExportBackground] = useState<"opaque" | "transparent">("opaque");
  const [exportQuality, setExportQuality] = useState<"standard" | "high">("high");
  const [exportScope, setExportScope] = useState<"current" | "whole">("whole");
  // Synced to the live `orientation` state whenever the export menu opens
  // (see the trigger button below) — a reasonable default of "whatever
  // you're currently looking at" without permanently coupling the two.
  const [exportOrientation, setExportOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">(getDefaultOrientation);
  // wireCardAndUnionClicks (below) is a long-lived useCallback that doesn't
  // list `orientation` as a dependency — correctLinkTextTransform's settle
  // timer can still be pending from before an orientation toggle, so it
  // reads this ref instead of the closed-over state to always use the
  // orientation current at the moment it actually runs.
  const orientationRef = useRef(orientation);
  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);
  const [exportingImage, setExportingImage] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ data: InfoPanelData; x: number; y: number; flip: boolean } | null>(
    null,
  );
  const hoverTimerRef = useRef<number | undefined>(undefined);

  const runHighlight = useCallback(() => {
    if (!containerRef.current) return;
    applyLineageHighlight(containerRef.current, treeDataRef.current, selectedLineageIdsRef.current);
  }, []);

  // Pressing a card's relate button and dragging draws a curved "branch"
  // from that card to the pointer, tracking document-level pointer events
  // (not the small button itself) so the drag keeps working once the
  // cursor leaves the button. Dropping it on another card's data-person-id
  // opens LinkPeopleModal pre-filled with both people; dropping on empty
  // space just cancels. Plain DOM/refs throughout (like the rest of this
  // file's family-chart wiring) — no React re-render during the drag.
  const startRelateDrag = useCallback((sourcePersonId: string, startEvent: PointerEvent) => {
    const overlay = relateOverlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const startX = startEvent.clientX - rect.left;
    const startY = startEvent.clientY - rect.top;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "branch-drag-path");
    overlay.appendChild(path);

    function updatePath(x: number, y: number) {
      const dx = x - startX;
      const dy = y - startY;
      // A gentle curve instead of a straight line reads more like a
      // branch reaching out than a ruler-drawn connector.
      const midX = startX + dx / 2 - dy * 0.15;
      const midY = startY + dy / 2 + dx * 0.15;
      path.setAttribute("d", `M ${startX} ${startY} Q ${midX} ${midY} ${x} ${y}`);
    }
    updatePath(startX, startY);

    function clearTarget() {
      relateDragTargetRef.current?.classList.remove("relate-target");
      relateDragTargetRef.current = null;
    }

    function findTarget(clientX: number, clientY: number): { id: string; card: HTMLElement } | null {
      const el = document.elementFromPoint(clientX, clientY);
      const personEl = el?.closest<HTMLElement>("[data-person-id]");
      const id = personEl?.dataset.personId;
      if (!id || id === sourcePersonId) return null;
      return { id, card: personEl.closest<HTMLElement>(".card") ?? personEl };
    }

    function onMove(e: PointerEvent) {
      updatePath(e.clientX - rect.left, e.clientY - rect.top);
      const found = findTarget(e.clientX, e.clientY);
      if (found?.card !== relateDragTargetRef.current) {
        clearTarget();
        if (found) {
          found.card.classList.add("relate-target");
          relateDragTargetRef.current = found.card;
        }
      }
    }

    function onUp(e: PointerEvent) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const found = findTarget(e.clientX, e.clientY);
      clearTarget();
      path.remove();
      if (found) setRelateDraft({ personAId: sourcePersonId, personBId: found.id });
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  // Re-run after every tree render: family-chart rebuilds the card/link DOM
  // from scratch each time, so any handler attached to it has to be
  // reattached rather than registered once.
  const wireCardAndUnionClicks = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.querySelectorAll<HTMLButtonElement>(".card-expand-toggle").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const person = treeDataRef.current.find((p) => p.id === btn.dataset.personId);
        if (person) setInfoPanel(buildPersonInfoPanel(person));
      };
    });

    // Opens the edit form for exactly the person whose card was clicked —
    // no more "edit the currently centered person" indirection.
    container.querySelectorAll<HTMLButtonElement>(".card-edit-toggle").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (btn.dataset.personId) setEditingPersonId(btn.dataset.personId);
      };
    });

    container.querySelectorAll<HTMLButtonElement>(".card-relate-toggle").forEach((btn) => {
      btn.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (btn.dataset.personId) startRelateDrag(btn.dataset.personId, e);
      };
    });

    // A real (non-placeholder) avatar opens a full-size view instead of
    // re-centering the tree the way clicking the rest of the card does.
    container.querySelectorAll<HTMLImageElement>(".card-avatar:not(.card-avatar-placeholder)").forEach((img) => {
      img.onclick = (e) => {
        e.stopPropagation();
        setLightboxUrl(img.src);
      };
    });

    // A quick, read-only peek at a card's extended info after the pointer
    // rests on it for a second — mouseenter/mouseleave only, so it never
    // fires on touch (where "hovering" isn't a real gesture anyway). Any
    // pending timer or open preview is torn down whenever the tree
    // re-renders (this whole function reruns), since the card it was
    // anchored to may have moved or been replaced.
    window.clearTimeout(hoverTimerRef.current);
    setHoverPreview(null);
    container.querySelectorAll<HTMLElement>(".card-inner[data-person-id]").forEach((card) => {
      const personId = card.dataset.personId;
      card.onmouseenter = () => {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => {
          const person = personId ? treeDataRef.current.find((p) => p.id === personId) : undefined;
          const containerEl = containerRef.current;
          if (!person || !containerEl) return;
          const cardRect = card.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          const relativeTop = cardRect.top - containerRect.top;
          setHoverPreview({
            data: buildPersonInfoPanel(person),
            // Viewport-absolute, not container-relative — see HoverPreview.tsx:
            // it's portaled to document.body and positioned with `fixed`.
            x: cardRect.left + cardRect.width / 2,
            y: cardRect.top,
            // Not enough room above the card to grow upward without
            // clipping out of view — anchor below it instead.
            flip: relativeTop < 220,
          });
        }, 1000);
      };
      card.onmouseleave = () => {
        window.clearTimeout(hoverTimerRef.current);
        setHoverPreview(null);
      };
      card.onmousedown = () => {
        window.clearTimeout(hoverTimerRef.current);
        setHoverPreview(null);
      };
    });

    linkTextCleanupRef.current.forEach((cleanup) => cleanup());
    linkTextCleanupRef.current = [];

    // A real family tree can have genealogical loops (a marriage between
    // relatives — someone reachable from the centered person by two
    // different chains of parents/children) that a 2D tree diagram can't
    // draw twice: family-chart still computes a connecting line/mark for
    // the path whose card lost that name collision, but nothing is ever
    // rendered there for it to point to. Rather than leave those dangling
    // over blank space, anything referencing a person with no rendered
    // card here gets hidden instead — the person's real relationships are
    // never affected, they just aren't all drawn from every angle in the
    // same view.
    const cardIds = new Set(
      [...container.querySelectorAll<HTMLElement>(".card-inner[data-person-id]")].map((el) => el.dataset.personId),
    );

    // Shows the "more ancestry" corner icon only on a card whose own
    // recorded parents aren't part of this render — a spouse who married
    // into the family, most commonly, since their ancestry is real data
    // that just never gets drawn from whichever root the current view
    // picked. Clicking it re-centers on them, the same as clicking the
    // card itself, which is what actually reveals that ancestry.
    //
    // Which cards exist at all is still settling when this synchronous
    // afterUpdate callback runs (family-chart's add/remove diff briefly
    // shows a transitional superset of old+new cards before landing on
    // the final set) — computing against that snapshot once and never
    // again left a card that just lost/gained a rendered parent stuck
    // with a stale icon state forever. A MutationObserver on the
    // container catches whenever cards actually finish being added or
    // removed and recomputes then, the same "wait for it to settle"
    // approach correctLinkTextTransform already uses for transforms.
    function updateAncestryToggles() {
      // TS can't carry the `if (!container) return` narrowing above into a
      // function that (via the MutationObserver below) can be called
      // asynchronously — this alias is just to satisfy that; `container`
      // itself doesn't change for as long as this closure is alive.
      const el = container as HTMLDivElement;
      const currentCardIds = new Set(
        [...el.querySelectorAll<HTMLElement>(".card-inner[data-person-id]")].map((card) => card.dataset.personId),
      );
      el.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
        const personId = btn.dataset.personId;
        const person = personId ? treeDataRef.current.find((p) => p.id === personId) : undefined;
        const hasUnrenderedParent = person?.rels.parents.some((parentId) => !currentCardIds.has(parentId)) ?? false;
        btn.style.display = hasUnrenderedParent ? "" : "none";
      });
    }
    updateAncestryToggles();
    applyPanBounds(container);

    let ancestrySettleTimer: number | undefined;
    const scheduleAncestryUpdate = () => {
      window.clearTimeout(ancestrySettleTimer);
      ancestrySettleTimer = window.setTimeout(() => {
        updateAncestryToggles();
        // Cards keep the same identity but land at new positions on an
        // orientation toggle or a re-center — no childList change to catch
        // that, only the style attribute each card's wrapper moves with
        // (also watched below), so the pan bounds need recomputing here
        // too, not just when cards are actually added or removed.
        applyPanBounds(container);
      }, 150);
    };
    scheduleAncestryUpdate();
    const cardSetObserver = new MutationObserver(scheduleAncestryUpdate);
    cardSetObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    linkTextCleanupRef.current.push(() => {
      window.clearTimeout(ancestrySettleTimer);
      cardSetObserver.disconnect();
    });

    container.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
      const personId = btn.dataset.personId;
      btn.onclick = (e) => {
        e.stopPropagation();
        const chart = chartRef.current;
        if (!chart || !personId) return;
        chart.updateMainId(personId);
        chart.updateTree({});
      };
    });

    container.querySelectorAll<SVGPathElement>("path.link").forEach((p) => {
      const datum = (p as unknown as { __data__?: PathLinkDatum }).__data__;
      if (!datum) return;
      const sources = Array.isArray(datum.source) ? datum.source : [datum.source];
      // A single-parent family's missing other-parent slot isn't always a
      // bare null/undefined — family-chart can leave a placeholder node
      // there with no `.data.id` at all, which needs the same tolerance.
      const orphaned = [...sources, datum.target]
        .filter((node): node is PathLinkNode => node?.data?.id != null)
        .some((node) => !cardIds.has(node.data.id));
      p.style.display = orphaned ? "none" : "";
    });

    // The connecting line itself is the interactive surface for a union —
    // no more floating icon on the live canvas at all (see unionMarkIcons.tsx
    // and correctLinkTextTransform's own comment for the collision problems
    // that used to cause across both orientations: overlapping the line in
    // vertical mode, landing inside a spouse's own card in horizontal mode).
    // A larger, clearer icon now only ever appears in the hover-preview
    // below, which already has its own dedicated space off to the side —
    // correctLinkTextTransform/unionMarkMarkup still exist, used only by
    // handleExportTreeImage's static snapshot, which has no such preview to
    // fall back on.
    //
    // family-chart binds a plain object (source[s]/target) onto each
    // path.link — a spouse-to-spouse line has a single (non-array) source,
    // unlike a child's link to two parents, which is exactly the shape that
    // distinguishes the union lines worth wiring up here from everything
    // else this same selector matches.
    type UnionLineEntry = {
      p: SVGPathElement;
      union: UnionInfo;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      axis: "x" | "y"; // whichever coordinate is constant along this row/column
    };
    const unionLineEntries: UnionLineEntry[] = [];

    container.querySelectorAll<SVGPathElement>("path.link").forEach((p) => {
      const datum = (p as unknown as { __data__?: PathLinkDatum }).__data__;
      const source = datum && !Array.isArray(datum.source) ? datum.source : null;
      const union =
        source?.data?.id && datum!.target.data?.id
          ? unionsByPairKeyRef.current.get(pairKey(source.data.id, datum!.target.data.id))
          : undefined;

      if (!union || typeof source!.x !== "number" || typeof source!.y !== "number") {
        const nextEl = p.nextElementSibling;
        if (nextEl?.classList.contains("union-line-hitarea")) nextEl.remove();
        p.classList.remove("union-line");
        p.onclick = null;
        p.onmouseenter = null;
        p.onmouseleave = null;
        return;
      }

      const target = datum!.target;
      unionLineEntries.push({
        p,
        union,
        x1: source!.x,
        y1: source!.y,
        x2: target.x ?? source!.x,
        y2: target.y ?? source!.y,
        axis: source!.y === target.y ? "y" : "x",
      });
    });

    // family-chart draws a straight line from each spouse's own laid-out
    // position to the other's — fine for the common case, but when someone
    // has two-plus spouses in the same row, the line to a *non-adjacent*
    // one is drawn straight through the card (and that card's own spouse
    // line) sitting between them, rather than routing around it. The two
    // lines then physically overlap along that shared stretch, so hovering
    // anywhere in it always resolved to whichever one happened to sit on
    // top in DOM order, regardless of which line the pointer was actually
    // over — reported as one relationship's hover always winning no matter
    // which line you point at. Detecting that overlap and bumping the
    // longer (non-adjacent) line out to its own parallel lane — a small
    // perpendicular jog in and back out, not a straight shift, so it still
    // touches both cards' exact real positions at each end — gives every
    // union its own real, unshared pixels to hover. The step has to clear
    // more than just the *visible* dotted lines — each one's actual hit
    // area (union-line-hitarea) is a much fatter invisible stroke, and two
    // lines only 8 units apart still had their fat hit-strokes overlapping
    // even once the thin visible lines themselves looked clearly separate
    // (confirmed the hard way: clicking the visibly-separate lower line
    // kept resolving to the upper one). The bumped line's own hit-stroke is
    // also narrowed below, so the step only needs to clear a normal-width
    // and a narrowed one, not two full-width ones.
    const OVERLAP_STEP = 18;
    const rowGroups = new Map<string, UnionLineEntry[]>();
    unionLineEntries.forEach((entry) => {
      const key = `${entry.axis}:${Math.round(entry.axis === "y" ? entry.y1 : entry.x1)}`;
      const group = rowGroups.get(key);
      if (group) group.push(entry);
      else rowGroups.set(key, [entry]);
    });
    const overlapLevelByEntry = new Map<UnionLineEntry, number>();
    rowGroups.forEach((group) => {
      if (group.length < 2) return;
      const ranges = group
        .map((entry) => {
          const a = entry.axis === "y" ? entry.x1 : entry.y1;
          const b = entry.axis === "y" ? entry.x2 : entry.y2;
          return { entry, lo: Math.min(a, b), hi: Math.max(a, b) };
        })
        // Shortest (almost always the common, adjacent-spouse case) first,
        // so it's the one left at level 0 — untouched, in its usual spot —
        // and only the rarer, longer, non-adjacent line(s) get bumped.
        .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
      const placed: { lo: number; hi: number; level: number }[] = [];
      ranges.forEach(({ entry, lo, hi }) => {
        let level = 0;
        for (const existing of placed) {
          if (lo < existing.hi && existing.lo < hi) level = Math.max(level, existing.level + 1);
        }
        placed.push({ lo, hi, level });
        if (level > 0) overlapLevelByEntry.set(entry, level);
      });
    });

    unionLineEntries.forEach((entry) => {
      const { p, union, x1, y1, x2, y2, axis } = entry;
      const overlapLevel = overlapLevelByEntry.get(entry) ?? 0;
      const bump = overlapLevel * OVERLAP_STEP;
      const computeD = () =>
        bump === 0
          ? `M${x1},${y1}L${x2},${y2}`
          : axis === "y"
            ? `M${x1},${y1}L${x1},${y1 + bump}L${x2},${y2 + bump}L${x2},${y2}`
            : `M${x1},${y1}L${x1 + bump},${y1}L${x2 + bump},${y2}L${x2},${y2}`;

      p.classList.add("union-line");
      const nextEl = p.nextElementSibling;
      let hit = nextEl?.classList.contains("union-line-hitarea") ? (nextEl as SVGPathElement) : null;
      // A separate, much-wider transparent stroke rather than widening
      // path.link's own visible stroke — same idea as the old icon's own
      // padded hit rect, just along a line instead of around a shape. A
      // bumped line gets a narrower one than the default 22px (set in CSS)
      // — see the OVERLAP_STEP comment above for why: it's what actually
      // lets the step above stay small enough not to crowd a tight
      // vertical-mode row, while still keeping every union's hit area
      // comfortably its own.
      if (!hit) {
        hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hit.setAttribute("class", "union-line-hitarea");
        p.insertAdjacentElement("afterend", hit);
      }
      hit.style.strokeWidth = overlapLevel > 0 ? "10px" : "";

      // The endpoints above (from the datum, not from reading p's own `d`
      // back out) are already this render's real, settled answer — no need
      // to wait on anything to compute them. What still needs a settle
      // step is applying them: family-chart's own d3 transition keeps
      // interpolating `d` toward its own (unbumped) target for as long as
      // the transition runs, fighting a one-time overwrite here. Re-
      // applying once things go quiet — the same approach
      // correctLinkTextTransform used to need for the old floating mark —
      // lands it correctly once the tug-of-war ends, rather than trying to
      // win every single animation frame. `lastApplied` guards against
      // reacting to this same code's own writes, which would otherwise
      // never let the observer settle.
      let lastApplied: string | null = null;
      const apply = () => {
        const d = computeD();
        lastApplied = d;
        p.setAttribute("d", d);
        hit!.setAttribute("d", d);
      };
      apply();

      let settleTimer: number | undefined;
      const scheduleApply = () => {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(apply, 120);
      };
      const observer = new MutationObserver(() => {
        if (p.getAttribute("d") !== lastApplied) scheduleApply();
      });
      observer.observe(p, { attributes: true, attributeFilter: ["d"] });
      linkTextCleanupRef.current.push(() => {
        window.clearTimeout(settleTimer);
        observer.disconnect();
      });

      const handleClick = (e: MouseEvent) => {
        e.stopPropagation();
        setInfoPanel(buildUnionInfoPanel(union, treeDataRef.current));
      };
      // Same 1-second hover-preview a card gets — this is now the only
      // place the union's own icon(s) render at all on the live canvas, at
      // a size worth actually seeing rather than a few px on the line.
      const handleEnter = () => {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => {
          const containerEl = containerRef.current;
          if (!containerEl) return;
          const rect = hit!.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          const relativeTop = rect.top - containerRect.top;
          setHoverPreview({
            data: buildUnionInfoPanel(union, treeDataRef.current),
            // Viewport-absolute — see the person-hover setHoverPreview above.
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            flip: relativeTop < 220,
          });
        }, 1000);
      };
      const handleLeave = () => {
        window.clearTimeout(hoverTimerRef.current);
        setHoverPreview(null);
      };
      hit.onclick = handleClick;
      hit.onmouseenter = handleEnter;
      hit.onmouseleave = handleLeave;
    });
  }, [startRelateDrag]);

  const loadTree = useCallback(
    async (recenterOnId?: string) => {
      if (!treeId) return;
      const { name, role, memberCount, people, unions } = await fetchTree(treeId);
      if (!containerRef.current) return;
      setTreeName(name);
      setTreeRole(role);
      setTreeMemberCount(memberCount);
      if (!people.length) {
        setError(t("app.noIndividuals"));
        return;
      }

      treeDataRef.current = people;
      setTreeData(people);
      unionsByPairKeyRef.current = new Map(
        unions.map((u) => [pairKey(u.partner1Id, u.partner2Id), u]),
      );

      if (!chartRef.current) {
        const chart = f3.createChart(containerRef.current, people as unknown as ChartData);
        const card = chart.setCardHtml();
        // Fallback rows for the rare library-internal placeholder cards
        // (e.g. "add relative" UI) that bypass cardInnerHtmlCreator — the
        // real cards below are built from cardTemplate instead.
        card.setCardDisplay([["first name", "last name"], ["birth name"]]);
        card.setCardInnerHtmlCreator(cardTemplate);
        // The very first render of a tree opens on the widest view (same
        // depth + top-ancestor centering as "ver todo el árbol") rather
        // than a narrow 3-generation slice — landing on a view where half
        // the family is invisible until you go hunt for the right button
        // isn't a good first impression. Later navigation still narrows
        // back down to DEFAULT_DEPTH (see handleBack).
        depthModeRef.current = "fitAll";
        chart.setAncestryDepth(FIT_ALL_DEPTH);
        chart.setProgenyDepth(FIT_ALL_DEPTH);
        // Off by default in family-chart — without this, the centered
        // person's own brothers/sisters vanish from the canvas (they only
        // show up when a parent is centered instead, since siblings are
        // then rendered as that parent's children).
        chart.setShowSiblingsOfMain(true);
        // family-chart otherwise auto-inserts a client-only "unknown spouse"
        // placeholder card for anyone with children but only one recorded
        // parent. That card has a generated id with no backing Individual
        // row, but our cardTemplate still puts edit/expand buttons on it —
        // clicking edit 404s ("No existe el individuo ..."), and clicking
        // the card itself re-centers the whole tree on that dead end. The
        // app has no UI wired to family-chart's own "fill in this spouse"
        // form, so the placeholder is pure confusion; disable it entirely.
        chart.setSingleParentEmptyCard(false);

        // family-chart always creates a <text> here regardless of what this
        // returns (it only ever calls .text() on it) — the actual marriage/
        // divorce/etc. mark is real icons injected onto this same <g> in
        // wireCardAndUnionClicks below, which hides this text and builds
        // the icons from the same union lookup. Nothing here needs to
        // render, so there's nothing useful to return.
        chart.setLinkSpouseText(() => "");

        // Clicking a card, or navigating via the timeline, re-centers the
        // tree (chart.updateMainId internally). Track that in our own stack
        // so a "back" button can undo it — the library only keeps main-id
        // history to recover from a deleted person, not for navigation.
        chart.setAfterUpdate(() => {
          const newMainId = chart.getMainDatum().id;
          if (newMainId !== currentMainIdRef.current) {
            if (!isGoingBackRef.current && currentMainIdRef.current) {
              backStackRef.current.push(currentMainIdRef.current);
              setCanGoBack(true);
            }
            isGoingBackRef.current = false;
            currentMainIdRef.current = newMainId;
            // Navigating to someone else makes a pinned lineage highlight
            // stale — without this, everyone stays dimmed with no way to
            // tell why, since the chip itself still looks selected.
            if (selectedLineageIdsRef.current.size > 0) {
              selectedLineageIdsRef.current = new Set();
              setSelectedLineageIds(new Set());
            }
          }
          runHighlight();
          wireCardAndUnionClicks();
        });

        chart.updateMainId(findTopAncestorId(people[0].id, people));
        chart.updateTree({ initial: true, tree_position: "fit" });
        chartRef.current = chart;
        currentMainIdRef.current = chart.getMainDatum().id;
        return;
      }

      chartRef.current.updateData(people as unknown as ChartData);
      if (recenterOnId) {
        chartRef.current.updateMainId(recenterOnId);
      }
      chartRef.current.updateTree({});
      currentMainIdRef.current = chartRef.current.getMainDatum().id;
    },
    [runHighlight, wireCardAndUnionClicks, t, treeId],
  );

  useEffect(() => {
    let cancelled = false;

    // A tree switch (navigating from one /tree/:id to another) needs a
    // fresh chart instance — the cached one belongs to the previous tree's
    // DOM/data and can't just be fed new data via updateData.
    chartRef.current = null;
    backStackRef.current = [];
    setCanGoBack(false);
    setLoading(true);
    setError(null);

    loadTree()
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadTree, treeId]);

  useEffect(() => {
    return () => {
      linkTextCleanupRef.current.forEach((cleanup) => cleanup());
      linkTextCleanupRef.current = [];
    };
  }, []);

  // family-chart only fits the tree to its container at chart creation and
  // on explicit navigation (handleFitAll, handleBack, etc.) — never in
  // response to the container itself changing size. Moving the browser
  // window to a bigger monitor (or just maximizing it) after the tree has
  // already rendered leaves every card and connecting line positioned for
  // the old, smaller container: visually, lines end up running to where a
  // card used to be rather than where it now is. Debounced so a drag-resize
  // doesn't re-fit on every intermediate frame.
  useEffect(() => {
    let resizeTimer: number | undefined;
    function handleResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        chartRef.current?.updateTree({ tree_position: "fit" });
      }, 200);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!treeId) return;
    fetchLineages(treeId)
      .then(setLineages)
      .catch(() => {
        // Purely a navigation aid — the tree itself still works without it.
      });
  }, [treeId]);

  useEffect(() => {
    selectedLineageIdsRef.current = selectedLineageIds;
    runHighlight();
  }, [selectedLineageIds, runHighlight]);

  useEffect(() => {
    if (!showLineageMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (lineageMenuRef.current && !lineageMenuRef.current.contains(target)) {
        setShowLineageMenu(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showLineageMenu]);

  useEffect(() => {
    if (!headerMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (headerMenuRef.current && !headerMenuRef.current.contains(target)) {
        setHeaderMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!showExportMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setShowExportMenu(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showExportMenu]);

  function handleTitleClick() {
    setTitleDraft(treeName);
    setEditingTitle(true);
  }

  function handleTitleCommit() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === treeName || !treeId) return;

    const previousName = treeName;
    setTreeName(trimmed);
    updateTreeName(treeId, trimmed).catch((err: Error) => {
      setTreeName(previousName);
      setError(err.message);
    });
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setEditingTitle(false);
    }
  }

  function handleBack() {
    const chart = chartRef.current;
    const previousId = backStackRef.current.pop();
    if (!chart || !previousId) return;

    // "Ver todo el árbol" widens how many generations render (see
    // handleFitAll below) — stepping back to a previously visited person is
    // a good moment to return to the normal focused view instead of
    // carrying that wide view forward indefinitely.
    if (depthModeRef.current === "fitAll") {
      depthModeRef.current = "default";
      chart.setAncestryDepth(DEFAULT_DEPTH);
      chart.setProgenyDepth(DEFAULT_DEPTH);
    }

    isGoingBackRef.current = true;
    chart.updateMainId(previousId);
    chart.updateTree({});
    setCanGoBack(backStackRef.current.length > 0);
  }

  // family-chart has no "show every person" mode of its own — it only ever
  // renders what's reachable from the current main person within the
  // ancestry/progeny depth limits, plus that person's own spouses and (with
  // setShowSiblingsOfMain) siblings. Critically, a *sibling's* spouse is
  // never shown that way — the library builds siblings-of-main as a special
  // case bolted on after spouse-attachment already ran, so an in-law who
  // only connects to the tree through a sibling stays invisible no matter
  // how wide the depth goes, unless that sibling is main. Re-centering on
  // the topmost known ancestor first sidesteps this entirely: from there,
  // every sibling (and cousin, and their spouses) is a genuine descendant
  // rather than a bolted-on sibling node, which is the one case the library
  // renders correctly at any depth.
  function handleFitAll() {
    const chart = chartRef.current;
    if (!chart) return;
    const topAncestorId = findTopAncestorId(chart.getMainDatum().id, treeDataRef.current);
    depthModeRef.current = "fitAll";
    chart.setAncestryDepth(FIT_ALL_DEPTH);
    chart.setProgenyDepth(FIT_ALL_DEPTH);
    chart.updateMainId(topAncestorId);
    chart.updateTree({ tree_position: "fit" });
  }

  // The PDF report (TreeReportModal, from the home screen) is a
  // generation-by-generation list with no visual diagram at all — this is
  // the "actually looks like the tree" export instead: a literal capture
  // of the live canvas, cards/connecting lines/union marks and all.
  // `transparent` skips both the flat page background and the faint tree
  // watermark behind the canvas — meant for dropping the export into
  // another document (InDesign, a scrapbook page, ...) where the caller's
  // own background should show through instead of the app's own cream.
  // `format: "svg"` sidesteps the whole raster-quality question (it's
  // vector — never pixelates at any zoom); `pixelRatio` only matters for
  // "png". `scope: "whole"` re-centers and widens depth the same way the
  // header's own fit-view button does, so the file shows everyone
  // regardless of where the view happened to be; `"current"` exports
  // exactly what's on screen right now — whoever's centered, whatever
  // depth/pan/zoom is already set. `orientation` can differ from the
  // live app's own current orientation — that's a temporary switch just
  // for this capture, restored afterward, not a real navigation.
  async function handleExportTreeImage(options: {
    transparent: boolean;
    format: "png" | "svg";
    pixelRatio: number;
    scope: "current" | "whole";
    orientation: "vertical" | "horizontal";
  }) {
    const { transparent, format, pixelRatio, scope, orientation: wantOrientation } = options;
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart || exportingImage) return;
    setExportingImage(true);
    setError(null);
    setShowExportMenu(false);
    const exportDomRestores: Array<() => void> = [];
    const originalOrientation = orientation;
    const orientationChanged = wantOrientation !== originalOrientation;
    try {
      if (orientationChanged) {
        // Same jank-hiding as handleToggleOrientation's own live switch —
        // marks visibly swim for the ~1s this transition takes otherwise,
        // and that's just as true here since this runs against the real
        // on-screen canvas, not an offscreen render.
        container.querySelectorAll<SVGGElement>("g.link-text").forEach((g) => {
          g.style.opacity = "0";
        });
        if (wantOrientation === "horizontal") chart.setOrientationHorizontal();
        else chart.setOrientationVertical();
        setOrientation(wantOrientation);
        // wireCardAndUnionClicks's settle logic reads this ref (not the
        // state above) to sidestep its own stale-closure problem — set
        // directly rather than waiting for the state update's effect to
        // run, so the very first settle after this switch already uses
        // the right axis instead of racing that effect.
        orientationRef.current = wantOrientation;
      }
      if (scope === "whole") {
        handleFitAll();
      } else if (orientationChanged) {
        // A plain re-fit, not handleFitAll's own wider re-centering —
        // switching orientation reflows the whole tree's shape (what was
        // tall is now wide), so the current pan/zoom needs to catch up,
        // but "current" scope means keeping whoever's actually centered
        // and however deep the view already goes.
        chart.updateTree({ tree_position: "fit" });
      }
      // A fixed wait here used to race the fit transition + its own
      // union-mark settle-correction: on a fast run the capture could grab
      // a g.link-text mid-transition (an intermediate, wrong transform),
      // landing marks far from where they render once actually settled —
      // reproducible, not random, just timing-dependent. Waiting for
      // transform mutations to actually go quiet (instead of guessing a
      // duration) removes the race outright.
      await waitForLinkTextSettle(container);

      // The live canvas has no permanent union-mark icon at all any more
      // (see wireCardAndUnionClicks) — a static export can't hover, so it
      // still needs one drawn in for the capture. Built fresh here rather
      // than kept sitting in the DOM the rest of the time, and torn back
      // down in the `finally` below along with every other export-only
      // change.
      const linkTextEls = container.querySelectorAll<SVGGElement>("g.link-text");
      const allLinkTextNodes = [...linkTextEls].flatMap((g) => {
        const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
        return datum ? datum.nodes : [];
      });
      linkTextEls.forEach((g) => {
        const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
        const union =
          datum && unionsByPairKeyRef.current.get(pairKey(datum.nodes[0].data.id, datum.nodes[1].data.id));
        if (!union) return;
        const markGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        markGroup.setAttribute("class", "union-mark-icons");
        markGroup.innerHTML = unionMarkMarkup(union);
        g.appendChild(markGroup);
        const originalTransform = g.getAttribute("transform");
        const corrected = correctLinkTextTransform(g, allLinkTextNodes, wantOrientation);
        if (corrected) g.setAttribute("transform", corrected);
        exportDomRestores.push(() => {
          markGroup.remove();
          if (originalTransform === null) g.removeAttribute("transform");
          else g.setAttribute("transform", originalTransform);
        });
      });

      // html-to-image clones the DOM and inlines each *HTML* element's
      // computed style onto its clone, but never does that for SVG-namespace
      // elements — so the connecting lines and union marks, which only get
      // their real color from the .f3 path.link / g.link-text stylesheet
      // rules, serialize with family-chart's own raw placeholder values
      // instead (white-on-cream, effectively invisible). Setting the actual
      // values here works around that without changing anything on screen —
      // .union-mark-icons has no competing rule of its own (nothing but the
      // CSS below ever sets its color), but since that rule is !important,
      // this inline override is invisible on screen regardless of whether
      // it's ever restored — same as the connecting-line stroke just below.
      // Black rather than the on-screen forest green, by request — reads
      // better dropped onto someone else's own document/print layout than
      // the app's own accent color would. Covers both the connecting lines
      // and the marriage/divorce/etc. marks on them.
      //
      // A union's own line additionally carries the .union-line class (see
      // wireCardAndUnionClicks) for its on-screen violet dotted glow — a
      // real CSS rule, which beats a plain presentation attribute
      // regardless of specificity, so a plain `setAttribute("stroke", ...)`
      // here wouldn't actually override it the way it does for every other
      // line. An inline *style* wins over that rule instead (nothing on it
      // is !important); the dash/glow are neutralized the same way and
      // restored after, since — unlike the color, which nothing makes
      // visible on screen while overridden — a highlighted line snapping to
      // plain black mid-interaction would be a visible flash if left in
      // place.
      container.querySelectorAll<SVGPathElement>("path.link").forEach((p) => {
        p.style.stroke = "#000000";
        if (p.classList.contains("union-line")) {
          p.style.strokeDasharray = "none";
          // The glow is a running CSS animation (see union-line-glow),
          // which keeps overriding `filter` on every frame for as long as
          // it's active — a plain inline `filter: none` alone would just
          // lose to the next frame. Stopping the animation itself first is
          // what actually lets the inline override stick.
          p.style.animation = "none";
          p.style.filter = "none";
          exportDomRestores.push(() => {
            p.style.strokeDasharray = "";
            p.style.animation = "";
            p.style.filter = "";
          });
        }
        exportDomRestores.push(() => {
          p.style.stroke = "";
        });
      });
      container.querySelectorAll<SVGGElement>("g.link-text .union-mark-icons").forEach((el) => {
        el.style.color = "#000000";
      });

      // html-to-image's own cloning (see clone-node.js's cloneCSSStyle)
      // overwrites *every* cloned element's inline style with its
      // getComputedStyle() cssText — including `transform`, which for a
      // union mark's <g> is how correctLinkTextTransform actually
      // positions it (an SVG *attribute*, not a CSS property family-chart
      // ever sets). That computed-transform round-trip comes out wrong for
      // a <g> nested inside the pan/zoomed "view" group specifically — the
      // export was landing marks far from their on-screen position. A
      // nested <svg> (each icon) or <text> (the order badge) supports x/y
      // positioning the same way a bare <text> does, so the fix is the
      // same: fold the <g>'s own translate(a, b) into each child's existing
      // x/y (they're already positioned relative to the group's own
      // center, so this is addition, not a flat overwrite) and neutralize
      // the <g>'s transform — sidesteps the whole round-trip regardless of
      // what html-to-image does with `transform`. Restored once the
      // capture is done, since — unlike the color override above — nothing
      // makes this one invisible on screen while it's in effect.
      container.querySelectorAll<SVGGElement>("g.link-text").forEach((g) => {
        const match = g.getAttribute("transform")?.match(/translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
        const shiftable = g.querySelectorAll<SVGElement>(".union-mark-icons > svg, .union-mark-icons > text");
        if (!match || shiftable.length === 0) return;
        const [, txStr, tyStr] = match;
        const tx = Number(txStr);
        const ty = Number(tyStr);
        const restores: Array<() => void> = [];
        shiftable.forEach((el) => {
          const origX = Number(el.getAttribute("x") ?? "0");
          const origY = Number(el.getAttribute("y") ?? "0");
          el.setAttribute("x", String(origX + tx));
          el.setAttribute("y", String(origY + ty));
          restores.push(() => {
            el.setAttribute("x", String(origX));
            el.setAttribute("y", String(origY));
          });
        });
        // A style override, not touching the `transform` attribute itself —
        // that attribute is what correctLinkTextTransform's own value above
        // still needs to be read back out of, on restore.
        g.style.transform = "none";
        exportDomRestores.push(() => {
          restores.forEach((restore) => restore());
          g.style.transform = "";
        });
      });

      // The watermark is a decorative ::before pseudo-element, invisible to
      // both querySelector and html-to-image's own clone — it can only be
      // suppressed via a real class toggle on the container that owns it.
      // `--color-bg` also has to be overridden directly (not just the
      // container's own `background`): every card's name/date text sits on
      // its own small `::before` fade-mask (see .card-text::before in
      // App.css) that paints itself in that same variable so a crossing
      // line fades out behind the text instead of cutting across it — with
      // nothing to blend into anymore in a transparent export, that mask
      // was showing up as a solid cream patch under every name. Overriding
      // the custom property here (it's inherited, so this cascades to every
      // descendant that reads it) clears both at once.
      if (transparent) {
        container.classList.add("tree-container-no-watermark");
        container.style.background = "transparent";
        container.style.setProperty("--color-bg", "transparent");
      }

      // The currently-centered person's card carries family-chart's own
      // "card-main" class, which a whole family of .card-main rules uses to
      // render them larger (avatar, text) with a spinning ring behind the
      // avatar — a fine in-app cue for "this is who you're looking at," but
      // this is a static export of the whole tree, not a single focused
      // view, and singling that one person out doesn't belong in it (the
      // frozen mid-rotation ring in particular renders as a stray
      // half-drawn shape). Simply removing the class for the capture makes
      // every .f3 div.card-main rule stop matching, so that card falls back
      // to the same styling as everyone else's.
      container.querySelectorAll<HTMLElement>(".card-main").forEach((el) => {
        el.classList.remove("card-main");
        exportDomRestores.push(() => el.classList.add("card-main"));
      });

      // The "more ancestry available" corner icon (a small solid-forest-
      // green circle — this is what was actually showing up as a stray
      // green dot in exports, not a union mark at all) is deliberately
      // *not* hover-gated in the app, since it's meant to catch the eye
      // whenever it applies (see wireCardAndUnionClicks). The edit/expand/
      // relate corner buttons are hover-gated via CSS opacity, so they're
      // already invisible on export — hidden here too anyway, since all
      // four are interactive affordances for the live app, not something
      // that belongs in a static picture of the tree.
      container
        .querySelectorAll<HTMLElement>(
          ".card-ancestry-toggle, .card-expand-toggle, .card-edit-toggle, .card-relate-toggle",
        )
        .forEach((el) => {
          const previousDisplay = el.style.display;
          el.style.display = "none";
          exportDomRestores.push(() => {
            el.style.display = previousDisplay;
          });
        });

      const backgroundColor = transparent
        ? undefined
        : getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#faf6ef";
      const link = document.createElement("a");
      const baseName = (treeName || "arbol").replace(/[^a-z0-9]+/gi, "_");
      if (format === "svg") {
        const { toSvg } = await import("html-to-image");
        link.href = await toSvg(container, { backgroundColor });
        link.download = `${baseName}.svg`;
      } else {
        const { toPng } = await import("html-to-image");
        link.href = await toPng(container, { backgroundColor, pixelRatio });
        link.download = `${baseName}.png`;
      }
      link.click();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      container.classList.remove("tree-container-no-watermark");
      container.style.background = "";
      container.style.removeProperty("--color-bg");
      exportDomRestores.forEach((restore) => restore());
      // The orientation switch above was only ever for this one capture —
      // switch back to whatever the live app was actually showing before
      // it, the same way handleToggleOrientation itself would.
      if (orientationChanged) {
        container.querySelectorAll<SVGGElement>("g.link-text").forEach((g) => {
          g.style.opacity = "0";
        });
        if (originalOrientation === "horizontal") chart.setOrientationHorizontal();
        else chart.setOrientationVertical();
        setOrientation(originalOrientation);
        orientationRef.current = originalOrientation;
        chart.updateTree({ tree_position: "fit" });
      }
      setExportingImage(false);
    }
  }

  // family-chart supports both orientations natively (setOrientationHorizontal/
  // Vertical just flip a flag it already reads on every layout pass), so this
  // is the one piece that's actually simple — re-fit afterward since the
  // tree's whole footprint (what used to be tall is now wide) changes shape.
  // The timeline sidebar staying a tall, narrow strip makes no sense once
  // the tree itself reads left-to-right instead of top-to-bottom, so it
  // moves under the canvas instead of relayouting itself to match — see
  // .main-area-horizontal in App.css.
  function handleToggleOrientation() {
    const chart = chartRef.current;
    if (!chart) return;
    const next = orientation === "vertical" ? "horizontal" : "vertical";
    if (next === "horizontal") {
      chart.setOrientationHorizontal();
    } else {
      chart.setOrientationVertical();
    }
    setOrientation(next);
    // Union marks visibly swim across the screen for the ~1s this
    // transition takes, since correctLinkTextTransform can only place them
    // correctly once family-chart's own d3 transition has actually
    // finished moving everything (see the settle comment below) — hidden
    // here and faded back in by that same settle step once corrected,
    // rather than showing that in-between motion at all.
    containerRef.current?.querySelectorAll<SVGGElement>("g.link-text").forEach((g) => {
      g.style.opacity = "0";
    });
    chart.updateTree({ tree_position: "fit" });
  }

  // Re-opens the same wizard shown right after an import, for anyone still
  // missing every relationship — covers closing it by accident mid-import,
  // as well as any other stray unlinked person (manual entry, an older
  // import from before the wizard existed, etc), not just the last batch.
  function handleOpenUnrelatedWizard() {
    const unrelatedIds = treeData
      .filter((p) => p.rels.parents.length === 0 && p.rels.spouses.length === 0 && p.rels.children.length === 0)
      .map((p) => p.id);
    if (unrelatedIds.length === 0) {
      setNoUnrelatedMessage(true);
      window.setTimeout(() => setNoUnrelatedMessage(false), 3000);
      return;
    }
    setWizardIds(unrelatedIds);
  }

  // The header menu used to reveal purely via CSS :hover/:focus-within — a
  // real mouse crossing the gap between the trigger and the revealed row
  // (or from the row onto the nested lineages popover) could leave the
  // hover region for an instant and collapse the whole thing, reported as
  // "closes again as soon as I try to reach lineages" and specific to one
  // external monitor's exact scaled resolution in Safari, suggesting the
  // browser's own :hover matching was the flaky part, not the DOM
  // structure. Same JS-owned open state + grace-delay pattern as the
  // Legend panel (see its own comment for the full reasoning) sidesteps
  // that CSS pseudo-class path entirely — real mouseenter/mouseleave
  // events instead, with a short delay bridging the moment the pointer
  // crosses from the trigger onto the row.
  function revealHeaderMenu() {
    window.clearTimeout(headerMenuCloseTimerRef.current);
    setHeaderMenuOpen(true);
  }
  function scheduleHideHeaderMenu() {
    window.clearTimeout(headerMenuCloseTimerRef.current);
    headerMenuCloseTimerRef.current = window.setTimeout(() => setHeaderMenuOpen(false), 150);
  }
  function toggleHeaderMenu() {
    window.clearTimeout(headerMenuCloseTimerRef.current);
    setHeaderMenuOpen((v) => !v);
  }

  // Manual fallback for the auto-derivation every create/edit/import
  // already does on its own — for data that predates that feature, or an
  // older import that ran before this codebase's own gap was fixed.
  async function handleDeriveLineages() {
    if (!treeId) return;
    setDerivingLineages(true);
    setDeriveLineagesMessage(null);
    try {
      const { lineages: updated, mergedCount } = await deriveLineages(treeId);
      setLineages(updated);
      setDeriveLineagesMessage(
        mergedCount > 0
          ? t("lineagesManage.deriveDoneWithMerge", { count: updated.length, merged: mergedCount })
          : t("lineagesManage.deriveDone", { count: updated.length }),
      );
    } catch (err) {
      setDeriveLineagesMessage((err as Error).message);
    } finally {
      setDerivingLineages(false);
    }
  }

  // Used by the info panel's Relaciones tab — clicking a relative both
  // re-centers the tree on them (like any other navigation) and swaps the
  // panel to their own record, so drilling through a family reads as one
  // continuous walk instead of navigate-then-reopen.
  function handleNavigateToPerson(personId: string) {
    const chart = chartRef.current;
    if (chart) {
      chart.updateMainId(personId);
      chart.updateTree({});
    }
    const person = treeDataRef.current.find((p) => p.id === personId);
    if (person) setInfoPanel(buildPersonInfoPanel(person));
  }

  function handlePersonCreated(newPersonId: string) {
    setShowAddForm(false);
    loadTree(newPersonId).catch((err: Error) => setError(err.message));
  }

  function handlePersonSaved(personId: string) {
    setEditingPersonId(null);
    loadTree(personId).catch((err: Error) => setError(err.message));
    // Editing can create a new lineage inline — refresh the filter chips so
    // it shows up without leaving/reentering the tree.
    if (treeId) fetchLineages(treeId).then(setLineages).catch(() => {});
  }

  function handlePersonDeleted() {
    // The deleted person can no longer be a valid "back" target.
    backStackRef.current = backStackRef.current.filter((id) => id !== editingPersonId);
    setCanGoBack(backStackRef.current.length > 0);
    setEditingPersonId(null);
    loadTree().catch((err: Error) => setError(err.message));
  }

  function handleTrashRestored() {
    loadTree().catch((err: Error) => setError(err.message));
  }

  if (!treeId) return null;

  return (
    <div className={`app${orientation === "horizontal" ? " app-orientation-horizontal" : ""}`}>
      <header className="app-header">
        <div className="header-actions">
          <Link to="/" className="icon-button" aria-label={t("app.backHome")} title={t("app.backHome")}>
            <HomeIcon />
          </Link>
          <button
            type="button"
            className="icon-button"
            onClick={handleBack}
            disabled={!canGoBack}
            aria-label={t("app.back")}
            title={t("app.back")}
          >
            <ArrowLeftIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleFitAll}
            aria-label={t("app.fitAll")}
            title={t("app.fitAll")}
          >
            <MaximizeIcon />
          </button>
        </div>

        {editingTitle ? (
          <input
            className="tree-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleCommit}
            onKeyDown={handleTitleKeyDown}
            autoComplete="off"
            autoFocus
          />
        ) : (
          <h1 className="tree-title" onClick={handleTitleClick} title={t("app.titleHint")}>
            {treeName || t("app.defaultTitle")}
          </h1>
        )}

        <div className={`header-menu${headerMenuOpen ? " header-menu-open" : ""}`} ref={headerMenuRef}>
          <button
            type="button"
            className="icon-button header-menu-trigger"
            onClick={toggleHeaderMenu}
            onMouseEnter={revealHeaderMenu}
            onMouseLeave={scheduleHideHeaderMenu}
            onFocus={revealHeaderMenu}
            aria-label={t("app.moreActions")}
            aria-expanded={headerMenuOpen}
            title={t("app.moreActions")}
          >
            <MenuIcon />
          </button>
          <div className="header-menu-items" onMouseEnter={revealHeaderMenu} onMouseLeave={scheduleHideHeaderMenu}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowSearch(true)}
              aria-label={t("app.search")}
              title={t("app.search")}
            >
              <SearchIcon />
            </button>

            <div className="popover-anchor" ref={lineageMenuRef}>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowLineageMenu((v) => !v)}
                aria-label={t("app.lineages")}
                aria-expanded={showLineageMenu}
                title={t("app.lineages")}
              >
                <GitBranchIcon />
              </button>
              {showLineageMenu && (
                <div className="popover lineage-popover">
                  <LineageChips lineages={lineages} selectedIds={selectedLineageIds} onChange={setSelectedLineageIds} />
                  <button
                    type="button"
                    className="union-notes-edit-link"
                    onClick={() => {
                      setShowLineageMenu(false);
                      setShowLineagesManage(true);
                    }}
                  >
                    {t("lineagesManage.manageLink")}
                  </button>
                  <button
                    type="button"
                    className="union-notes-edit-link"
                    onClick={handleDeriveLineages}
                    disabled={derivingLineages}
                    title={t("lineagesManage.deriveHint")}
                  >
                    {derivingLineages ? t("lineagesManage.deriving") : t("lineagesManage.deriveLink")}
                  </button>
                  {deriveLineagesMessage && <p className="field-hint">{deriveLineagesMessage}</p>}
                </div>
              )}
            </div>

            <button
              type="button"
              className="icon-button"
              onClick={() => setShowTrash(true)}
              aria-label={t("app.trash")}
              title={t("app.trash")}
            >
              <Trash2Icon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowAddForm(true)}
              disabled={treeRole === "VIEWER"}
              aria-label={t("app.addPerson")}
              title={t("app.addPerson")}
            >
              <UserPlusIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowDuplicates(true)}
              disabled={treeRole === "VIEWER"}
              aria-label={t("app.duplicates")}
              title={t("app.duplicates")}
            >
              <DuplicatesIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={handleOpenUnrelatedWizard}
              disabled={treeRole === "VIEWER"}
              aria-label={t("app.unrelatedWizard")}
              title={t("app.unrelatedWizard")}
            >
              <UnresolvedIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowLinkPeople(true)}
              disabled={treeRole === "VIEWER"}
              aria-label={t("app.linkPeople")}
              title={t("app.linkPeople")}
            >
              <LinkIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowGedcom(true)}
              aria-label={t("app.gedcom")}
              title={t("app.gedcom")}
            >
              <ArrowUpDownIcon />
            </button>
            <div className="popover-anchor" ref={exportMenuRef}>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  // Defaults the orientation choice to whatever's actually
                  // on screen right now each time the menu opens, rather
                  // than whatever was last picked in a previous export.
                  setExportOrientation(orientation);
                  setShowExportMenu((v) => !v);
                }}
                disabled={exportingImage}
                aria-expanded={showExportMenu}
                aria-label={exportingImage ? t("app.exportingTreeImage") : t("app.exportTreeImage")}
                title={exportingImage ? t("app.exportingTreeImage") : t("app.exportTreeImage")}
              >
                <ImageIcon />
              </button>
              {showExportMenu && (
                <div className="popover export-image-popover">
                  <div className="export-option-group">
                    <span className="export-option-label">{t("app.exportFormatLabel")}</span>
                    <IOSToggle checked={exportFormat === "png"} onChange={() => setExportFormat("png")} label="PNG" />
                    <IOSToggle checked={exportFormat === "svg"} onChange={() => setExportFormat("svg")} label="SVG" />
                    {exportFormat === "svg" && <p className="field-hint">{t("app.exportFormatSvgHint")}</p>}
                  </div>

                  <div className="export-option-group">
                    <span className="export-option-label">{t("app.exportScopeLabel")}</span>
                    <IOSToggle
                      checked={exportScope === "current"}
                      onChange={() => setExportScope("current")}
                      label={t("app.exportScopeCurrent")}
                    />
                    <IOSToggle
                      checked={exportScope === "whole"}
                      onChange={() => setExportScope("whole")}
                      label={t("app.exportScopeWhole")}
                    />
                  </div>

                  <div className="export-option-group">
                    <span className="export-option-label">{t("app.exportOrientationLabel")}</span>
                    <IOSToggle
                      checked={exportOrientation === "vertical"}
                      onChange={() => setExportOrientation("vertical")}
                      label={t("app.orientationVertical")}
                    />
                    <IOSToggle
                      checked={exportOrientation === "horizontal"}
                      onChange={() => setExportOrientation("horizontal")}
                      label={t("app.orientationHorizontal")}
                    />
                  </div>

                  <div className="export-option-group">
                    <span className="export-option-label">{t("app.exportBackgroundLabel")}</span>
                    <IOSToggle
                      checked={exportBackground === "opaque"}
                      onChange={() => setExportBackground("opaque")}
                      label={t("app.exportTreeImageWithBg")}
                    />
                    <IOSToggle
                      checked={exportBackground === "transparent"}
                      onChange={() => setExportBackground("transparent")}
                      label={t("app.exportTreeImageTransparent")}
                    />
                  </div>

                  {exportFormat === "png" && (
                    <div className="export-option-group">
                      <span className="export-option-label">{t("app.exportQualityLabel")}</span>
                      <IOSToggle
                        checked={exportQuality === "standard"}
                        onChange={() => setExportQuality("standard")}
                        label={t("app.exportQualityStandard")}
                      />
                      <IOSToggle
                        checked={exportQuality === "high"}
                        onChange={() => setExportQuality("high")}
                        label={t("app.exportQualityHigh")}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary export-option-submit"
                    disabled={exportingImage}
                    onClick={() =>
                      handleExportTreeImage({
                        transparent: exportBackground === "transparent",
                        format: exportFormat,
                        pixelRatio: exportQuality === "high" ? 4 : 2,
                        scope: exportScope,
                        orientation: exportOrientation,
                      })
                    }
                  >
                    {exportingImage ? t("app.exportingTreeImage") : t("app.exportSubmit")}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={handleToggleOrientation}
              aria-label={orientation === "vertical" ? t("app.orientationHorizontal") : t("app.orientationVertical")}
              title={orientation === "vertical" ? t("app.orientationHorizontal") : t("app.orientationVertical")}
            >
              {orientation === "vertical" ? <RowsIcon /> : <ColumnsIcon />}
            </button>
            {treeRole === "OWNER" && (
              <button
                type="button"
                className="icon-button icon-button-badged"
                onClick={() => setShowShareModal(true)}
                aria-label={treeMemberCount > 1 ? t("app.manageGuests", { count: treeMemberCount - 1 }) : t("app.share")}
                title={treeMemberCount > 1 ? t("app.manageGuests", { count: treeMemberCount - 1 }) : t("app.share")}
              >
                <ShareIcon />
                {treeMemberCount > 1 && <span className="icon-button-badge">{treeMemberCount - 1}</span>}
              </button>
            )}
          </div>
        </div>
      </header>
      {loading && <p className="status">{t("app.loadingTree")}</p>}
      {error && <p className="status status-error">{error}</p>}
      {noUnrelatedMessage && <p className="status">{t("relationshipWizard.noneUnrelated")}</p>}
      <div className="main-area">
        <div className="tree-canvas-wrap">
          <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
          <svg ref={relateOverlayRef} className="relate-drag-overlay" aria-hidden="true" />
          <Legend />
          {hoverPreview && (
            <HoverPreview data={hoverPreview.data} x={hoverPreview.x} y={hoverPreview.y} flip={hoverPreview.flip} />
          )}
        </div>
        {/* Timeline is currently unhooked here (not deleted — see
            Timeline.tsx) — its scroll position can't stay both linear-by-
            year and honest about where people actually sit, since the
            tree's own vertical axis is generation depth, not age; two
            people born decades apart routinely share a row. Left in place
            in case a design that doesn't depend on that alignment comes
            up later. */}
      </div>
      {showAddForm && (
        <AddPersonForm
          treeId={treeId}
          people={treeData}
          onCreated={handlePersonCreated}
          onClose={() => setShowAddForm(false)}
        />
      )}
      {editingPersonId && (
        <EditPersonForm
          treeId={treeId}
          personId={editingPersonId}
          people={treeData}
          onSaved={handlePersonSaved}
          onDeleted={handlePersonDeleted}
          onClose={() => setEditingPersonId(null)}
          onRelationsChanged={() => {
            loadTree().catch((err: Error) => setError(err.message));
            fetchLineages(treeId).then(setLineages).catch(() => {});
          }}
        />
      )}
      {showTrash && (
        <TrashView treeId={treeId} onRestored={handleTrashRestored} onClose={() => setShowTrash(false)} />
      )}
      {showShareModal && <ShareTreeModal treeId={treeId} onClose={() => setShowShareModal(false)} />}
      {showDuplicates && (
        <DuplicatesView
          treeId={treeId}
          onClose={() => setShowDuplicates(false)}
          onMerged={() => loadTree().catch((err: Error) => setError(err.message))}
        />
      )}
      {showGedcom && (
        <GedcomView
          treeId={treeId}
          onImported={() => {
            loadTree().catch((err: Error) => setError(err.message));
            fetchLineages(treeId).then(setLineages).catch(() => {});
          }}
          onClose={() => setShowGedcom(false)}
        />
      )}
      {wizardIds && (
        <RelationshipWizard
          treeId={treeId}
          personIds={wizardIds}
          onFinished={() => {
            loadTree().catch((err: Error) => setError(err.message));
            fetchLineages(treeId).then(setLineages).catch(() => {});
          }}
          onClose={() => setWizardIds(null)}
        />
      )}
      {showSearch && (
        <IndividualsSearchView
          treeId={treeId}
          onNavigateToPerson={handleNavigateToPerson}
          onEditPerson={(id) => {
            setEditingPersonId(id);
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showLineagesManage && (
        <LineagesManageView
          treeId={treeId}
          lineages={lineages}
          onChanged={() => fetchLineages(treeId).then(setLineages).catch(() => {})}
          onClose={() => setShowLineagesManage(false)}
        />
      )}
      {showLinkPeople && (
        <LinkPeopleModal
          treeId={treeId}
          onLinked={() => {
            setShowLinkPeople(false);
            loadTree().catch((err: Error) => setError(err.message));
          }}
          onClose={() => setShowLinkPeople(false)}
        />
      )}
      {relateDraft && (
        <LinkPeopleModal
          treeId={treeId}
          fixedPersonAId={relateDraft.personAId}
          fixedPersonBId={relateDraft.personBId}
          onLinked={() => {
            setRelateDraft(null);
            loadTree().catch((err: Error) => setError(err.message));
          }}
          onClose={() => setRelateDraft(null)}
        />
      )}
      {lightboxUrl && <PhotoLightbox src={lightboxUrl} shape="circle" onClose={() => setLightboxUrl(null)} />}
      {infoPanel && (
        <InfoPanel
          treeId={treeId}
          data={infoPanel}
          onClose={() => setInfoPanel(null)}
          onNavigateToPerson={handleNavigateToPerson}
          onDataChanged={() => loadTree().catch((err: Error) => setError(err.message))}
        />
      )}
    </div>
  );
}

export default App;
