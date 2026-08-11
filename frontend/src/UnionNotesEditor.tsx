import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateFamilyNotes } from "./api";

type Props = {
  treeId: string;
  familyId: string;
  initialNotes: string;
  // Called after a successful save so the caller can refresh its own copy
  // of the tree data — without this, the next time this union's panel is
  // freshly opened it would still read the pre-save notes (they'd look
  // like they "disappeared" until a full tree reload).
  onSaved: () => void;
};

export default function UnionNotesEditor({ treeId, familyId, initialNotes, onSaved }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateFamilyNotes(treeId, familyId, notes);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setNotes(initialNotes);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    // Reads local `notes` state, not the `initialNotes` prop — the prop is
    // a snapshot from whenever this panel was opened and never updates for
    // an already-mounted panel, so reading it here would show stale (often
    // empty) content immediately after a successful save.
    return (
      <div className="info-panel-section">
        <h3 className="info-panel-section-heading">{t("unionNotes.heading")}</h3>
        {notes ? (
          <p className="union-notes-display">{notes}</p>
        ) : (
          <p className="field-hint">{t("unionNotes.empty")}</p>
        )}
        <button type="button" className="union-notes-edit-link" onClick={() => setEditing(true)}>
          {notes ? t("unionNotes.editAction") : t("unionNotes.addAction")}
        </button>
      </div>
    );
  }

  return (
    <div className="info-panel-section">
      <h3 className="info-panel-section-heading">{t("unionNotes.heading")}</h3>
      <textarea
        className="union-notes-textarea"
        value={notes}
        placeholder={t("unionNotes.placeholder")}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        autoFocus
      />
      {error && <p className="status status-error">{error}</p>}
      <div className="union-notes-actions">
        <button type="button" onClick={handleCancel} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
