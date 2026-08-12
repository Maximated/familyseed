import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDuplicateSuggestions, fetchIndividuals, type DuplicateSuggestion, type Individual } from "./api";
import PersonPicker from "./PersonPicker";
import MergeReviewModal from "./MergeReviewModal";

type Props = {
  treeId: string;
  onClose: () => void;
  onMerged: () => void;
};

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function DuplicatesView({ treeId, onClose, onMerged }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<DuplicateSuggestion[]>([]);
  const [people, setPeople] = useState<Individual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualA, setManualA] = useState<Individual | null>(null);
  const [manualB, setManualB] = useState<Individual | null>(null);

  const [reviewPair, setReviewPair] = useState<{ aId: string; bId: string } | null>(null);

  function load() {
    setLoading(true);
    Promise.all([fetchDuplicateSuggestions(treeId), fetchIndividuals(treeId)])
      .then(([fetchedSuggestions, fetchedPeople]) => {
        setSuggestions(fetchedSuggestions);
        setPeople(fetchedPeople);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [treeId]);

  function personById(id: string): Individual | undefined {
    return people.find((p) => p.id === id);
  }

  function handleMerged() {
    setReviewPair(null);
    setManualA(null);
    setManualB(null);
    load();
    onMerged();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("duplicates.title")}</h2>

        <fieldset>
          <legend>{t("duplicates.suggestionsLegend")}</legend>
          {loading ? (
            <p className="status">{t("common.loading")}</p>
          ) : error ? (
            <p className="status status-error">{error}</p>
          ) : suggestions.length === 0 ? (
            <p className="field-hint">{t("duplicates.noSuggestions")}</p>
          ) : (
            <ul className="duplicates-suggestion-list">
              {suggestions.map((suggestion) => {
                const personA = personById(suggestion.aId);
                const personB = personById(suggestion.bId);
                if (!personA || !personB) return null;
                return (
                  <li key={`${suggestion.aId}-${suggestion.bId}`} className="duplicates-suggestion-row">
                    <span>
                      {personLabel(personA)} · {personLabel(personB)}
                    </span>
                    <span className="field-hint">
                      {t(suggestion.confidence === "high" ? "duplicates.confidenceHigh" : "duplicates.confidencePossible")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReviewPair({ aId: suggestion.aId, bId: suggestion.bId })}
                    >
                      {t("duplicates.review")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <fieldset>
          <legend>{t("duplicates.manualLegend")}</legend>
          <p className="field-hint">{t("duplicates.manualHint")}</p>
          <p className="field-hint">{t("duplicates.personALabel")}</p>
          <PersonPicker treeId={treeId} selectedName={manualA ? personLabel(manualA) : null} onSelect={setManualA} />
          <p className="field-hint">{t("duplicates.personBLabel")}</p>
          <PersonPicker treeId={treeId} selectedName={manualB ? personLabel(manualB) : null} onSelect={setManualB} />
          <div className="modal-actions">
            <button
              type="button"
              disabled={!manualA || !manualB || manualA.id === manualB.id}
              onClick={() => manualA && manualB && setReviewPair({ aId: manualA.id, bId: manualB.id })}
            >
              {t("duplicates.compare")}
            </button>
          </div>
          {manualA && manualB && manualA.id === manualB.id && (
            <p className="status status-error">{t("duplicates.samePersonError")}</p>
          )}
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>

      {reviewPair && (
        <MergeReviewModal
          treeId={treeId}
          aId={reviewPair.aId}
          bId={reviewPair.bId}
          onMerged={handleMerged}
          onClose={() => setReviewPair(null)}
        />
      )}
    </div>
  );
}
