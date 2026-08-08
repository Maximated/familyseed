import { useEffect, useRef, useState } from "react";
import * as f3 from "family-chart";
import "family-chart/styles/family-chart.css";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        chart.updateTree({ initial: true });
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Árbol genealógico</h1>
      </header>
      {loading && <p className="status">Cargando árbol…</p>}
      {error && <p className="status status-error">{error}</p>}
      <div id="FamilyChart" ref={containerRef} className="f3 tree-container" />
    </div>
  );
}

export default App;
