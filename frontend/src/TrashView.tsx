import { useEffect, useState } from "react";
import { fetchTrash, restoreIndividual, type Individual } from "./api";

type Props = {
  onRestored: () => void;
  onClose: () => void;
};

function formatDeletedAt(deletedAt: string | null | undefined) {
  if (!deletedAt) return "";
  return new Date(deletedAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
}

export default function TrashView({ onRestored, onClose }: Props) {
  const [people, setPeople] = useState<Individual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchTrash()
      .then(setPeople)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setError(null);
    try {
      await restoreIndividual(id);
      setPeople((prev) => prev.filter((p) => p.id !== id));
      onRestored();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Papelera</h2>

        {loading && <p className="status">Cargando…</p>}
        {error && <p className="status status-error">{error}</p>}

        {!loading && people.length === 0 && (
          <p className="status">No hay nadie en la papelera.</p>
        )}

        {people.length > 0 && (
          <ul className="trash-list">
            {people.map((person) => (
              <li key={person.id}>
                <div>
                  <div className="trash-list-name">
                    {person.givenNames} {[person.surname1, person.surname2].filter(Boolean).join(" ")}
                  </div>
                  <div className="trash-list-meta">Eliminado el {formatDeletedAt(person.deletedAt)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(person.id)}
                  disabled={restoringId === person.id}
                >
                  {restoringId === person.id ? "Restaurando…" : "Restaurar"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
