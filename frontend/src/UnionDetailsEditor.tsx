import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateFamily, type UnionStatus, type UnionType } from "./api";

type UnionDetails = {
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionPlace: string | null;
};

type Props = {
  treeId: string;
  familyId: string;
  initial: UnionDetails;
  // Same reason as UnionNotesEditor's onSaved — refreshes the caller's copy
  // so a freshly reopened panel (and the tree/union icon) reflects the edit
  // right away instead of only after a full reload.
  onSaved: () => void;
};

const UNION_TYPE_VALUES: UnionType[] = ["MARRIAGE", "PARTNERSHIP", "EXTRAMARITAL", "UNKNOWN"];
const UNION_STATUS_VALUES: UnionStatus[] = ["ONGOING", "ENDED_BY_DEATH", "DIVORCED", "SEPARATED", "ANNULLED"];

export default function UnionDetailsEditor({ treeId, familyId, initial, onSaved }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [unionType, setUnionType] = useState(initial.unionType);
  const [unionStatus, setUnionStatus] = useState(initial.unionStatus);
  const [unionDateText, setUnionDateText] = useState(initial.unionDateText ?? "");
  const [unionPlace, setUnionPlace] = useState(initial.unionPlace ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUnionType(initial.unionType);
    setUnionStatus(initial.unionStatus);
    setUnionDateText(initial.unionDateText ?? "");
    setUnionPlace(initial.unionPlace ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.unionType, initial.unionStatus, initial.unionDateText, initial.unionPlace]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateFamily(treeId, familyId, {
        unionType,
        unionStatus,
        unionDateText: unionDateText.trim() || null,
        unionPlace: unionPlace.trim() || null,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setUnionType(initial.unionType);
    setUnionStatus(initial.unionStatus);
    setUnionDateText(initial.unionDateText ?? "");
    setUnionPlace(initial.unionPlace ?? "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    // Reads local state, not the `initial` prop — see UnionNotesEditor for
    // why (the prop is a snapshot from when the panel opened and never
    // updates for an already-mounted panel).
    return (
      <div className="info-panel-section">
        <h3 className="info-panel-section-heading">{t("infoPanel.unionHeading")}</h3>
        <ul className="info-panel-bullets">
          <li>{t("infoPanel.unionType", { value: t(`unionType.${unionType}`) })}</li>
          <li>{t("infoPanel.unionStatus", { value: t(`unionStatus.${unionStatus}`) })}</li>
          <li>{t("infoPanel.unionDate", { value: unionDateText || t("infoPanel.unknownDate") })}</li>
          {unionPlace && <li>{t("infoPanel.unionPlace", { value: unionPlace })}</li>}
        </ul>
        <button type="button" className="union-notes-edit-link" onClick={() => setEditing(true)}>
          {t("infoPanel.editUnion")}
        </button>
      </div>
    );
  }

  return (
    <div className="info-panel-section">
      <h3 className="info-panel-section-heading">{t("infoPanel.unionHeading")}</h3>
      <label>
        {t("infoPanel.unionTypeLabel")}
        <select value={unionType} onChange={(e) => setUnionType(e.target.value as UnionType)}>
          {UNION_TYPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`unionType.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("infoPanel.unionStatusLabel")}
        <select value={unionStatus} onChange={(e) => setUnionStatus(e.target.value as UnionStatus)}>
          {UNION_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`unionStatus.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("infoPanel.unionDateLabel")}
        <input
          type="text"
          placeholder={t("addPerson.unionDatePlaceholder")}
          value={unionDateText}
          onChange={(e) => setUnionDateText(e.target.value)}
        />
      </label>
      <label>
        {t("infoPanel.unionPlaceLabel")}
        <input
          type="text"
          placeholder={t("personFields.placePlaceholder")}
          value={unionPlace}
          onChange={(e) => setUnionPlace(e.target.value)}
        />
      </label>
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
