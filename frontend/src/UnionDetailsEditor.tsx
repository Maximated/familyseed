import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateFamily, type DatePrecision, type UnionStatus, type UnionType } from "./api";

type UnionDetails = {
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionDateValue: string | null;
  unionDatePrecision: DatePrecision | null;
  unionPlace: string | null;
};

// Same ISO-timestamp-to-`<input type="date">`-value slicing EditPersonForm
// uses for birth/death dates.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

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
  const [unionDateValue, setUnionDateValue] = useState(toDateInputValue(initial.unionDateValue));
  const [unionDatePrecision, setUnionDatePrecision] = useState<DatePrecision>(initial.unionDatePrecision ?? "EXACT");
  const [unionDateText, setUnionDateText] = useState(initial.unionDateText ?? "");
  const [unionPlace, setUnionPlace] = useState(initial.unionPlace ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUnionType(initial.unionType);
    setUnionStatus(initial.unionStatus);
    setUnionDateValue(toDateInputValue(initial.unionDateValue));
    setUnionDatePrecision(initial.unionDatePrecision ?? "EXACT");
    setUnionDateText(initial.unionDateText ?? "");
    setUnionPlace(initial.unionPlace ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initial.unionType,
    initial.unionStatus,
    initial.unionDateValue,
    initial.unionDatePrecision,
    initial.unionDateText,
    initial.unionPlace,
  ]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateFamily(treeId, familyId, {
        unionType,
        unionStatus,
        unionDateValue: unionDateValue || null,
        unionDatePrecision: unionDateValue ? unionDatePrecision : null,
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
    setUnionDateValue(toDateInputValue(initial.unionDateValue));
    setUnionDatePrecision(initial.unionDatePrecision ?? "EXACT");
    setUnionDateText(initial.unionDateText ?? "");
    setUnionPlace(initial.unionPlace ?? "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    // unionDateText (freeform) takes priority when present — same
    // reasoning as birth/death dates: trust what was actually typed.
    // Falling back to the structured value+precision means a date entered
    // solely via the picker still shows here instead of "unknown".
    // "ABOUT" shows year-only (same as an approximate birth/death date) —
    // a day/month never recorded as exact would otherwise read as false
    // precision once "c." is in front of it.
    const displayDate =
      unionDateText ||
      (unionDateValue
        ? unionDatePrecision === "ABOUT"
          ? t("common.circaYear", { year: unionDateValue.slice(0, 4) })
          : unionDateValue
        : "");
    // Reads local state, not the `initial` prop — see UnionNotesEditor for
    // why (the prop is a snapshot from when the panel opened and never
    // updates for an already-mounted panel).
    return (
      <div className="info-panel-section">
        <h3 className="info-panel-section-heading">{t("infoPanel.unionHeading")}</h3>
        <ul className="info-panel-bullets">
          <li>{t("infoPanel.unionType", { value: t(`unionType.${unionType}`) })}</li>
          <li>{t("infoPanel.unionStatus", { value: t(`unionStatus.${unionStatus}`) })}</li>
          <li>{t("infoPanel.unionDate", { value: displayDate || t("infoPanel.unknownDate") })}</li>
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
        <div className="field-row">
          <input type="date" value={unionDateValue} onChange={(e) => setUnionDateValue(e.target.value)} />
          <select
            value={unionDatePrecision}
            onChange={(e) => setUnionDatePrecision(e.target.value as DatePrecision)}
          >
            <option value="EXACT">{t("datePrecision.EXACT")}</option>
            <option value="ABOUT">{t("datePrecision.ABOUT")}</option>
            <option value="BEFORE">{t("datePrecision.BEFORE")}</option>
            <option value="AFTER">{t("datePrecision.AFTER")}</option>
          </select>
        </div>
        <p className="field-hint">{t("personFields.dateValueHint")}</p>
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
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
