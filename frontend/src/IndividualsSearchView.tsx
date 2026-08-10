import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIndividuals, fetchLineages, type Individual, type Lineage } from "./api";

type Props = {
  onNavigateToPerson: (personId: string) => void;
  onClose: () => void;
};

function personLine(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  const year = p.birthDateText ? ` (${p.birthDateText})` : "";
  return `${[p.givenNames, surname].filter(Boolean).join(" ")}${year}`;
}

export default function IndividualsSearchView({ onNavigateToPerson, onClose }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [lineageId, setLineageId] = useState("");
  const [birthYearFrom, setBirthYearFrom] = useState("");
  const [birthYearTo, setBirthYearTo] = useState("");
  const [place, setPlace] = useState("");

  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [results, setResults] = useState<Individual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLineages()
      .then(setLineages)
      .catch(() => {
        // Purely a filter option — the rest of the screen still works without it.
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(() => {
      fetchIndividuals({
        search: search.trim() || undefined,
        lineageId: lineageId || undefined,
        birthYearFrom: birthYearFrom ? Number(birthYearFrom) : undefined,
        birthYearTo: birthYearTo ? Number(birthYearTo) : undefined,
        place: place.trim() || undefined,
      })
        .then((people) => {
          if (!cancelled) setResults(people);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search, lineageId, birthYearFrom, birthYearTo, place]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("search.title")}</h2>

        <fieldset>
          <legend>{t("search.title")}</legend>
          <input
            type="text"
            placeholder={t("search.namePlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <select value={lineageId} onChange={(e) => setLineageId(e.target.value)}>
            <option value="">{t("search.lineageAll")}</option>
            {lineages.map((lineage) => (
              <option key={lineage.id} value={lineage.id}>
                {lineage.name}
              </option>
            ))}
          </select>
          <div className="search-year-range">
            <span>{t("search.birthFrom")}</span>
            <input
              type="number"
              value={birthYearFrom}
              onChange={(e) => setBirthYearFrom(e.target.value)}
              style={{ width: "6rem" }}
            />
            <span>{t("search.birthTo")}</span>
            <input
              type="number"
              value={birthYearTo}
              onChange={(e) => setBirthYearTo(e.target.value)}
              style={{ width: "6rem" }}
            />
          </div>
          <input
            type="text"
            placeholder={t("search.placePlaceholder")}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </fieldset>

        {error && <p className="status status-error">{error}</p>}
        {!error && !loading && (
          <p className="field-hint">{t("search.resultsCount", { count: results.length })}</p>
        )}

        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : results.length === 0 ? (
          <p className="status">{t("search.noResults")}</p>
        ) : (
          <ul className="trash-list">
            {results.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="search-result-item"
                  onClick={() => {
                    onNavigateToPerson(person.id);
                    onClose();
                  }}
                >
                  {personLine(person)}
                </button>
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
