import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./i18n";
import {
  fetchLineages,
  fetchTree,
  mediaUrl,
  personReportUrl,
  updateTreeName,
  type Lineage,
  type ReportDirection,
  type TreePerson,
  type TreeRole,
  type UnionInfo,
  type UnionStatus,
  type UnionType,
} from "./api";
import { useAuth } from "./AuthContext";
import AddPersonForm from "./AddPersonForm";
import EditPersonForm from "./EditPersonForm";
import TrashView from "./TrashView";
import GedcomView from "./GedcomView";
import IndividualsSearchView from "./IndividualsSearchView";
import LineageChips from "./LineageChips";
import Timeline from "./Timeline";
import InfoPanel, { type InfoPanelData, type InfoPanelSection } from "./InfoPanel";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  HomeIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  UserIcon,
  UserPlusIcon,
} from "./Icons";

const REPORT_DIRECTIONS: ReportDirection[] = ["ancestors", "descendants", "both"];

// Native, untranslated names — a language switcher lists each language in
// its own tongue, not translated into whichever language is active.
const LANGUAGE_LABEL: Record<SupportedLanguage, string> = {
  es: "Español",
  en: "English",
  pl: "Polski",
};

// family-chart's own Datum type requires `gender: 'M' | 'F'`, but our data
// can omit it (unknown sex) — the library renders a genderless card fine at
// runtime, its type just doesn't spell out that case. Cast at the boundary
// rather than fighting the stricter type throughout this file.
type ChartData = Parameters<typeof f3.createChart>[1];

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
// divorce/etc. mark on a spouse link — just enough to recover which two
// people it joins.
type LinkTextDatum = { nodes: [{ data: { id: string } }, { data: { id: string } }] };

// Standard genealogical marks (⚭ marriage, ⚮ divorce, ⚯ unmarried
// partnership) plus a couple of homemade ones where no standard symbol
// exists — kept in the legend below the lineage chips since most people
// won't recognize them on sight.
const UNION_TYPE_SYMBOL: Record<UnionType, string> = {
  MARRIAGE: "⚭",
  PARTNERSHIP: "⚯",
  EXTRAMARITAL: "※",
  UNKNOWN: "",
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
    <div class="card-inner">
      ${avatarHtml}
      <div class="card-name name-text">${name}</div>
      ${alias ? `<div class="card-alias alias-text">«${alias}»</div>` : ""}
      ${birthName ? `<div class="card-birthname name-text">${birthName}</div>` : ""}
      ${lifespan ? `<div class="card-lifespan">${escapeHtml(lifespan)}</div>` : ""}
    </div>
    <button type="button" class="card-expand-toggle" data-person-id="${d.data.id}" title="${escapeHtml(i18n.t("card.viewFull"))}" aria-label="${escapeHtml(i18n.t("card.viewFull"))}">${EXPAND_ICON_SVG}</button>
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

  const items = [
    i18n.t("infoPanel.unionType", { value: i18n.t(`unionType.${union.unionType}`) }),
    i18n.t("infoPanel.unionStatus", { value: i18n.t(`unionStatus.${union.unionStatus}`) }),
    i18n.t("infoPanel.unionDate", { value: union.unionDateText ?? i18n.t("infoPanel.unknownDate") }),
  ];
  if (union.unionPlace) items.push(i18n.t("infoPanel.unionPlace", { value: union.unionPlace }));

  return {
    icon: <span className="info-panel-union-symbol">{unionIcon(union)}</span>,
    iconClassName: "info-panel-icon-union",
    title: `${name(partner1)} & ${name(partner2)}`,
    subtitle: union.order >= 2 ? i18n.t("infoPanel.unionOrder", { order: union.order }) : undefined,
    sections: [{ heading: i18n.t("infoPanel.unionHeading"), items }],
    familyId: union.id,
    notes: union.notes,
  };
}

function App() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { treeId } = useParams<{ treeId: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof f3.createChart> | null>(null);
  const backStackRef = useRef<string[]>([]);
  const currentMainIdRef = useRef<string | null>(null);
  const isGoingBackRef = useRef(false);
  const treeDataRef = useRef<TreePerson[]>([]);
  const unionsByPairKeyRef = useRef<Map<string, UnionInfo>>(new Map());
  const selectedLineageIdsRef = useRef<Set<string>>(new Set());
  const lineageMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const reportMenuRef = useRef<HTMLDivElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentMainId, setCurrentMainId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showGedcom, setShowGedcom] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [treeData, setTreeData] = useState<TreePerson[]>([]);
  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [selectedLineageIds, setSelectedLineageIds] = useState<Set<string>>(new Set());
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);
  const [treeName, setTreeName] = useState("");
  const [treeRole, setTreeRole] = useState<TreeRole | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showLineageMenu, setShowLineageMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);

  const runHighlight = useCallback(() => {
    if (!containerRef.current) return;
    applyLineageHighlight(containerRef.current, treeDataRef.current, selectedLineageIdsRef.current);
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

    container.querySelectorAll<SVGGElement>("g.link-text").forEach((g) => {
      // family-chart binds its d3 data straight onto the DOM node — no
      // extra plumbing needed to recover which two people this link joins.
      const datum = (g as unknown as { __data__?: LinkTextDatum }).__data__;
      const union = datum && unionsByPairKeyRef.current.get(pairKey(datum.nodes[0].data.id, datum.nodes[1].data.id));
      g.style.cursor = union ? "pointer" : "default";
      g.onclick = union
        ? (e) => {
            e.stopPropagation();
            setInfoPanel(buildUnionInfoPanel(union, treeDataRef.current));
          }
        : null;
    });
  }, []);

  const loadTree = useCallback(
    async (recenterOnId?: string) => {
      if (!treeId) return;
      const { name, role, people, unions } = await fetchTree(treeId);
      if (!containerRef.current) return;
      setTreeName(name);
      setTreeRole(role);
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
        // Bound how many generations render at once so the initial "fit"
        // stays readable no matter how large the real family tree grows.
        chart.setAncestryDepth(3);
        chart.setProgenyDepth(3);

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
            setCurrentMainId(newMainId);
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

        chart.updateTree({ initial: true });
        chartRef.current = chart;
        currentMainIdRef.current = chart.getMainDatum().id;
        setCurrentMainId(chart.getMainDatum().id);
        return;
      }

      chartRef.current.updateData(people as unknown as ChartData);
      if (recenterOnId) {
        chartRef.current.updateMainId(recenterOnId);
      }
      chartRef.current.updateTree({});
      currentMainIdRef.current = chartRef.current.getMainDatum().id;
      setCurrentMainId(currentMainIdRef.current);
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
    if (!showLineageMenu && !showUserMenu && !showLanguageMenu && !showReportMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (showLineageMenu && lineageMenuRef.current && !lineageMenuRef.current.contains(target)) {
        setShowLineageMenu(false);
      }
      if (showUserMenu && userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
      if (showLanguageMenu && languageMenuRef.current && !languageMenuRef.current.contains(target)) {
        setShowLanguageMenu(false);
      }
      if (showReportMenu && reportMenuRef.current && !reportMenuRef.current.contains(target)) {
        setShowReportMenu(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showLineageMenu, showUserMenu, showLanguageMenu, showReportMenu]);

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

    isGoingBackRef.current = true;
    chart.updateMainId(previousId);
    chart.updateTree({});
    setCanGoBack(backStackRef.current.length > 0);
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
    setShowEditForm(false);
    loadTree(personId).catch((err: Error) => setError(err.message));
  }

  function handlePersonDeleted() {
    setShowEditForm(false);
    // The deleted person can no longer be a valid "back" target.
    backStackRef.current = backStackRef.current.filter((id) => id !== currentMainId);
    setCanGoBack(backStackRef.current.length > 0);
    loadTree().catch((err: Error) => setError(err.message));
  }

  function handleTrashRestored() {
    loadTree().catch((err: Error) => setError(err.message));
  }

  function handleGedcomImported() {
    loadTree().catch((err: Error) => setError(err.message));
  }

  const currentPerson = currentMainId ? treeData.find((p) => p.id === currentMainId) : undefined;
  const currentPersonName = currentPerson ? `${currentPerson.data["first name"]} ${currentPerson.data["last name"]}`.trim() : null;

  if (!treeId) return null;

  return (
    <div className="app">
      <header className="app-header">
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

        <div className="header-actions">
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
              </div>
            )}
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={() => setShowEditForm(true)}
            disabled={!currentMainId}
            aria-label={t("app.edit")}
            title={t("app.edit")}
          >
            <PencilIcon />
          </button>

          <div className="popover-anchor" ref={reportMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowReportMenu((v) => !v)}
              disabled={!currentMainId}
              aria-label={t("app.report")}
              aria-expanded={showReportMenu}
              title={t("app.report")}
            >
              <FileTextIcon />
            </button>
            {showReportMenu && currentMainId && (
              <div className="popover report-popover">
                {REPORT_DIRECTIONS.map((direction) => (
                  <a
                    key={direction}
                    className="report-popover-item"
                    href={personReportUrl(treeId, currentMainId, direction)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setShowReportMenu(false)}
                  >
                    {t(`report.${direction}`)}
                  </a>
                ))}
              </div>
            )}
          </div>

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
            aria-label={t("app.addPerson")}
            title={t("app.addPerson")}
          >
            <UserPlusIcon />
          </button>

          <div className="popover-anchor" ref={userMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowUserMenu((v) => !v)}
              aria-label={t("app.user")}
              aria-expanded={showUserMenu}
              title={t("app.user")}
            >
              <UserIcon />
            </button>
            {showUserMenu && (
              <div className="popover user-popover">
                {user ? (
                  <>
                    <p className="user-popover-name">{user.name ?? user.email ?? t("app.defaultUserName")}</p>
                    {user.email && <p className="user-popover-email">{user.email}</p>}
                    {treeRole && <p className="user-popover-role">{t("app.role", { role: t(`roles.${treeRole}`) })}</p>}
                  </>
                ) : (
                  <p className="status">{t("common.loading")}</p>
                )}
              </div>
            )}
          </div>

          <div className="popover-anchor" ref={languageMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowLanguageMenu((v) => !v)}
              aria-label={t("app.language")}
              aria-expanded={showLanguageMenu}
              title={t("app.language")}
            >
              <GlobeIcon />
            </button>
            {showLanguageMenu && (
              <div className="popover language-popover">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`language-popover-item${i18n.language === lang ? " language-popover-item-active" : ""}`}
                    onClick={() => {
                      i18n.changeLanguage(lang);
                      setShowLanguageMenu(false);
                    }}
                    aria-pressed={i18n.language === lang}
                  >
                    {LANGUAGE_LABEL[lang]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      {loading && <p className="status">{t("app.loadingTree")}</p>}
      {error && <p className="status status-error">{error}</p>}
      <div className="main-area">
        <div className="tree-canvas-wrap">
          <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
          <div className="legend-panel">
            <span className="legend-item">
              <span className="legend-icon">⚭</span>
              <span className="legend-label">{t("legend.marriage")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚭²</span>
              <span className="legend-label">{t("legend.marriage2")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚯</span>
              <span className="legend-label">{t("legend.partnership")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">※</span>
              <span className="legend-label">{t("legend.extramarital")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">※²</span>
              <span className="legend-label">{t("legend.extramarital2")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚮</span>
              <span className="legend-label">{t("legend.endedByDivorce")}</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">✝</span>
              <span className="legend-label">{t("legend.endedByDeath")}</span>
            </span>
            <span className="legend-hint">{t("legend.hint")}</span>
          </div>
        </div>
        <Timeline people={treeData} onNavigate={handleTimelineNavigate} />
      </div>
      {showAddForm && (
        <AddPersonForm treeId={treeId} onCreated={handlePersonCreated} onClose={() => setShowAddForm(false)} />
      )}
      {showEditForm && currentMainId && (
        <EditPersonForm
          treeId={treeId}
          personId={currentMainId}
          onSaved={handlePersonSaved}
          onDeleted={handlePersonDeleted}
          onClose={() => setShowEditForm(false)}
        />
      )}
      {showTrash && (
        <TrashView treeId={treeId} onRestored={handleTrashRestored} onClose={() => setShowTrash(false)} />
      )}
      {showGedcom && (
        <GedcomView
          treeId={treeId}
          initialPersonId={currentMainId}
          initialPersonName={currentPersonName}
          onImported={handleGedcomImported}
          onClose={() => setShowGedcom(false)}
        />
      )}
      {showSearch && (
        <IndividualsSearchView treeId={treeId} onNavigateToPerson={handleNavigateToPerson} onClose={() => setShowSearch(false)} />
      )}
      {infoPanel && (
        <InfoPanel
          treeId={treeId}
          data={infoPanel}
          onClose={() => setInfoPanel(null)}
          onNavigateToPerson={handleNavigateToPerson}
        />
      )}
    </div>
  );
}

export default App;
