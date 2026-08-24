import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import i18n from "./i18n";
import {
  deriveLineages,
  fetchIndividual,
  fetchLineages,
  fetchTree,
  mediaUrl,
  updateTreeName,
  type Lineage,
  type TreePerson,
  type TreeRole,
  type UnionInfo,
} from "./api";
import AddPersonForm, { type QuickAddInitialRelation } from "./AddPersonForm";
import QuickAddKindPicker, { type QuickAddPickerKind } from "./QuickAddKindPicker";
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

// A genealogical loop (someone reachable from the centered person by two
// different chains of ancestors/descendants — e.g. two first cousins who
// married) renders the *same* union twice, once per chain, at two
// different spots on the canvas. `union.id` alone can't tell those two
// rendered occurrences apart, so a lookup keyed only by it (as
// zoneByFamilyId used to be) collapses both into one shared zone —
// whichever occurrence computed last simply overwrites the other's entry,
// so hovering the *other* occurrence's line pulled up a mark positioned
// for a completely different spot on the canvas. Coordinates disambiguate
// occurrences the id can't: each rendered instance of a union has its own
// distinct pair of laid-out spouse positions, even though the underlying
// union row is identical. Order-independent (sorted) since a path.link's
// source/target and a g.link-text's own node pair aren't guaranteed to
// list the same two spouses in the same order.
function occurrenceKey(x1: number, y1: number, x2: number, y2: number): string {
  const a = `${Math.round(x1)},${Math.round(y1)}`;
  const b = `${Math.round(x2)},${Math.round(y2)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
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

// A union line's own hitarea/knot (see the unionLineEntries-building loop
// in wireCardAndUnionClicks) are stashed directly on the `path.link`
// element itself, not found by DOM sibling position — family-chart's own
// d3 reorders path.link elements on every update with no idea these
// synthetic siblings exist, so a sibling-position lookup can drift onto a
// *different* union's hit/knot after a reorder (see that loop's own
// comment for the stray-knot bug this caused).
type PathLinkWithExtras = SVGPathElement & { __unionHit?: SVGPathElement; __unionKnot?: SVGUseElement };

// family-chart positions a spouse-link mark (marriage/divorce/etc. symbol)
// using a heuristic — one card's x plus half the fixed inter-card spacing —
// that assumes the two spouses are the only couple in their row, sitting
// exactly one spacing unit apart. That's true for a single marriage, but
// false the moment someone has two-plus spouses rendered side by side (a
// remarriage): the mark for whichever pair *isn't* horizontally adjacent
// lands at that wrong fixed offset instead of their real midpoint —
// reported as union icons drifting to one side or hovering over blank
// space.
//
// The fix here reuses `zoneByFamilyId` — the exact same exclusive-zone
// segment computeZones/applyAllZones already trims this same union's own
// connecting line (and rope knot) to, in wireCardAndUnionClicks below; see
// that function's own comment for the full exclusive-zone rationale. An
// earlier version of this function instead ran its own independent
// "nearest gap between cards to the raw midpoint" search — which had a bug
// this didn't: given a union whose true midpoint sits, by ordinary even
// card spacing, almost exactly between two candidate gaps, a *tie* in
// "which gap's center is closest" silently fell back to whichever gap came
// first — which could be a *different* union's own segment (reported: a
// remarriage's icon appearing over the first marriage's line instead of
// its own). Deriving the icon's position from the very same zone the line
// is trimmed to can't drift out of sync with it: the icon always lands
// somewhere on its own union's visible segment, never a neighbor's, by
// construction.
//
// family-chart swaps which screen axis is "spread" (spouses/siblings laid
// out side by side within a row) vs "depth" (generation) when the tree is
// horizontal — see its own d.psx/d.psy assignment, which reads `p.sx`/`p.y`
// in one order for vertical and the other for horizontal — so `depth`
// below stays orientation-aware. `zoneByFamilyId` itself is already
// expressed in the matching spread axis (see computeZones' own `c.axis`),
// so no separate spread() helper is needed here any more.
function correctLinkTextTransform(
  g: SVGGElement,
  orientation: "vertical" | "horizontal",
  zoneByFamilyId: Map<string, { lo: number; hi: number }>,
): string | null {
  const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
  if (!datum) return null;
  const [sp1, sp2] = datum.nodes;
  if (typeof sp1.x !== "number" || typeof sp1.y !== "number" || typeof sp2.x !== "number" || typeof sp2.y !== "number") {
    return null;
  }

  const familyId = g.getAttribute("data-family-id");
  const zone = familyId ? zoneByFamilyId.get(`${familyId}@${occurrenceKey(sp1.x, sp1.y, sp2.x, sp2.y)}`) : undefined;
  if (!zone) return null;

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
  // overlapping it. Lifting by the icon's own half-height (plus a margin,
  // bumped up twice now by request for more visible separation — first
  // from the line itself, then again once the line grew its own rope knot,
  // which the mark was landing right on top of) clears it regardless of
  // whether it's one icon or two — there's no card to collide with going
  // this direction: the mark only ever sits within its own union's zone,
  // which is itself always clear of every card by construction (see
  // computeZones), and the next row up is a good 77 units of clear space
  // further away than this reaches (card_y_spacing's own 205, less a
  // card's 128-unit height).
  //
  // Horizontal mode: spouses stack in a vertical column sharing one
  // connecting line straight down that column, and the mark is centered on
  // the same point, so a nudge only wide enough to clear the line itself
  // would leave it straddling one spouse's own card in the export image —
  // by request, left as-is here (see this function's own header comment
  // for why that's fine for a static picture, unlike the live canvas).
  const depthNudge = orientation === "horizontal" ? -(markWidth / 2 + 18) : -(markHeight / 2 + 20);
  // And, only in horizontal mode, dropped a few px along the spread axis
  // (screen-y there) so it clears the line vertically too, not just
  // sideways.
  // The geometric midpoint between the two avatar centers doesn't account
  // for a two-line name+lifespan text block hanging well below the upper
  // spouse's own avatar — a small nudge cleared the avatar but still left
  // the mark sitting against that text. Sized closer to a real text
  // block's height instead of a token few px.
  const spreadNudge = orientation === "horizontal" ? 30 : 0;

  const rowDepth = depth(sp1) + depthNudge;
  const mid = (zone.lo + zone.hi) / 2;
  return toTransform(mid + spreadNudge, rowDepth);
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

// Plain "+" — replaces the old drag-to-link branch icon (dropping a card
// onto another to open LinkPeopleModal), which turned out to barely get
// used and duplicated the hamburger menu's own "Vincular personas" entry
// point. This is a quick-create instead: a click opens a small kind picker
// (child/spouse/parent), then AddPersonForm with that relation and this
// card's person already filled in — see the quickAddKindPicker state below.
const QUICKADD_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;

// Lucide's "git-branch" glyph — same one used for "lineages" in the
// hamburger menu (see GitBranchIcon in Icons.tsx), reused here for visual
// consistency rather than the old, unrelated "chevrons-up" pair. Sits in
// the card's one remaining free corner, and (unlike the three above) is
// only ever shown on cards whose own recorded parents aren't part of the
// currently-rendered tree: a spouse who married into the family, whose own
// ancestry is real data but never gets drawn from the current root (see
// wireCardAndUnionClicks, where visibility is decided per render from
// cardIds + rels.parents).
const ANCESTRY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;

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
    <button type="button" class="card-quickadd-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("card.quickAdd"))}" aria-label="${escapeHtml(i18n.t("card.quickAdd"))}">${QUICKADD_ICON_SVG}</button>
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

  // birthDateText/deathDateText are the user's own freeform display string
  // and take priority when present (trust what they actually wrote, e.g.
  // an exact day, rather than second-guessing it) — the precision-aware
  // year (same "c." logic the card's own lifespan line uses) is only a
  // fallback for a date recorded solely via the structured picker with no
  // free text, so hover still shows *something* instead of "desconocido".
  const birthText = d.birthday || yearLabel(d.birthYear, d.birthPrecision) || undefined;
  const birth = [birthText, d["birth place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
  sections.push({ heading: i18n.t("infoPanel.sectionBirth"), items: birth.length ? birth : [i18n.t("infoPanel.unknown")] });

  const deathText = d.deathday || yearLabel(d.deathYear, d.deathPrecision) || undefined;
  if (deathText || d["death place"]) {
    const death = [deathText, d["death place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
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
  // unionDateText (freeform) takes priority when present, same as birth/
  // death dates above — falls back to the structured date+precision so a
  // date entered solely via the picker still shows on hover instead of
  // "unknown".
  const unionDisplayDate =
    union.unionDateText ||
    (union.unionDateValue
      ? union.unionDatePrecision === "ABOUT"
        ? i18n.t("common.circaDate", { date: union.unionDateValue.slice(0, 10) })
        : union.unionDateValue.slice(0, 10)
      : "");

  const sections: InfoPanelSection[] = [
    {
      heading: i18n.t("infoPanel.unionHeading"),
      items: [
        i18n.t("infoPanel.unionType", { value: i18n.t(`unionType.${union.unionType}`) }),
        i18n.t("infoPanel.unionStatus", { value: i18n.t(`unionStatus.${union.unionStatus}`) }),
        i18n.t("infoPanel.unionDate", { value: unionDisplayDate || i18n.t("infoPanel.unknownDate") }),
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
      unionDateValue: union.unionDateValue,
      unionDatePrecision: union.unionDatePrecision,
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
  // The card's own "+" corner button (see QUICKADD_ICON_SVG) — a click
  // opens a small kind picker (child/spouse/parent) for that card's
  // person, then AddPersonForm with that relation and person already
  // filled in. quickAddLoading covers the moment between picking a kind
  // and AddPersonForm actually opening, while the root person's full
  // record (PersonPicker-selected people carry the full Individual shape,
  // but a card only has the lighter TreePerson one) is fetched.
  const [quickAddPickerPersonId, setQuickAddPickerPersonId] = useState<string | null>(null);
  const [quickAddInitialRelation, setQuickAddInitialRelation] = useState<QuickAddInitialRelation | null>(null);
  const [quickAddLoading, setQuickAddLoading] = useState(false);
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

  // A card's "+" button opens the kind picker for that person — fetching
  // the full Individual record (a card only carries the lighter TreePerson
  // shape) happens once a kind is actually picked, not here, so opening
  // the picker itself is instant.
  const handleQuickAddClick = useCallback((personId: string) => {
    setQuickAddPickerPersonId(personId);
  }, []);

  async function handleQuickAddKindPicked(rootPersonId: string, kind: QuickAddPickerKind) {
    setQuickAddLoading(true);
    try {
      let relation: QuickAddInitialRelation;
      if (kind === "SIBLING_OF") {
        // Sugar for CHILD_OF_PARENTS seeded with the clicked card's own
        // parents (however many of the two are actually recorded), rather
        // than the card's own person — see QuickAddPickerKind's own
        // comment. treeDataRef already carries every rendered person's
        // parent ids (rels.parents); AddPersonForm needs the full
        // Individual shape for each, not just the id, so those still need
        // fetching.
        const rootParentIds = treeDataRef.current.find((p) => p.id === rootPersonId)?.rels.parents ?? [];
        const [parent, parent2] = await Promise.all(rootParentIds.slice(0, 2).map((id) => fetchIndividual(treeId!, id)));
        relation = { kind: "CHILD_OF_PARENTS", parent, parent2 };
      } else {
        const individual = await fetchIndividual(treeId!, rootPersonId);
        relation =
          kind === "CHILD_OF_PARENTS"
            ? { kind, parent: individual }
            : kind === "PARTNER"
              ? { kind, partner: individual }
              : { kind, child: individual };
      }
      setQuickAddInitialRelation(relation);
      setQuickAddPickerPersonId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQuickAddLoading(false);
    }
  }

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

    container.querySelectorAll<HTMLButtonElement>(".card-quickadd-toggle").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (btn.dataset.personId) handleQuickAddClick(btn.dataset.personId);
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

    // The connecting line itself is still the actual click/hover surface
    // — hovering it now also reveals the icon(s) above (immediately — no
    // delay, unlike the person-card hover-preview below, so the bubble is
    // visible well before that timer would ever fire), and clicking it
    // opens the full InfoPanel, restyled to match
    // the translucent/blurred hover-preview look for a union specifically
    // (see InfoPanel's own info-panel-union class).
    //
    // family-chart binds a plain object (source[s]/target) onto each
    // path.link — a spouse-to-spouse line has a single (non-array) source,
    // unlike a child's link to two parents, which is exactly the shape that
    // distinguishes the union lines worth wiring up here from everything
    // else this same selector matches.
    type UnionLineEntry = {
      p: SVGPathElement;
      union: UnionInfo;
      hit: SVGPathElement;
      knot: SVGUseElement;
    };
    const unionLineEntries: UnionLineEntry[] = [];

    // hit/knot elements used to be inserted as `p`'s own DOM siblings
    // (afterend of `p`, then afterend of `hit`) — reasonable at a glance,
    // but family-chart's own d3 data-join reorders path.link elements to
    // match its data order on every update (and again mid-transition,
    // *after* this whole function had already run and correctly
    // positioned everything, confirmed by logging the DOM structure
    // immediately after this function returns vs. a moment later). d3's
    // reorder has no idea these synthetic siblings exist, so it never
    // carries them along — stranding a hit/knot pair wherever `p` used to
    // be, no longer adjacent to it. Reported as knots floating with no
    // line, over a completely unrelated relationship elsewhere in the row.
    // A single overlay `<g>`, created once and never touched by
    // family-chart's own selection at all, sidesteps the whole problem:
    // every hit/knot lives here instead of next to `p`, so nothing family-
    // chart does to path.link's own DOM order can strand them. Positioning
    // stays purely coordinate-driven (the `d`/`x`/`y`/`transform`
    // attributes set in applyAllZones below), so where this group sits in
    // the DOM doesn't affect where anything draws — appended last so
    // hit/knot still paint on top of every line.
    const linksParent = container.querySelector("path.link")?.parentElement;
    let overlay = linksParent?.querySelector<SVGGElement>(":scope > .union-line-overlay") ?? null;
    if (linksParent && !overlay) {
      overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
      overlay.setAttribute("class", "union-line-overlay");
      linksParent.appendChild(overlay);
    } else if (overlay) {
      // Re-appended every pass — a plain `appendChild` on an element
      // already in the DOM moves it, which keeps this group (and so every
      // hit/knot in it) last in paint order even if family-chart's own
      // reorder shuffled it earlier in the meantime.
      linksParent?.appendChild(overlay);
    }

    container.querySelectorAll<SVGPathElement>("path.link").forEach((p) => {
      const datum = (p as unknown as { __data__?: PathLinkDatum }).__data__;
      const source = datum && !Array.isArray(datum.source) ? datum.source : null;
      const union =
        source?.data?.id && datum!.target.data?.id
          ? unionsByPairKeyRef.current.get(pairKey(source.data.id, datum!.target.data.id))
          : undefined;

      // A union whose line was just hidden above (its cards fell outside
      // the currently-rendered cardIds — e.g. a collapsed ancestor branch)
      // still has a perfectly valid x/y from family-chart's own layout —
      // the layout covers the *whole* loaded data, not just what's on
      // screen — so it would otherwise sail through this check and get a
      // knot positioned wherever that (currently invisible) row happens to
      // sit, sometimes far off in empty space above/around the visible
      // tree.
      if (!union || typeof source!.x !== "number" || typeof source!.y !== "number" || p.style.display === "none") {
        p.classList.remove("union-line");
        p.style.stroke = "";
        p.onclick = null;
        p.onmouseenter = null;
        p.onmouseleave = null;
        return;
      }

      p.classList.add("union-line");
      // Found/reused via a reference stashed directly on `p` (see
      // PathLinkWithExtras below), not by DOM position — see the overlay
      // group's own comment above for why position isn't reliable here.
      const pWithExtras = p as PathLinkWithExtras;
      let hit = pWithExtras.__unionHit;
      if (!hit) {
        // A separate, much-wider transparent stroke rather than widening
        // path.link's own visible stroke — same idea as the old icon's own
        // padded hit rect, just along a line instead of around a shape.
        hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hit.setAttribute("class", "union-line-hitarea");
        pWithExtras.__unionHit = hit;
      }
      overlay?.appendChild(hit);

      // The rope's own knot (see the #union-knot <symbol> above) — one per
      // line, stamped at its midpoint by applyAllZones/positionKnot below.
      // pointer-events are off (see .union-line-knot in App.css) so it
      // never steals hover/click away from `hit` sitting right underneath
      // it.
      let knot = pWithExtras.__unionKnot;
      if (!knot) {
        knot = document.createElementNS("http://www.w3.org/2000/svg", "use") as unknown as SVGUseElement;
        knot.setAttribute("class", "union-line-knot");
        knot.setAttribute("href", "#union-knot");
        pWithExtras.__unionKnot = knot;
      }
      overlay?.appendChild(knot);

      unionLineEntries.push({ p, union, hit, knot });
    });

    // family-chart's own d3 data-join removes a path.link element outright
    // once it's no longer needed (e.g. navigating to a person whose row no
    // longer includes a given union) — it has no idea this hitarea sibling
    // even exists, so it never removes it along with the path. Left
    // unswept, these accumulate as the user browses the tree: a "hitarea"
    // is invisible so this went unnoticed, but the same leak with the
    // decorative dots this line used to have showed up as stray black dots
    // scattered wherever an old, now-unrelated union used to be. Rather
    // than trying to catch every path through which a path.link can
    // disappear, this sweeps the whole container for anything not claimed
    // by *this* render's own entries and removes it — correct regardless
    // of how the element became orphaned.
    const claimedHitareas = new Set<Element>([
      ...unionLineEntries.map((entry) => entry.hit),
      ...unionLineEntries.map((entry) => entry.knot),
    ]);
    container.querySelectorAll(".union-line-hitarea, .union-line-dot, .union-line-knot").forEach((el) => {
      if (!claimedHitareas.has(el)) el.remove();
    });

    // The sweep above only catches a union.link.link that was already
    // gone (or already display:none) by the time *this* render ran — it
    // can't catch one that disappears *between* renders. Confirmed
    // empirically (logging exactly when each path.link actually left the
    // DOM vs. when this function last ran): family-chart's own d3 exit
    // selection routes a removed path.link through a fade-out
    // `.transition().remove()`, so the node leaves the DOM only once that
    // transition finishes — after this function has already returned and
    // already computed its claimed set for that render. No later redraw is
    // guaranteed to happen just because that transition finished (the user
    // may not click anything again for a while), so a hit/knot pair whose
    // path.link exits between renders could sit there orphaned
    // indefinitely instead of just until the next click. Watching for the
    // actual DOM removal — whenever it happens — and clearing that node's
    // own hit/knot right then closes the gap the periodic sweep leaves.
    if (linksParent) {
      const removalObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.removedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            const removed = node as PathLinkWithExtras;
            removed.__unionHit?.remove();
            removed.__unionKnot?.remove();
          });
        });
      });
      removalObserver.observe(linksParent, { childList: true });
      linkTextCleanupRef.current.push(() => removalObserver.disconnect());
    }

    // Always re-read straight off `p.__data__` rather than trusting values
    // cached at entry-creation time — family-chart may swap in a whole new
    // datum object on a later layout pass rather than mutating the old one
    // in place, so a value captured once could silently go stale. `p`
    // itself (the actual DOM node) is what family-chart keeps updating in
    // place, so reading its *current* `__data__` is the one thing that's
    // never stale, however many layout passes have happened since this
    // entry was built.
    const coordsOf = (entry: UnionLineEntry) => {
      const datum = (entry.p as unknown as { __data__?: PathLinkDatum }).__data__;
      const source = datum && !Array.isArray(datum.source) ? datum.source : null;
      const x1 = source?.x ?? 0;
      const y1 = source?.y ?? 0;
      const x2 = datum?.target.x ?? x1;
      const y2 = datum?.target.y ?? y1;
      const axis: "x" | "y" = y1 === y2 ? "y" : "x";
      return { x1, y1, x2, y2, axis, sourceId: source?.data?.id ?? null };
    };

    // family-chart draws a straight line from each spouse's own laid-out
    // position to the other's — fine for the common case, but when someone
    // has two-plus spouses in the same row, the line to a *non-adjacent*
    // one is drawn straight through the card (and that card's own spouse
    // line) sitting between them, rather than routing around it. The two
    // lines then physically overlap along that shared stretch, so hovering
    // anywhere in it always resolved to whichever one happened to sit on
    // top in DOM order, regardless of which one the pointer was actually
    // over.
    //
    // A parallel offset lane was tried here first and worked, but doesn't
    // scale — a third or fourth marriage would need a third and fourth
    // lane, and a user would have to visually track which of several
    // close, similar-looking lines belongs to which relationship, which
    // isn't really usable. What actually generalizes: each union only
    // needs to *own* the stretch of the row that no shorter (closer, more
    // "normal") union has already claimed — one continuous line overall,
    // just cut at each spouse's position and handed to whichever
    // relationship that particular stretch actually falls under, the way
    // it'd read on the page. The shortest, most common case (an adjacent
    // spouse) keeps its full real span untouched; anything longer only
    // picks up the *new* stretch beyond whatever's already spoken for. This
    // holds regardless of how many marriages share the row — it's just
    // more cuts along the same one line, never more lines.
    //
    // Grouping used to be keyed by the row's rounded Y (or X, in horizontal
    // mode) alone — which turned out to catch far more than intended: a
    // completely unrelated couple one generation up (someone's own
    // parents' marriage line, say) can land on the exact same generation
    // row purely by coincidence of layout, get lumped into the same
    // exclusive-zone group, and have its unrelated span "steal" a chunk out
    // of a real overlapping pair's trim — which is exactly what was
    // reported as an icon randomly appearing over the wrong relationship.
    // Two lines can only ever need trimming against each other if they fan
    // out from the *same* anchor card in the first place (the scenario
    // this whole mechanism exists for — one person, several spouses), so
    // grouping by that shared source person's id is both correct and
    // strictly narrower than "same row."
    //
    // This has to be a *group* computation (any one union's own zone
    // depends on where every other union sharing its anchor currently
    // sits), so it's wrapped in one function re-run as a whole rather than
    // having each line separately remember its own zone — see
    // applyAllZones below for why that distinction matters.
    const computeZones = () => {
      const sourceGroups = new Map<string, { entry: UnionLineEntry; lo: number; hi: number }[]>();
      const coordsByEntry = new Map<UnionLineEntry, ReturnType<typeof coordsOf>>();
      unionLineEntries.forEach((entry) => {
        const c = coordsOf(entry);
        coordsByEntry.set(entry, c);
        if (!c.sourceId) return;
        const a = c.axis === "y" ? c.x1 : c.y1;
        const b = c.axis === "y" ? c.x2 : c.y2;
        const item = { entry, lo: Math.min(a, b), hi: Math.max(a, b) };
        const group = sourceGroups.get(c.sourceId);
        if (group) group.push(item);
        else sourceGroups.set(c.sourceId, [item]);
      });

      const zoneByEntry = new Map<UnionLineEntry, { lo: number; hi: number }>();
      sourceGroups.forEach((group) => {
        if (group.length < 2) {
          group.forEach(({ entry, lo, hi }) => zoneByEntry.set(entry, { lo, hi }));
          return;
        }
        // Shortest (almost always the common, adjacent-spouse case) first —
        // it's the one every longer union of this same person yields to.
        const claimed: { lo: number; hi: number }[] = [];
        [...group]
          .sort((a, b) => a.hi - a.lo - (b.hi - b.lo))
          .forEach(({ entry, lo, hi }) => {
            let pieces: { lo: number; hi: number }[] = [{ lo, hi }];
            for (const claim of claimed) {
              pieces = pieces.flatMap(({ lo: pLo, hi: pHi }) => {
                if (claim.hi <= pLo || claim.lo >= pHi) return [{ lo: pLo, hi: pHi }];
                const rest: { lo: number; hi: number }[] = [];
                if (pLo < claim.lo) rest.push({ lo: pLo, hi: claim.lo });
                if (claim.hi < pHi) rest.push({ lo: claim.hi, hi: pHi });
                return rest;
              });
            }
            // A gap sandwiched between two shorter, already-claimed unions
            // on either side is the rare case this can't cleanly represent
            // as one contiguous zone — keeping the single largest leftover
            // piece is a reasonable fallback rather than adding a second
            // hit path for what should be a one-in-a-thousand layout.
            const zone = pieces.length
              ? pieces.reduce((biggest, piece) => (piece.hi - piece.lo > biggest.hi - biggest.lo ? piece : biggest))
              : { lo, hi };
            zoneByEntry.set(entry, zone);
            claimed.push({ lo, hi });
          });
      });

      // Keyed by union id *plus* this occurrence's own coordinates (see
      // occurrenceKey) — not just the UnionLineEntry object — so the
      // g.link-text icon-positioning loop below, which walks family-chart's
      // own separate g.link-text elements rather than unionLineEntries, can
      // look a union's zone up by the same `data-family-id` it already
      // stamps on each element. Plain union id alone would collapse two
      // rendered occurrences of the same union (a genealogical loop) into
      // one shared entry.
      const zoneByFamilyId = new Map<string, { lo: number; hi: number }>();
      zoneByEntry.forEach((zone, entry) => {
        const c = coordsByEntry.get(entry)!;
        zoneByFamilyId.set(`${entry.union.id}@${occurrenceKey(c.x1, c.y1, c.x2, c.y2)}`, zone);
      });

      return { zoneByEntry, coordsByEntry, zoneByFamilyId };
    };

    // The union's own icon(s) live at the same fixed spot the old
    // permanent mark used to sit (see correctLinkTextTransform), but stay
    // hidden — see the .union-mark-icons CSS — until the connecting line
    // itself is hovered (wired below), when they bubble in. The line
    // stays the actual interactive surface throughout (click/hover both
    // live there); this block only positions and builds the markup. The
    // line-hover handlers below look up the icon group by `data-family-id`
    // at hover time (a live DOM query, not a map captured here) — a union
    // whose `g.link-text` datum failed to resolve on this particular pass
    // (this loop, unlike the line-hover loop above, can legitimately skip
    // one) must not leave that union's hover handler permanently wired to
    // a stale/missing group until the next redraw.
    const linkTextEls = container.querySelectorAll<SVGGElement>("g.link-text");
    linkTextEls.forEach((g) => {
      const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
      const union =
        datum && unionsByPairKeyRef.current.get(pairKey(datum.nodes[0].data.id, datum.nodes[1].data.id));
      if (!union) return;

      g.setAttribute("data-family-id", union.id);
      // Disambiguates which *occurrence* of this union this particular
      // g.link-text is — see occurrenceKey's own comment. Without it,
      // hovering either rendered copy of a genealogical-loop union always
      // revealed whichever g.link-text happened to come first in DOM
      // order (family-id alone can't tell the two apart), so the mark
      // only ever bubbled in over its "twin" line, never the one actually
      // under the pointer.
      g.setAttribute(
        "data-occurrence",
        occurrenceKey(datum.nodes[0].x, datum.nodes[0].y, datum.nodes[1].x, datum.nodes[1].y),
      );
      const originalText = g.querySelector<SVGTextElement>(":scope > text");
      if (originalText) originalText.style.display = "none";
      let markGroup = g.querySelector<SVGGElement>(".union-mark-icons");
      if (!markGroup) {
        markGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        markGroup.setAttribute("class", "union-mark-icons");
        g.appendChild(markGroup);
      }
      markGroup.innerHTML = unionMarkMarkup(union);

      // Same settle problem as the union-line's own `d` below — family-
      // chart keeps nudging this element's transform via its own d3
      // transition, so a one-time apply here would just get overwritten
      // mid-animation. `lastApplied` guards against reacting to this same
      // code's own writes. Recomputes zones fresh on every apply (not just
      // once at wire time) for the same reason applyAllZones itself does —
      // see that function's own comment on why a stale, once-computed zone
      // can't be trusted across settle passes.
      let lastApplied: string | null = null;
      const apply = () => {
        const { zoneByFamilyId } = computeZones();
        const transform = correctLinkTextTransform(g, orientationRef.current, zoneByFamilyId);
        if (!transform) return;
        lastApplied = transform;
        g.setAttribute("transform", transform);
      };
      apply();
      let settleTimer: number | undefined;
      const scheduleApply = () => {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(apply, 120);
      };
      const observer = new MutationObserver(() => {
        if (g.getAttribute("transform") !== lastApplied) scheduleApply();
      });
      observer.observe(g, { attributes: true, attributeFilter: ["transform"] });
      linkTextCleanupRef.current.push(() => {
        window.clearTimeout(settleTimer);
        observer.disconnect();
      });
    });

    // Every union line's own drawing depends on all of its row's siblings,
    // not just itself — a spouse card sliding into its final layout
    // position can change where an *unrelated* line's zone should be
    // trimmed to. An earlier version had each line remember its own zone
    // once and reactively reapply that same (increasingly stale) value on
    // settle; that raced family-chart's own per-element, individually
    // *delayed* transitions (see its own `.delay(...)` calls) — two
    // sibling lines settling at different times could each reapply a zone
    // computed before the other had reached its final position, sometimes
    // leaving them overlapping. Recomputing every zone fresh from
    // `coordsOf` (which itself always re-reads current DOM state, never a
    // cached value) on every settle, for every line at once, is what
    // actually self-corrects regardless of which line's transition
    // triggered the recheck.
    // On-screen size of the #union-knot symbol — its own viewBox is
    // 1300x1031 (potrace's native trace size), so height keeps that same
    // ~1.26:1 aspect rather than being picked independently.
    const KNOT_WIDTH = 34;
    const KNOT_HEIGHT = KNOT_WIDTH / (1300 / 1031);

    const lastAppliedByEntry = new Map<UnionLineEntry, string>();
    const applyAllZones = () => {
      const { zoneByEntry, coordsByEntry } = computeZones();
      unionLineEntries.forEach((entry) => {
        const { p, hit, knot } = entry;
        const zone = zoneByEntry.get(entry)!;
        const c = coordsByEntry.get(entry)!;
        const d = c.axis === "y" ? `M${zone.lo},${c.y1}L${zone.hi},${c.y1}` : `M${c.x1},${zone.lo}L${c.x1},${zone.hi}`;
        lastAppliedByEntry.set(entry, d);
        p.setAttribute("d", d);
        hit.setAttribute("d", d);
        // Plain rope-colored stroke now (see the #union-knot <symbol>
        // above for the decorative mark that replaced the old tiled
        // chain-link <pattern>) — the union-line-glow hover rule below
        // still applies on top of this via drop-shadow, unaffected by the
        // switch away from a pattern fill.
        p.style.stroke = "var(--color-forest)";

        // Stamped once at the (zone-trimmed) line's own midpoint — always
        // inside the true rope segment, never on a card, by the same
        // exclusive-zone math the line itself is cut to. Vertical-mode
        // lines (axis "x": constant x, y varies) get the knot rotated 90°
        // in place around that same midpoint so the rope reads along the
        // line's own direction instead of sideways across it.
        const mid = (zone.lo + zone.hi) / 2;
        const centerX = c.axis === "y" ? mid : c.x1;
        const centerY = c.axis === "y" ? c.y1 : mid;
        knot.setAttribute("x", String(centerX - KNOT_WIDTH / 2));
        knot.setAttribute("y", String(centerY - KNOT_HEIGHT / 2));
        knot.setAttribute("width", String(KNOT_WIDTH));
        knot.setAttribute("height", String(KNOT_HEIGHT));
        knot.setAttribute("transform", c.axis === "x" ? `rotate(90 ${centerX} ${centerY})` : "");
      });
    };
    applyAllZones();

    let settleTimer: number | undefined;
    const scheduleApplyAll = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(applyAllZones, 120);
    };
    const drifted = () => unionLineEntries.some((entry) => entry.p.getAttribute("d") !== lastAppliedByEntry.get(entry));
    const observer = new MutationObserver(() => {
      if (drifted()) scheduleApplyAll();
    });
    unionLineEntries.forEach((entry) => observer.observe(entry.p, { attributes: true, attributeFilter: ["d"] }));
    linkTextCleanupRef.current.push(() => {
      window.clearTimeout(settleTimer);
      observer.disconnect();
    });

    unionLineEntries.forEach((entry) => {
      const { union, p, hit } = entry;
      const handleClick = (e: MouseEvent) => {
        e.stopPropagation();
        setInfoPanel(buildUnionInfoPanel(union, treeDataRef.current));
      };
      // No delay, no timer — unlike the person-card hover-preview below,
      // this is meant to be seen bubbling in immediately, well before a
      // 1s-style delay would ever fire (by request). Looked up live by
      // family id rather than a map snapshotted earlier in this same
      // redraw — see the comment above the g.link-text loop. Also matched
      // on this specific occurrence's own coordinates (see occurrenceKey),
      // not family id alone — a genealogical loop renders the same union
      // twice, and family id alone can't tell which of the two rendered
      // copies is the one actually being hovered.
      const findMarkGroup = () => {
        const c = coordsOf(entry);
        const occ = occurrenceKey(c.x1, c.y1, c.x2, c.y2);
        return container.querySelector<SVGGElement>(
          `g.link-text[data-family-id="${union.id}"][data-occurrence="${occ}"] .union-mark-icons`,
        );
      };
      // The glow used to be a CSS :has(~ .union-line-hitarea:hover) rule —
      // but every union's rails and hitarea are flat siblings inside the
      // same shared SVG group (family-chart draws all links into one <g>),
      // so `~` (general sibling) matched *any* union-line sitting earlier
      // in that shared list, not just this one's own pair — hovering one
      // relationship lit up an inconsistent subset of every other line
      // before it in DOM order. Toggling a class directly on this
      // closure's own elements (real element references, not a selector)
      // can't cross-match another union's elements.
      const handleEnter = () => {
        findMarkGroup()?.classList.add("union-mark-visible");
        p.classList.add("union-line-glow");
      };
      const handleLeave = () => {
        findMarkGroup()?.classList.remove("union-mark-visible");
        p.classList.remove("union-line-glow");
      };
      hit.onclick = handleClick;
      hit.onmouseenter = handleEnter;
      hit.onmouseleave = handleLeave;
    });

    // family-chart positions an only child's own card the same way it used
    // to position a union's marriage mark — a heuristic tied to one parent
    // plus a fixed offset, which assumes that parent's own row is a simple,
    // single-marriage one. That breaks down exactly like the union-mark bug
    // did: when one of the two parents has *another* marriage elsewhere in
    // their row, the heuristic lands the child's card under whichever
    // parent it anchored to instead of the couple's true center, so the
    // connecting line has to visibly bend to reach it — reported as one
    // only child's descent line looking crooked next to a sibling's own
    // (also an only child, but of a simply-married couple) perfectly
    // straight one.
    //
    // Scoped deliberately to only children — a multi-child family's
    // siblings are already laid out as a deliberate group by family-chart's
    // own logic (individually off-center from the parents by design, the
    // group centered overall), which this leaves untouched. An only child
    // has nothing else's layout depending on where their own card sits, so
    // nudging just that one card is safe.
    // Both the SVG-local coordinates (path.link's own datum) and the HTML
    // cards' pixel transforms use x for "spread" (siblings/spouses side by
    // side) and y for "depth" (generation) only in vertical mode — family-
    // chart swaps which screen axis plays which role in horizontal mode
    // (see correctLinkTextTransform's own comment on that swap). An
    // earlier version of this fix hardcoded x=spread/y=depth throughout,
    // which is only correct in vertical mode; in horizontal mode it forced
    // the child's card onto the *depth* axis instead of correcting its
    // spread, landing it at the same generation-column as its own parents
    // — reported as a lone child rendering stacked between its two parents
    // instead of past them. Reading both axes through these two helpers
    // (matching correctLinkTextTransform's own pattern) keeps this correct
    // in both orientations.
    const spreadLocal = (n: { x: number; y: number }) => (orientationRef.current === "horizontal" ? n.y : n.x);
    const depthLocal = (n: { x: number; y: number }) => (orientationRef.current === "horizontal" ? n.x : n.y);
    const cardWrapperPixelPos = (personId: string) => {
      const card = container.querySelector<HTMLElement>(`.card[data-id="${personId}"]`);
      const wrapper = card?.parentElement ?? null;
      const style = wrapper?.getAttribute("style");
      const match = style?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? { wrapper: wrapper!, x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const spreadPixel = (pos: { x: number; y: number }) => (orientationRef.current === "horizontal" ? pos.y : pos.x);

    type ChildLink = { p: SVGPathElement; targetId: string; parentIds: [string, string] };
    const childLinksByFamily = new Map<string, ChildLink[]>();
    container.querySelectorAll<SVGPathElement>("path.link").forEach((p) => {
      const datum = (p as unknown as { __data__?: PathLinkDatum }).__data__;
      if (!datum || !Array.isArray(datum.source)) return;
      const [s1, s2] = datum.source;
      const targetId = datum.target?.data?.id;
      if (!s1?.data?.id || !s2?.data?.id || !targetId) return;
      const famKey = pairKey(s1.data.id, s2.data.id);
      const item: ChildLink = { p, targetId, parentIds: [s1.data.id, s2.data.id] };
      const arr = childLinksByFamily.get(famKey);
      if (arr) arr.push(item);
      else childLinksByFamily.set(famKey, [item]);
    });

    childLinksByFamily.forEach((items) => {
      if (items.length !== 1) return;
      const { p, targetId, parentIds } = items[0];

      // Recomputed fresh on every apply (initial call and every settle
      // re-check below) rather than captured once — re-reads `p.__data__`
      // the same way coordsOf elsewhere does, so a later layout pass (or
      // an orientation toggle, which reroutes through orientationRef) can't
      // leave this acting on stale coordinates.
      const applyChildCorrection = () => {
        const datum = (p as unknown as { __data__?: PathLinkDatum }).__data__;
        const source = datum && Array.isArray(datum.source) ? datum.source : null;
        const [s1, s2] = source ?? [];
        const target = datum?.target;
        if (
          !s1 ||
          !s2 ||
          !target ||
          typeof s1.x !== "number" ||
          typeof s1.y !== "number" ||
          typeof s2.x !== "number" ||
          typeof s2.y !== "number" ||
          typeof target.x !== "number" ||
          typeof target.y !== "number"
        ) {
          return;
        }
        // Narrowing s1.x/s1.y above only narrows those property-access
        // expressions, not s1's own declared type (still PathLinkNode, with
        // optional x/y) — spreadLocal/depthLocal need plain {x,y} numbers.
        const s1Pt = { x: s1.x, y: s1.y };
        const s2Pt = { x: s2.x, y: s2.y };
        const targetPt = { x: target.x, y: target.y };
        const trueMidSpreadLocal = (spreadLocal(s1Pt) + spreadLocal(s2Pt)) / 2;
        const parentDepthLocal = depthLocal(s1Pt);
        const childDepthLocal = depthLocal(targetPt);
        if (Math.abs(spreadLocal(targetPt) - trueMidSpreadLocal) > 1) {
          const straightD =
            orientationRef.current === "horizontal"
              ? `M${childDepthLocal},${trueMidSpreadLocal}L${parentDepthLocal},${trueMidSpreadLocal}`
              : `M${trueMidSpreadLocal},${childDepthLocal}L${trueMidSpreadLocal},${parentDepthLocal}`;
          if (p.getAttribute("d") !== straightD) p.setAttribute("d", straightD);
        }

        // Pixel-space midpoint of the two parents' own card wrappers, read
        // live rather than converted from the SVG-local values above — the
        // two rendering layers (HTML cards vs. this SVG) apply their own
        // independent scale/offset, but since both are linear transforms of
        // the same underlying layout, computing the midpoint separately in
        // each space and applying each to its own layer stays consistent
        // without needing to know that conversion factor at all.
        const parentPositions = parentIds.map(cardWrapperPixelPos);
        const childPos = cardWrapperPixelPos(targetId);
        if (parentPositions[0] && parentPositions[1] && childPos) {
          const trueMidSpreadPixel = (spreadPixel(parentPositions[0]) + spreadPixel(parentPositions[1])) / 2;
          if (Math.abs(spreadPixel(childPos) - trueMidSpreadPixel) > 0.5) {
            const nextTransform =
              orientationRef.current === "horizontal"
                ? `translate(${childPos.x}px, ${trueMidSpreadPixel}px)`
                : `translate(${trueMidSpreadPixel}px, ${childPos.y}px)`;
            childPos.wrapper.style.transform = nextTransform;
          }
        }
      };
      applyChildCorrection();

      const childPosForObserve = cardWrapperPixelPos(targetId);
      let onlyChildSettleTimer: number | undefined;
      const scheduleChildCorrection = () => {
        window.clearTimeout(onlyChildSettleTimer);
        onlyChildSettleTimer = window.setTimeout(applyChildCorrection, 120);
      };
      const wrapperObserver = new MutationObserver(scheduleChildCorrection);
      if (childPosForObserve) wrapperObserver.observe(childPosForObserve.wrapper, { attributes: true, attributeFilter: ["style"] });
      const pathObserver = new MutationObserver(scheduleChildCorrection);
      pathObserver.observe(p, { attributes: true, attributeFilter: ["d"] });
      linkTextCleanupRef.current.push(() => {
        window.clearTimeout(onlyChildSettleTimer);
        wrapperObserver.disconnect();
        pathObserver.disconnect();
      });
    });
  }, [handleQuickAddClick]);

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

        // Extra room on both screen axes — by request, to keep a card's
        // own name/lifespan text (which hangs below the avatar) from
        // crowding the union line/knot running through the row underneath
        // it (worst in horizontal mode, where the knot was landing right on
        // top of that text), and to give the tree some breathing room
        // generally. family-chart swaps which of its two spacing knobs
        // (node_separation/level_separation) maps to which screen axis when
        // the tree is horizontal (see correctLinkTextTransform's own
        // comment on that swap) — level_separation ends up governing the
        // vertical screen axis in *both* orientations, and node_separation
        // the horizontal one in *both* (confirmed empirically: level_
        // separation is generation depth in vertical mode but the spouse-
        // stacking axis in horizontal mode, and both render vertically on
        // screen — node_separation is the mirror of that), so one call of
        // each is enough for both rather than needing an orientation-
        // specific branch. Defaults are 150/250 — the y-axis knob was
        // already bumped to 170 in an earlier round for the same "give the
        // text room" reason, then +15 (185) once the union-line knot itself
        // started landing on a card's own text — worst in horizontal mode
        // (governed by this same y-axis knob, hence the further +20 to 205
        // below), but requested for vertical mode's own union-line length
        // too, hence the matching x-axis bump.
        chart.setCardYSpacing(205);
        chart.setCardXSpacing(265);

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
        // A mobile on-screen keyboard opening (or closing) also fires
        // `resize` — window.innerHeight shrinks to match the now-smaller
        // visible area, same as it would for an actual smaller window —
        // so editing a form field was re-fitting (visibly re-zooming) the
        // tree underneath, then doing it again the other way once the
        // keyboard closed, reported as forcing you to back out just to
        // get the view back. Skipping while a form field is actively
        // focused covers that without having to track every modal's own
        // open state individually — a real window/monitor resize
        // essentially never happens to land exactly mid-keystroke.
        const active = document.activeElement;
        const isEditingField =
          active instanceof HTMLElement &&
          (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
        if (isEditingField) return;
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

      // wireCardAndUnionClicks already keeps one of these built and
      // correctly positioned per union at all times, just hidden (see its
      // own comment and the .union-mark-icons CSS) until the connecting
      // line is hovered — a static export can't hover, so this reuses
      // that same element and forces it visible for the capture instead
      // of building a second one from scratch.
      container.querySelectorAll<SVGGElement>("g.link-text .union-mark-icons").forEach((markGroup) => {
        const prevOpacity = markGroup.style.opacity;
        const prevTransform = markGroup.style.transform;
        markGroup.style.opacity = "1";
        markGroup.style.transform = "scale(1)";
        exportDomRestores.push(() => {
          markGroup.style.opacity = prevOpacity;
          markGroup.style.transform = prevTransform;
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
      // quick-add corner buttons are hover-gated via CSS opacity, so
      // they're already invisible on export — hidden here too anyway,
      // since all four are interactive affordances for the live app, not
      // something that belongs in a static picture of the tree.
      container
        .querySelectorAll<HTMLElement>(
          ".card-ancestry-toggle, .card-expand-toggle, .card-edit-toggle, .card-quickadd-toggle",
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

  // The new person's id comes in via AddPersonForm's onCreated contract but
  // is deliberately unused here — see handlePersonSaved's comment below,
  // same reasoning applies to creation as to editing.
  function handlePersonCreated(_newPersonId: string) {
    setShowAddForm(false);
    loadTree().catch((err: Error) => setError(err.message));
  }

  // The saved person's id comes in via EditPersonForm's onSaved contract
  // but is deliberately unused here — see the comment below.
  function handlePersonSaved(_personId: string) {
    setEditingPersonId(null);
    // Not passed as loadTree's own recenterOnId — editing or creating a
    // relative shouldn't move the selection, only clicking a card should
    // (reported: editing person Z while person X was centered silently
    // swapped the selection over to Z; the same happened when creating a
    // new relative Y while X was centered).
    loadTree().catch((err: Error) => setError(err.message));
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
          {/* A union line's stroke is painted with one of these two tiled
              chain-link pattern (an earlier attempt) into a plain solid
              rope-colored stroke (see applyAllZones, which now just sets
              `stroke: var(--color-forest)`) plus this one knot, stamped
              once at each line's own midpoint by applyAllZones/
              positionKnot — "atar el nudo" as the union's own mark, traced
              (via potrace) from the reference image supplied by request
              rather than hand-drawn, so the silhouette matches exactly.
              `<symbol>`/`<use>` (not a `<pattern>`) since this is one motif
              placed once per line, not tiled — `href` references resolve
              document-wide same as `url()` did, so this can live anywhere
              in the DOM; zero size, so it never affects layout. */}
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <symbol id="union-knot" viewBox="0 0 1300 1031">
                <g transform="translate(-0.207674,1031.632989) scale(0.1,-0.1)" fill="var(--color-forest)">
                  <path d="M9060 10314 c-14 -3 -88 -16 -165 -30 -399 -71 -645 -152 -988 -326 -582 -295 -1066 -711 -1469 -1264 -157 -216 -340 -525 -396 -669 l-20 -50 1255 3 1254 3 76 -73 c195 -188 294 -380 313 -609 12 -146 -3 -429 -29 -549 -46 -209 -129 -447 -225 -645 -334 -689 -869 -1371 -1288 -1642 -104 -67 -175 -89 -522 -158 -178 -35 -371 -80 -430 -99 -491 -161 -1183 -786 -1637 -1479 -95 -145 -207 -363 -193 -376 22 -23 715 -156 993 -191 586 -74 1320 -70 1874 10 538 78 1254 322 1780 606 579 312 1015 643 1395 1057 287 312 458 563 672 982 272 536 427 1081 497 1755 25 243 25 888 0 1090 -64 511 -200 986 -393 1372 -125 250 -206 371 -372 554 -196 216 -391 362 -672 503 -168 84 -281 125 -450 165 -219 53 -272 58 -560 61 -151 2 -286 1 -300 -1z" />
                  <path d="M6387 7390 c-289 -9 -336 -13 -517 -46 -771 -140 -1652 -498 -2325 -947 -230 -153 -516 -372 -665 -509 -248 -228 -555 -561 -712 -771 -426 -571 -738 -1217 -908 -1882 -70 -273 -95 -557 -87 -1002 5 -314 22 -418 110 -678 129 -376 270 -610 536 -888 169 -175 355 -309 596 -428 307 -150 631 -229 945 -229 285 0 584 80 904 242 276 141 590 390 875 693 159 171 440 532 464 597 7 20 16 18 -393 88 -348 60 -531 99 -848 181 -298 77 -472 127 -489 141 -43 36 37 314 192 663 224 503 692 1107 1190 1532 292 250 479 380 700 489 226 110 374 157 727 229 353 73 431 108 596 269 387 377 729 888 936 1396 115 284 148 458 129 671 -6 65 -17 129 -26 146 -15 27 -22 31 -79 37 -98 10 -1576 15 -1851 6z" />
                </g>
              </symbol>
            </defs>
          </svg>
          <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
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
      {(showAddForm || quickAddInitialRelation) && (
        <AddPersonForm
          treeId={treeId}
          people={treeData}
          initialRelation={quickAddInitialRelation ?? undefined}
          onCreated={(id) => {
            setQuickAddInitialRelation(null);
            handlePersonCreated(id);
          }}
          onClose={() => {
            setShowAddForm(false);
            setQuickAddInitialRelation(null);
          }}
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
      {quickAddPickerPersonId && (
        <QuickAddKindPicker
          loading={quickAddLoading}
          onPick={(kind) => handleQuickAddKindPicked(quickAddPickerPersonId, kind)}
          onClose={() => setQuickAddPickerPersonId(null)}
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
