import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIndividuals, fetchLineages, type Individual, type IndividualFilters, type Lineage, type Sex } from "./api";
import { PencilIcon } from "./Icons";
import SwipeRow from "./SwipeRow";

type Props = {
  treeId: string;
  onNavigateToPerson: (personId: string) => void;
  // Optional: renders an edit button per result that opens EditPersonForm
  // directly instead of jumping into the tree canvas — used by the
  // "Personas" menu entry, where the point is editing someone who might
  // not even render on the canvas yet (e.g. right after a CSV import with
  // no relationships), not navigating to them.
  onEditPerson?: (personId: string) => void;
  onClose: () => void;
  // Preseeds the visible filters (sex, lineage, place, birth years) and
  // swaps the generic "Buscar personas" heading for something naming what
  // the caller already knows this list is — e.g. TreeStatsView opening
  // straight into "Hombres" instead of a blank search a visitor has to
  // reconstruct by hand. missingBirth/missingDeath have no matching
  // control (a one-off drill-down from a statistic, not a filter worth a
  // permanent dropdown) — they're merged into every fetch as a fixed
  // extra condition instead, on top of whatever the visible filters change.
  initialFilters?: IndividualFilters;
  title?: string;
};

function personLine(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  const year = p.birthDateText ? ` (${p.birthDateText})` : "";
  return `${[p.givenNames, surname].filter(Boolean).join(" ")}${year}`;
}

export default function IndividualsSearchView({
  treeId,
  onNavigateToPerson,
  onEditPerson,
  onClose,
  initialFilters,
  title,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [lineageId, setLineageId] = useState(initialFilters?.lineageId ?? "");
  const [birthYearFrom, setBirthYearFrom] = useState(initialFilters?.birthYearFrom?.toString() ?? "");
  const [birthYearTo, setBirthYearTo] = useState(initialFilters?.birthYearTo?.toString() ?? "");
  const [place, setPlace] = useState(initialFilters?.place ?? "");
  const [sex, setSex] = useState<Sex | "">(initialFilters?.sex ?? "");
  // Locked extras, not surfaced as a control (see the Props comment above)
  // — read directly off the prop rather than copied into state, since
  // nothing in this component ever changes them after mount.
  const missingBirth = initialFilters?.missingBirth;
  const missingDeath = initialFilters?.missingDeath;

  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [results, setResults] = useState<Individual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLineages(treeId)
      .then(setLineages)
      .catch(() => {
        // Purely a filter option — the rest of the screen still works without it.
      });
  }, [treeId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(() => {
      fetchIndividuals(treeId, {
        search: search.trim() || undefined,
        lineageId: lineageId || undefined,
        birthYearFrom: birthYearFrom ? Number(birthYearFrom) : undefined,
        birthYearTo: birthYearTo ? Number(birthYearTo) : undefined,
        place: place.trim() || undefined,
        sex: sex || undefined,
        missingBirth,
        missingDeath,
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
  }, [treeId, search, lineageId, birthYearFrom, birthYearTo, place, sex, missingBirth, missingDeath]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{title ?? t("search.title")}</h2>

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
          <select value={sex} onChange={(e) => setSex(e.target.value as Sex | "")}>
            <option value="">{t("search.sexAll")}</option>
            <option value="MALE">{t("statistics.sexMale")}</option>
            <option value="FEMALE">{t("statistics.sexFemale")}</option>
            <option value="UNKNOWN">{t("statistics.sexUnknown")}</option>
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
          <p className="field-hint">
            {t("search.resultsCount", { count: results.length })}
            {results.some((p) => p.hasNoRelationships) && ` — ${t("search.unlinkedHint")}`}
          </p>
        )}

        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : results.length === 0 ? (
          <p className="status">{t("search.noResults")}</p>
        ) : (
          <ul className="trash-list">
            {results.map((person) => (
              <li key={person.id}>
                <SwipeRow
                  actions={
                    onEditPerson && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onEditPerson(person.id)}
                        aria-label={t("editPerson.title")}
                        title={t("editPerson.title")}
                      >
                        <PencilIcon size={16} />
                      </button>
                    )
                  }
                >
                  <button
                    type="button"
                    className={`search-result-item${person.hasNoRelationships ? " search-result-item-unlinked" : ""}`}
                    onClick={() => {
                      onNavigateToPerson(person.id);
                      onClose();
                    }}
                  >
                    {personLine(person)}
                  </button>
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
