import { useCallback, useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";
import { fetchTree } from "./api";
import AddPersonForm from "./AddPersonForm";
import EditPersonForm from "./EditPersonForm";
import TrashView from "./TrashView";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof f3.createChart> | null>(null);
  const backStackRef = useRef<string[]>([]);
  const currentMainIdRef = useRef<string | null>(null);
  const isGoingBackRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentMainId, setCurrentMainId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  const loadTree = useCallback(async (recenterOnId?: string) => {
    const data = await fetchTree();
    if (!containerRef.current) return;
    if (!data.length) {
      setError("No hay individuos en la base de datos todavía.");
      return;
    }

    if (!chartRef.current) {
      const chart = f3.createChart(containerRef.current, data);
      chart
        .setCardHtml()
        .setCardDisplay([["first name", "last name"], ["birthday"]]);
      // Bound how many generations render at once so the initial "fit"
      // stays readable no matter how large the real family tree grows.
      chart.setAncestryDepth(3);
      chart.setProgenyDepth(3);

      // Clicking a card re-centers the tree on it (chart.updateMainId
      // internally). Track that in our own stack so a "back" button can
      // undo it — the library only keeps main-id history to recover from
      // a deleted person, not for back/forward navigation.
      chart.setAfterUpdate(() => {
        const newMainId = chart.getMainDatum().id;
        if (newMainId === currentMainIdRef.current) return;
        if (!isGoingBackRef.current && currentMainIdRef.current) {
          backStackRef.current.push(currentMainIdRef.current);
          setCanGoBack(true);
        }
        isGoingBackRef.current = false;
        currentMainIdRef.current = newMainId;
        setCurrentMainId(newMainId);
      });

      chart.updateTree({ initial: true });
      chartRef.current = chart;
      currentMainIdRef.current = chart.getMainDatum().id;
      setCurrentMainId(chart.getMainDatum().id);
      return;
    }

    chartRef.current.updateData(data);
    if (recenterOnId) {
      chartRef.current.updateMainId(recenterOnId);
    }
    chartRef.current.updateTree({});
    currentMainIdRef.current = chartRef.current.getMainDatum().id;
    setCurrentMainId(currentMainIdRef.current);
  }, []);

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

  function handleBack() {
    const chart = chartRef.current;
    const previousId = backStackRef.current.pop();
    if (!chart || !previousId) return;

    isGoingBackRef.current = true;
    chart.updateMainId(previousId);
    chart.updateTree({});
    setCanGoBack(backStackRef.current.length > 0);
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
      {loading && <p className="status">Cargando árbol…</p>}
      {error && <p className="status status-error">{error}</p>}
      <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
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
