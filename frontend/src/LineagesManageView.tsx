import { useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteLineage, updateLineage, type Lineage } from "./api";
import { PencilIcon, Trash2Icon } from "./Icons";
import SwipeRow from "./SwipeRow";

type Props = {
  treeId: string;
  lineages: Lineage[];
  onChanged: () => void;
  onClose: () => void;
};

export default function LineagesManageView({ treeId, lineages, onChanged, onClose }: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEditing(lineage: Lineage) {
    setError(null);
    setEditingId(lineage.id);
    setEditingName(lineage.name);
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateLineage(treeId, id, editingName.trim());
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteLineage(treeId, id);
      setConfirmingDeleteId(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("lineagesManage.title")}</h2>
        <p className="field-hint">{t("lineagesManage.hint")}</p>

        {lineages.length === 0 ? (
          <p className="status">{t("editPerson.noLineages")}</p>
        ) : (
          <ul className="trash-list">
            {lineages.map((lineage) => (
              <li key={lineage.id}>
                {editingId === lineage.id ? (
                  <div className="field-row" style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                    />
                    <button type="button" className="btn-primary" onClick={() => handleRename(lineage.id)} disabled={busy}>
                      {t("common.save")}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} disabled={busy}>
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : confirmingDeleteId === lineage.id ? (
                  <>
                    <span className="trash-list-name">{t("lineagesManage.confirmDelete", { name: lineage.name })}</span>
                    <div className="field-row">
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} disabled={busy}>
                        {t("common.cancel")}
                      </button>
                      <button type="button" className="delete-button" onClick={() => handleDelete(lineage.id)} disabled={busy}>
                        {t("editPerson.confirmYes")}
                      </button>
                    </div>
                  </>
                ) : (
                  <SwipeRow
                    actions={
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => startEditing(lineage)}
                          aria-label={t("app.edit")}
                          title={t("app.edit")}
                        >
                          <PencilIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setConfirmingDeleteId(lineage.id)}
                          aria-label={t("lineagesManage.deleteAction")}
                          title={t("lineagesManage.deleteAction")}
                        >
                          <Trash2Icon size={16} />
                        </button>
                      </>
                    }
                  >
                    <span className="trash-list-name">{lineage.name}</span>
                  </SwipeRow>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="status status-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
