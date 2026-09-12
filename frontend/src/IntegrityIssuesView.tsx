import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIntegrityIssues, type IntegrityIssue } from "./api";

type Props = {
  treeId: string;
  onOpenPerson: (personId: string) => void;
  onClose: () => void;
};

// Read-only report: lists structural problems (parent/child cycles,
// someone with more than one biological family, mismatched links) and
// lets the user jump straight to editing whoever is involved — it never
// changes any data itself. See backend/src/tree-integrity.ts for why:
// an earlier automatic fix for one of these shapes briefly took
// production down, so this only ever points at where to go look.
export default function IntegrityIssuesView({ treeId, onOpenPerson, onClose }: Props) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<IntegrityIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchIntegrityIssues(treeId)
      .then((result) => {
        if (!cancelled) setIssues(result);
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
  }, [treeId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("integrity.title")}</h2>
        <p className="field-hint">{t("integrity.hint")}</p>

        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : error ? (
          <p className="status status-error">{error}</p>
        ) : issues.length === 0 ? (
          <p className="field-hint">{t("integrity.noIssues")}</p>
        ) : (
          <ul className="duplicates-suggestion-list">
            {issues.map((issue, i) => (
              <li key={i} className="duplicates-suggestion-row integrity-issue-row">
                <span>{issue.summary}</span>
                <span className="integrity-issue-actions">
                  {issue.personIds.map((personId, j) => (
                    <button key={personId} type="button" onClick={() => onOpenPerson(personId)}>
                      {t("integrity.openPerson", { name: issue.personNames[j] })}
                    </button>
                  ))}
                </span>
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
