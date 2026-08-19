import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyIndividual, fetchTrees, type CopyMode, type ReportDirection, type TreeSummary } from "./api";
import IOSToggle from "./IOSToggle";

type Props = {
  treeId: string;
  personId: string;
  personName: string;
  onClose: () => void;
};

// Only OWNER/EDITOR trees are valid copy destinations — a VIEWER-role tree
// would just 403 on submit, so it's filtered out of the picker up front.
// The source tree itself is excluded too: "copy to another tree" implies a
// different one.
function isValidDestination(tree: TreeSummary, sourceTreeId: string): boolean {
  return tree.id !== sourceTreeId && (tree.role === "OWNER" || tree.role === "EDITOR");
}

export default function CopyPersonModal({ treeId, personId, personName, onClose }: Props) {
  const { t } = useTranslation();
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [loadingTrees, setLoadingTrees] = useState(true);
  const [destTreeId, setDestTreeId] = useState("");
  const [mode, setMode] = useState<CopyMode>("single");
  const [direction, setDirection] = useState<Exclude<ReportDirection, "both">>("ancestors");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ individuals: number; families: number } | null>(null);

  useEffect(() => {
    fetchTrees()
      .then(({ owned, shared }) => {
        setTrees([...owned, ...shared].filter((tree) => isValidDestination(tree, treeId)));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingTrees(false));
  }, [treeId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!destTreeId) return;
    setSubmitting(true);
    setError(null);
    try {
      const copied = await copyIndividual(personId, {
        destTreeId,
        mode,
        direction: mode === "lineage" ? direction : undefined,
      });
      setResult(copied);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("copyPerson.title", { name: personName })}</h2>

        {loadingTrees ? (
          <p className="status">{t("common.loading")}</p>
        ) : trees.length === 0 ? (
          <>
            <p className="status">{t("copyPerson.noDestTrees")}</p>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t("common.close")}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <fieldset>
              <label>
                {t("copyPerson.destTree")}
                <select value={destTreeId} onChange={(e) => setDestTreeId(e.target.value)} required>
                  <option value="">{t("copyPerson.destTreePlaceholder")}</option>
                  {trees.map((tree) => (
                    <option key={tree.id} value={tree.id}>
                      {tree.name}
                    </option>
                  ))}
                </select>
              </label>

              <IOSToggle checked={mode === "single"} onChange={() => setMode("single")} label={t("copyPerson.modeSingle")} />
              <IOSToggle checked={mode === "lineage"} onChange={() => setMode("lineage")} label={t("copyPerson.modeLineage")} />

              {mode === "lineage" && (
                <label>
                  {t("copyPerson.direction")}
                  <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                    <option value="ancestors">{t("report.ancestors")}</option>
                    <option value="descendants">{t("report.descendants")}</option>
                  </select>
                </label>
              )}
            </fieldset>

            {error && <p className="status status-error">{error}</p>}
            {result && (
              <p className="status">
                {t("copyPerson.success", { individuals: result.individuals, families: result.families })}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t("common.close")}
              </button>
              <button type="submit" disabled={!destTreeId || submitting}>
                {submitting ? t("copyPerson.submitting") : t("copyPerson.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
