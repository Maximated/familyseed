import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { deleteTree } from "./api";

type Props = {
  treeId: string;
  treeName: string;
  onDeleted: () => void;
  onClose: () => void;
};

// Typing the tree's own name is the confirmation, same friction GitHub uses
// for deleting a repo — appropriate here since there's no trash/undo the
// way there is for a single person: everything in the tree is gone for
// good, so a plain "¿seguro?" click felt too easy to hit by accident.
export default function DeleteTreeModal({ treeId, treeName, onDeleted, onClose }: Props) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteTree(treeId, confirmName);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("deleteTree.title")}</h2>
        <p>
          <Trans i18nKey="deleteTree.warning" values={{ name: treeName }} components={{ 1: <strong /> }} />
        </p>
        <label>
          <Trans i18nKey="deleteTree.confirmLabel" values={{ name: treeName }} components={{ 1: <strong /> }} />
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>
        {error && <p className="status status-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={deleting}>
            {t("common.cancel")}
          </button>
          <button type="button" className="delete-button" onClick={handleDelete} disabled={deleting || confirmName !== treeName}>
            {deleting ? t("deleteTree.deleting") : t("deleteTree.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
