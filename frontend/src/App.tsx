import { useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof f3.createChart> | null>(null);
  const backStackRef = useRef<string[]>([]);
  const currentMainIdRef = useRef<string | null>(null);
  const isGoingBackRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/tree`)
      .then((res) => {
        if (!res.ok) throw new Error(`La API respondió ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled || !containerRef.current) return;
        if (!data.length) {
          setError("No hay individuos en la base de datos todavía.");
          return;
        }

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
        });

        chart.updateTree({ initial: true });
        chartRef.current = chart;
        currentMainIdRef.current = chart.getMainDatum().id;
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleBack() {
    const chart = chartRef.current;
    const previousId = backStackRef.current.pop();
    if (!chart || !previousId) return;

    isGoingBackRef.current = true;
    chart.updateMainId(previousId);
    chart.updateTree({});
    setCanGoBack(backStackRef.current.length > 0);
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="back-button"
          onClick={handleBack}
          disabled={!canGoBack}
          aria-label="Volver"
          title="Volver"
        >
          ← Volver
        </button>
        <h1>Árbol genealógico</h1>
      </header>
      {loading && <p className="status">Cargando árbol…</p>}
      {error && <p className="status status-error">{error}</p>}
      <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
    </div>
  );
}

export default App;
