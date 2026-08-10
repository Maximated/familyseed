import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateFamilyNotes } from "./api";

type Props = {
  familyId: string;
  initialNotes: string;
};

export default function UnionNotesEditor({ familyId, initialNotes }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = notes !== initialNotes;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateFamilyNotes(familyId, notes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
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
      />
      {error && <p className="status status-error">{error}</p>}
      <div className="union-notes-actions">
        <button type="button" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
