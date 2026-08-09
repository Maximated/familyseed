import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import {
  fetchLineages,
  fetchTree,
  type Lineage,
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

// family-chart's own Datum type requires `gender: 'M' | 'F'`, but our data
// can omit it (unknown sex) — the library renders a genderless card fine at
// runtime, its type just doesn't spell out that case. Cast at the boundary
// rather than fighting the stricter type throughout this file.
type ChartData = Parameters<typeof f3.createChart>[1];

function applyLineageHighlight(
  container: HTMLElement,
  people: TreePerson[],
  selectedIds: Set<string>,
  colorById: Map<string, string>,
) {
  const lineagesById = new Map(people.map((p) => [p.id, p.data.lineageIds ?? []]));
  const cards = container.querySelectorAll<HTMLElement>(".card[data-id]");

  cards.forEach((card) => {
    const id = card.dataset.id;
    if (!id) return;

    if (selectedIds.size === 0) {
      card.classList.remove("lineage-highlight", "lineage-dim");
      card.style.removeProperty("--lineage-color");
      return;
    }

    const personLineageIds = lineagesById.get(id) ?? [];
    const matchId = personLineageIds.find((lineageId) => selectedIds.has(lineageId));
    if (matchId) {
      card.classList.add("lineage-highlight");
      card.classList.remove("lineage-dim");
      card.style.setProperty("--lineage-color", colorById.get(matchId) ?? "#888");
    } else {
      card.classList.add("lineage-dim");
      card.classList.remove("lineage-highlight");
      card.style.removeProperty("--lineage-color");
    }
  });
}

function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join("_");
}

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

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof f3.createChart> | null>(null);
  const backStackRef = useRef<string[]>([]);
  const currentMainIdRef = useRef<string | null>(null);
  const isGoingBackRef = useRef(false);
  const treeDataRef = useRef<TreePerson[]>([]);
  const unionsByPairKeyRef = useRef<Map<string, UnionInfo>>(new Map());
  const selectedLineageIdsRef = useRef<Set<string>>(new Set());
  const lineageColorByIdRef = useRef<Map<string, string>>(new Map());

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

  const runHighlight = useCallback(() => {
    if (!containerRef.current) return;
    applyLineageHighlight(
      containerRef.current,
      treeDataRef.current,
      selectedLineageIdsRef.current,
      lineageColorByIdRef.current,
    );
  }, []);

  const loadTree = useCallback(
    async (recenterOnId?: string) => {
      const { people, unions } = await fetchTree();
      if (!containerRef.current) return;
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
        chart
          .setCardHtml()
          .setCardDisplay([
            ["first name", "last name"],
            ["birth name"],
            ["birthday", "birth place"],
            ["deathday", "death place"],
          ]);
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
          }
          runHighlight();
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
    [runHighlight],
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
    lineageColorByIdRef.current = new Map(lineages.map((l) => [l.id, l.color ?? "#888"]));
    runHighlight();
  }, [lineages, runHighlight]);

  useEffect(() => {
    selectedLineageIdsRef.current = selectedLineageIds;
    runHighlight();
  }, [selectedLineageIds, runHighlight]);

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
          className="header-button"
          onClick={handleBack}
          disabled={!canGoBack}
          aria-label="Volver"
          title="Volver"
        >
          ← Volver
        </button>
        <h1>Árbol genealógico</h1>
        <button
          type="button"
          className="header-button"
          onClick={() => setShowEditForm(true)}
          disabled={!currentMainId}
        >
          Editar
        </button>
        <button type="button" className="header-button" onClick={() => setShowTrash(true)}>
          Papelera
        </button>
        <button type="button" className="header-button" onClick={() => setShowAddForm(true)}>
          + Añadir persona
        </button>
      </header>
      <LineageChips lineages={lineages} selectedIds={selectedLineageIds} onChange={setSelectedLineageIds} />
      <div className="union-legend">
        <span>⚭ Matrimonio</span>
        <span>⚭² 2º matrimonio (o más)</span>
        <span>⚯ Pareja de hecho</span>
        <span>※ Relación extramatrimonial</span>
        <span>⚮ Divorcio/separación</span>
        <span>✝ Unión finalizada por fallecimiento</span>
      </div>
      {loading && <p className="status">Cargando árbol…</p>}
      {error && <p className="status status-error">{error}</p>}
      <div className="main-area">
        <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
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
    </div>
  );
}

export default App;
