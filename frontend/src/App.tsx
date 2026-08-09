import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import {
  fetchLineages,
  fetchMe,
  fetchTree,
  updateTreeName,
  type Lineage,
  type Me,
  type TreePerson,
  type UnionInfo,
  type UnionStatus,
  type UnionType,
} from "./api";
import AddPersonForm from "./AddPersonForm";
import EditPersonForm from "./EditPersonForm";
import TrashView from "./TrashView";
import LineageChips from "./LineageChips";
import Timeline from "./Timeline";
import InfoPanel, { type InfoPanelData, type InfoPanelSection } from "./InfoPanel";
import { ArrowLeftIcon, GitBranchIcon, PencilIcon, Trash2Icon, UserIcon, UserPlusIcon } from "./Icons";

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

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Propietario",
  EDITOR: "Editor",
  VIEWER: "Lector",
};

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

const UNION_TYPE_LABEL: Record<UnionType, string> = {
  MARRIAGE: "Matrimonio",
  PARTNERSHIP: "Pareja de hecho",
  EXTRAMARITAL: "Relación extramatrimonial",
  UNKNOWN: "Desconocido",
};

const UNION_STATUS_LABEL: Record<UnionStatus, string> = {
  ONGOING: "En curso",
  ENDED_BY_DEATH: "Finalizada por fallecimiento",
  DIVORCED: "Divorcio",
  SEPARATED: "Separación",
  ANNULLED: "Anulación",
};

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
  return precision === "ABOUT" ? `c. ${year}` : String(year);
}

function formatLifespan(
  birthYear: number | undefined,
  deathYear: number | undefined,
  birthPrecision: unknown,
  deathPrecision: unknown,
): string {
  const birth = yearLabel(birthYear, birthPrecision);
  const death = yearLabel(deathYear, deathPrecision);
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `n. ${birth}`;
  if (death) return `† ${death}`;
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
  return `
    <div class="card-inner">
      <div class="card-name name-text">${name}</div>
      ${alias ? `<div class="card-alias alias-text">«${alias}»</div>` : ""}
      ${birthName ? `<div class="card-birthname name-text">${birthName}</div>` : ""}
      ${lifespan ? `<div class="card-lifespan">${escapeHtml(lifespan)}</div>` : ""}
    </div>
    <button type="button" class="card-expand-toggle" data-person-id="${d.data.id}" title="Ver ficha completa" aria-label="Ver ficha completa">${EXPAND_ICON_SVG}</button>
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
  if (surnameLine) identity.push(`Apellidos: ${surnameLine}`);
  if (d.alias) identity.push(`Apodo: «${String(d.alias)}»`);
  identity.push(`Sexo: ${d.gender === "F" ? "Mujer" : d.gender === "M" ? "Hombre" : "Desconocido"}`);
  sections.push({ heading: "Identidad", items: identity });

  const birth = [d.birthday, d["birth place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
  sections.push({ heading: "Nacimiento", items: birth.length ? birth : ["Desconocido"] });

  if (d.deathday || d["death place"]) {
    const death = [d.deathday, d["death place"]].filter((v): v is string => typeof v === "string" && v.length > 0);
    sections.push({ heading: "Defunción", items: death });
  }

  if (d.notes) sections.push({ heading: "Notas", items: splitLines(String(d.notes)) });
  if (d.biography) sections.push({ heading: "Biografía", items: splitLines(String(d.biography)) });

  return {
    icon: <UserIcon size={20} />,
    iconClassName:
      d.gender === "F" ? "info-panel-icon-female" : d.gender === "M" ? "info-panel-icon-male" : "info-panel-icon-other",
    title: `${d["first name"]} ${d["last name"]}`.trim(),
    subtitle: d["birth name"] ? String(d["birth name"]) : undefined,
    sections,
  };
}

function buildUnionInfoPanel(union: UnionInfo, people: TreePerson[]): InfoPanelData {
  const partner1 = people.find((p) => p.id === union.partner1Id);
  const partner2 = people.find((p) => p.id === union.partner2Id);
  const name = (p?: TreePerson) => (p ? `${p.data["first name"]} ${p.data["last name"]}`.trim() : "?");

  const items = [
    `Tipo: ${UNION_TYPE_LABEL[union.unionType]}`,
    `Estado: ${UNION_STATUS_LABEL[union.unionStatus]}`,
    `Fecha: ${union.unionDateText ?? "Desconocida"}`,
  ];
  if (union.unionPlace) items.push(`Lugar: ${union.unionPlace}`);

  return {
    icon: <span className="info-panel-union-symbol">{unionIcon(union)}</span>,
    iconClassName: "info-panel-icon-union",
    title: `${name(partner1)} & ${name(partner2)}`,
    subtitle: union.order >= 2 ? `${union.order}ª unión` : undefined,
    sections: [{ heading: "Detalles de la unión", items }],
  };
}

function App() {
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

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentMainId, setCurrentMainId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [treeData, setTreeData] = useState<TreePerson[]>([]);
  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [selectedLineageIds, setSelectedLineageIds] = useState<Set<string>>(new Set());
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);
  const [treeName, setTreeName] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showLineageMenu, setShowLineageMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

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
      const { name, people, unions } = await fetchTree();
      if (!containerRef.current) return;
      setTreeName(name);
      if (!people.length) {
        setError("No hay individuos en la base de datos todavía.");
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
    [runHighlight, wireCardAndUnionClicks],
  );

  useEffect(() => {
    let cancelled = false;

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
  }, [loadTree]);

  useEffect(() => {
    fetchLineages()
      .then(setLineages)
      .catch(() => {
        // Purely a navigation aid — the tree itself still works without it.
      });
  }, []);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => {
        // No auth exists yet — the user icon just shows less if this fails.
      });
  }, []);

  useEffect(() => {
    selectedLineageIdsRef.current = selectedLineageIds;
    runHighlight();
  }, [selectedLineageIds, runHighlight]);

  useEffect(() => {
    if (!showLineageMenu && !showUserMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (showLineageMenu && lineageMenuRef.current && !lineageMenuRef.current.contains(target)) {
        setShowLineageMenu(false);
      }
      if (showUserMenu && userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showLineageMenu, showUserMenu]);

  function handleTitleClick() {
    setTitleDraft(treeName);
    setEditingTitle(true);
  }

  function handleTitleCommit() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === treeName) return;

    const previousName = treeName;
    setTreeName(trimmed);
    updateTreeName(trimmed).catch((err: Error) => {
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

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="icon-button"
          onClick={handleBack}
          disabled={!canGoBack}
          aria-label="Volver"
          title="Volver"
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
          <h1 className="tree-title" onClick={handleTitleClick} title="Pulsa para renombrar el árbol">
            {treeName || "Árbol genealógico"}
          </h1>
        )}

        <div className="header-actions">
          <div className="popover-anchor" ref={lineageMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowLineageMenu((v) => !v)}
              aria-label="Linajes"
              aria-expanded={showLineageMenu}
              title="Linajes"
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
            aria-label="Editar"
            title="Editar"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowTrash(true)}
            aria-label="Papelera"
            title="Papelera"
          >
            <Trash2Icon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowAddForm(true)}
            aria-label="Añadir persona"
            title="Añadir persona"
          >
            <UserPlusIcon />
          </button>

          <div className="popover-anchor" ref={userMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowUserMenu((v) => !v)}
              aria-label="Usuario"
              aria-expanded={showUserMenu}
              title="Usuario"
            >
              <UserIcon />
            </button>
            {showUserMenu && (
              <div className="popover user-popover">
                {me ? (
                  <>
                    <p className="user-popover-name">{me.name ?? me.email ?? "Usuario"}</p>
                    {me.email && <p className="user-popover-email">{me.email}</p>}
                    <p className="user-popover-role">Rol: {ROLE_LABEL[me.role] ?? me.role}</p>
                  </>
                ) : (
                  <p className="status">Cargando…</p>
                )}
                <p className="field-hint">Modo autohospedado: un único usuario.</p>
              </div>
            )}
          </div>
        </div>
      </header>
      {loading && <p className="status">Cargando árbol…</p>}
      {error && <p className="status status-error">{error}</p>}
      <div className="main-area">
        <div className="tree-canvas-wrap">
          <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
          <div className="legend-panel">
            <span className="legend-item">
              <span className="legend-icon">⚭</span>
              <span className="legend-label">Matrimonio</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚭²</span>
              <span className="legend-label">2º matrimonio (o más)</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚯</span>
              <span className="legend-label">Pareja de hecho</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">※</span>
              <span className="legend-label">Relación extramatrimonial</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">※²</span>
              <span className="legend-label">2ª relación extramatrimonial (o más)</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">⚮</span>
              <span className="legend-label">Divorcio/separación</span>
            </span>
            <span className="legend-item">
              <span className="legend-icon">✝</span>
              <span className="legend-label">Unión finalizada por fallecimiento</span>
            </span>
            <span className="legend-hint">Pulsa un icono de unión, o el de una tarjeta, para ver el detalle</span>
          </div>
        </div>
        <Timeline people={treeData} onNavigate={handleTimelineNavigate} />
      </div>
      {showAddForm && (
        <AddPersonForm onCreated={handlePersonCreated} onClose={() => setShowAddForm(false)} />
      )}
      {showEditForm && currentMainId && (
        <EditPersonForm
          personId={currentMainId}
          onSaved={handlePersonSaved}
          onDeleted={handlePersonDeleted}
          onClose={() => setShowEditForm(false)}
        />
      )}
      {showTrash && (
        <TrashView onRestored={handleTrashRestored} onClose={() => setShowTrash(false)} />
      )}
      {infoPanel && <InfoPanel data={infoPanel} onClose={() => setInfoPanel(null)} />}
    </div>
  );
}

export default App;
