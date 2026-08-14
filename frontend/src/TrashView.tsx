import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchTrash, restoreIndividual, type Individual } from "./api";
import SwipeRow from "./SwipeRow";

type Props = {
  treeId: string;
  onRestored: () => void;
  onClose: () => void;
};

const DATE_LOCALE: Record<string, string> = { es: "es-ES", en: "en-US", pl: "pl-PL" };

function formatDeletedAt(deletedAt: string | null | undefined, language: string) {
  if (!deletedAt) return "";
  return new Date(deletedAt).toLocaleDateString(DATE_LOCALE[language] ?? "es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function TrashView({ treeId, onRestored, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [people, setPeople] = useState<Individual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchTrash(treeId)
      .then(setPeople)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [treeId]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setError(null);
    try {
      await restoreIndividual(treeId, id);
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
        <h2>{t("trash.title")}</h2>

        {loading && <p className="status">{t("common.loading")}</p>}
        {error && <p className="status status-error">{error}</p>}

        {!loading && people.length === 0 && (
          <p className="status">{t("trash.empty")}</p>
        )}

        {people.length > 0 && (
          <ul className="trash-list">
            {people.map((person) => (
              <li key={person.id}>
                <SwipeRow
                  actionsWidth={104}
                  actions={
                    <button
                      type="button"
                      onClick={() => handleRestore(person.id)}
                      disabled={restoringId === person.id}
                    >
                      {restoringId === person.id ? t("trash.restoring") : t("trash.restore")}
                    </button>
                  }
                >
                  <div>
                    <div className="trash-list-name">
                      {person.givenNames} {[person.surname1, person.surname2].filter(Boolean).join(" ")}
                    </div>
                    <div className="trash-list-meta">
                      {t("trash.deletedOn", { date: formatDeletedAt(person.deletedAt, i18n.language) })}
                    </div>
                  </div>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
