import { useState } from "react";
import { useTranslation } from "react-i18next";
import { addParent, createFamily, type Individual, type UnionStatus, type UnionType } from "./api";
import IOSToggle from "./IOSToggle";
import PersonPicker from "./PersonPicker";

type Props = {
  treeId: string;
  onLinked: () => void;
  onClose: () => void;
};

type LinkKind = "A_PARENT_OF_B" | "B_PARENT_OF_A" | "PARTNER";

function personLabel(person: Individual) {
  const year = person.birthDateText ? ` (${person.birthDateText})` : "";
  const surname = [person.surname1, person.surname2].filter(Boolean).join(" ");
  return `${person.givenNames} ${surname}${year}`;
}

// The free-form counterpart to AddPersonForm's relationship picker — that
// form can only relate a brand-new person to an existing one, so there was
// no way to connect two people who already both had records (e.g. two
// people imported separately, or added with "sin relación conocida").
// Reuses the same backend calls AddPersonForm's flows resolve to
// (addParent / createFamily) rather than adding new relationship logic.
export default function LinkPeopleModal({ treeId, onLinked, onClose }: Props) {
  const { t } = useTranslation();
  const [personA, setPersonA] = useState<Individual | null>(null);
  const [personB, setPersonB] = useState<Individual | null>(null);
  const [linkKind, setLinkKind] = useState<LinkKind>("A_PARENT_OF_B");
  const [unionType, setUnionType] = useState<UnionType>("MARRIAGE");
  const [unionStatus, setUnionStatus] = useState<UnionStatus>("ONGOING");
  const [unionDateText, setUnionDateText] = useState("");
  const [unionPlace, setUnionPlace] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!personA || !personB) {
      setError(t("linkPeople.validationBoth"));
      return;
    }
    if (personA.id === personB.id) {
      setError(t("linkPeople.validationDistinct"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (linkKind === "A_PARENT_OF_B") {
        await addParent(treeId, personB.id, personA.id);
      } else if (linkKind === "B_PARENT_OF_A") {
        await addParent(treeId, personA.id, personB.id);
      } else {
        await createFamily(treeId, {
          partner1Id: personA.id,
          partner2Id: personB.id,
          unionType,
          unionStatus,
          unionDateText: unionDateText.trim() || undefined,
          unionPlace: unionPlace.trim() || undefined,
        });
      }
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-panel" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t("linkPeople.title")}</h2>
        <p className="field-hint">{t("linkPeople.hint")}</p>

        <label>
          {t("linkPeople.personA")}
          <PersonPicker
            treeId={treeId}
            selectedName={personA ? personLabel(personA) : null}
            onSelect={setPersonA}
            excludeIds={personB ? [personB.id] : []}
          />
        </label>

        <label>
          {t("linkPeople.personB")}
          <PersonPicker
            treeId={treeId}
            selectedName={personB ? personLabel(personB) : null}
            onSelect={setPersonB}
            excludeIds={personA ? [personA.id] : []}
          />
        </label>

        <fieldset>
          <legend>{t("linkPeople.relationshipLegend")}</legend>
          <IOSToggle
            checked={linkKind === "A_PARENT_OF_B"}
            onChange={() => setLinkKind("A_PARENT_OF_B")}
            label={t("linkPeople.aIsParentOfB")}
          />
          <IOSToggle
            checked={linkKind === "B_PARENT_OF_A"}
            onChange={() => setLinkKind("B_PARENT_OF_A")}
            label={t("linkPeople.bIsParentOfA")}
          />
          <IOSToggle checked={linkKind === "PARTNER"} onChange={() => setLinkKind("PARTNER")} label={t("linkPeople.partner")} />
          {linkKind === "PARTNER" && (
            <div className="indent">
              <select value={unionType} onChange={(e) => setUnionType(e.target.value as UnionType)}>
                <option value="MARRIAGE">{t("unionType.MARRIAGE")}</option>
                <option value="PARTNERSHIP">{t("unionType.PARTNERSHIP")}</option>
                <option value="EXTRAMARITAL">{t("unionType.EXTRAMARITAL")}</option>
                <option value="UNKNOWN">{t("unionType.UNKNOWN")}</option>
              </select>
              <select value={unionStatus} onChange={(e) => setUnionStatus(e.target.value as UnionStatus)}>
                <option value="ONGOING">{t("unionStatus.ONGOING")}</option>
                <option value="ENDED_BY_DEATH">{t("unionStatus.ENDED_BY_DEATH")}</option>
                <option value="DIVORCED">{t("unionStatus.DIVORCED")}</option>
                <option value="SEPARATED">{t("unionStatus.SEPARATED")}</option>
                <option value="ANNULLED">{t("unionStatus.ANNULLED")}</option>
              </select>
              <input
                type="text"
                placeholder={t("addPerson.unionDatePlaceholder")}
                value={unionDateText}
                onChange={(e) => setUnionDateText(e.target.value)}
              />
              <input
                type="text"
                placeholder={t("personFields.placePlaceholder")}
                value={unionPlace}
                onChange={(e) => setUnionPlace(e.target.value)}
              />
            </div>
          )}
        </fieldset>

        {error && <p className="status status-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
