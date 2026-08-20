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
  type UnionStatus,
  type UnionType,
} from "./api";
import AddPersonForm from "./AddPersonForm";
import EditPersonForm from "./EditPersonForm";
import TrashView from "./TrashView";
import IndividualsSearchView from "./IndividualsSearchView";
import LineageChips from "./LineageChips";
import Timeline from "./Timeline";
import Legend from "./Legend";
import InfoPanel, { type InfoPanelData, type InfoPanelSection } from "./InfoPanel";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ColumnsIcon,
  DuplicatesIcon,
  UnresolvedIcon,
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
// node for a spouse link.
// A single-parent family (the other parent unknown) leaves that slot in
// `source` empty rather than omitted, so it must be tolerated here too.
type PathLinkNode = { data: { id: string } };
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

  const sp1Spread = spread(sp1);
  const sp2Spread = spread(sp2);
  const rowDepth = depth(sp1) - 3;
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

  if (between.length === 0) return toTransform(rawMidSpread, rowDepth);

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
  return toTransform(bestMid, rowDepth);
}

// Standard genealogical marks (⚭ marriage, ⚮ divorce, ⚯ unmarried
// partnership) plus a couple of homemade ones where no standard symbol
// exists — kept in the legend below the lineage chips since most people
// won't recognize them on sight.
// UNKNOWN gets its own mark rather than an empty string — it's a common,
// permanent state (every family attachParent auto-creates when linking a
// parent to a child defaults to it, since there's no union info to record
// at that point), not a rare edge case. An empty string here previously
// made those unions render with no mark at all, i.e. invisible on the
// canvas even though the relationship is real — see the "ya existe esa
// relación" bug report.
const UNION_TYPE_SYMBOL: Record<UnionType, string> = {
  MARRIAGE: "⚭",
  PARTNERSHIP: "⚯",
  EXTRAMARITAL: "※",
  UNKNOWN: "○",
};

const UNION_STATUS_SYMBOL: Record<UnionStatus, string> = {
  ONGOING: "",
  ENDED_BY_DEATH: "✝",
  DIVORCED: "⚮",
  SEPARATED: "⚮",
  ANNULLED: "⚮",
};

const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

function toSuperscript(n: number): string {
  return String(n)
    .split("")
    .map((digit) => SUPERSCRIPT_DIGITS[Number(digit)])
    .join("");
}

function unionIcon(union: UnionInfo): string {
  const type = UNION_TYPE_SYMBOL[union.unionType] ?? "";
  const order = union.order >= 2 ? toSuperscript(union.order) : "";
  const status = UNION_STATUS_SYMBOL[union.unionStatus] ?? "";
  return `${type}${order}${status}`;
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

  return {
    icon: <span className="info-panel-union-symbol">{unionIcon(union)}</span>,
    iconClassName: "info-panel-icon-union",
    title: `${name(partner1)} & ${name(partner2)}`,
    subtitle: union.order >= 2 ? i18n.t("infoPanel.unionOrder", { order: union.order }) : undefined,
    sections: [],
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
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  // wireCardAndUnionClicks (below) is a long-lived useCallback that doesn't
  // list `orientation` as a dependency — correctLinkTextTransform's settle
  // timer can still be pending from before an orientation toggle, so it
  // reads this ref instead of the closed-over state to always use the
  // orientation current at the moment it actually runs.
  const orientationRef = useRef(orientation);
  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);
  const [legendMagnified, setLegendMagnified] = useState(false);

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

    let ancestrySettleTimer: number | undefined;
    const scheduleAncestryUpdate = () => {
      window.clearTimeout(ancestrySettleTimer);
      ancestrySettleTimer = window.setTimeout(updateAncestryToggles, 150);
    };
    scheduleAncestryUpdate();
    const cardSetObserver = new MutationObserver(scheduleAncestryUpdate);
    cardSetObserver.observe(container, { childList: true, subtree: true });
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

    const linkTextEls = container.querySelectorAll<SVGGElement>("g.link-text");
    // Every card that has a spouse shows up as a node on at least one
    // link-text's datum, so this doubles as "every card position in the
    // current render" for the collision check in correctLinkTextTransform.
    const allNodes = [...linkTextEls].flatMap((g) => {
      const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
      return datum ? datum.nodes : [];
    });

    linkTextEls.forEach((g) => {
      // family-chart binds its d3 data straight onto the DOM node — no
      // extra plumbing needed to recover which two people this link joins.
      const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
      if (datum && (!cardIds.has(datum.nodes[0].data.id) || !cardIds.has(datum.nodes[1].data.id))) {
        g.style.display = "none";
        g.onclick = null;
        return;
      }
      g.style.display = "";
      const union = datum && unionsByPairKeyRef.current.get(pairKey(datum.nodes[0].data.id, datum.nodes[1].data.id));
      g.style.cursor = union ? "pointer" : "default";
      g.onclick = union
        ? (e) => {
            e.stopPropagation();
            setInfoPanel(buildUnionInfoPanel(union, treeDataRef.current));
          }
        : null;

      // family-chart re-sets this element's transform via its own d3
      // transition on every update, so correcting it once here would just
      // get overwritten mid-animation. Instead, wait for the transition to
      // settle (no further transform mutations for 120ms) and correct it
      // then — see correctLinkTextTransform for why it needs correcting.
      let settleTimer: number | undefined;
      const settle = () => {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          const correct = correctLinkTextTransform(g, allNodes, orientationRef.current);
          if (correct && g.getAttribute("transform") !== correct) {
            g.setAttribute("transform", correct);
          }
        }, 120);
      };
      settle();
      const observer = new MutationObserver(settle);
      observer.observe(g, { attributes: true, attributeFilter: ["transform"] });
      linkTextCleanupRef.current.push(() => {
        window.clearTimeout(settleTimer);
        observer.disconnect();
      });
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

        // Marriage/divorce/etc. marks on the spouse link — looked up by pair
        // of ids from a ref so this stays fresh across data reloads without
        // re-registering the callback (family-chart only reads it once).
        chart.setLinkSpouseText((sp1, sp2) => {
          const union = unionsByPairKeyRef.current.get(pairKey(sp1.data.id, sp2.data.id));
          return union ? unionIcon(union) : "";
        });

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

  // Manual fallback for the auto-derivation every create/edit/import
  // already does on its own — for data that predates that feature, or an
  // older import that ran before this codebase's own gap was fixed.
  async function handleDeriveLineages() {
    if (!treeId) return;
    setDerivingLineages(true);
    setDeriveLineagesMessage(null);
    try {
      const updated = await deriveLineages(treeId);
      setLineages(updated);
      setDeriveLineagesMessage(t("lineagesManage.deriveDone", { count: updated.length }));
    } catch (err) {
      setDeriveLineagesMessage((err as Error).message);
    } finally {
      setDerivingLineages(false);
    }
  }

  function handleTimelineNavigate(personId: string) {
    const chart = chartRef.current;
    if (!chart) return;
    chart.updateMainId(personId);
    chart.updateTree({});
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

        <div className="header-menu">
          <button
            type="button"
            className="icon-button header-menu-trigger"
            aria-label={t("app.moreActions")}
            title={t("app.moreActions")}
          >
            <MenuIcon />
          </button>
          <div className="header-menu-items">
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
          {/* Floats over the canvas here in vertical mode (where the canvas
              is tall enough that its bottom edge is well clear of any
              card). In horizontal mode it renders in the other spot below
              instead — see that one's comment for why. */}
          {orientation === "vertical" && (
            <Legend magnified={legendMagnified} onToggle={() => setLegendMagnified((v) => !v)} />
          )}
        </div>
        {/* In horizontal mode the canvas is much shorter (the timeline strip
            below eats into its height), so floating the legend over either
            of its edges started covering cards instead. Rendering it here —
            a sibling of the canvas, not an overlay on top of it — gives it
            its own row between the canvas and the timeline strip, taking up
            real space instead of covering something else's. */}
        {orientation === "horizontal" && (
          <Legend magnified={legendMagnified} onToggle={() => setLegendMagnified((v) => !v)} />
        )}
        <Timeline people={treeData} orientation={orientation} onNavigate={handleTimelineNavigate} />
      </div>
      {showAddForm && (
        <AddPersonForm treeId={treeId} onCreated={handlePersonCreated} onClose={() => setShowAddForm(false)} />
      )}
      {editingPersonId && (
        <EditPersonForm
          treeId={treeId}
          personId={editingPersonId}
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
