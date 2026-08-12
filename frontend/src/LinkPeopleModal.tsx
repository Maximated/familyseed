import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addParent,
  createFamily,
  fetchIndividuals,
  type Individual,
  type UnionStatus,
  type UnionType,
} from "./api";

type Props = {
  treeId: string;
  // Set together when this modal is opened by dragging a relation branch
  // from one person's card onto another's (see TreeView's drag-to-link
  // wiring) — both people are already chosen at that point, so the picker
  // selects are replaced with plain read-only labels instead.
  fixedPersonAId?: string;
  fixedPersonBId?: string;
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
export default function LinkPeopleModal({ treeId, fixedPersonAId, fixedPersonBId, onLinked, onClose }: Props) {
  const { t } = useTranslation();
  const isFixed = Boolean(fixedPersonAId && fixedPersonBId);
  const [individuals, setIndividuals] = useState<Individual[]>([]);
  const [personAId, setPersonAId] = useState(fixedPersonAId ?? "");
  const [personBId, setPersonBId] = useState(fixedPersonBId ?? "");
  const [linkKind, setLinkKind] = useState<LinkKind>("A_PARENT_OF_B");
  const [unionType, setUnionType] = useState<UnionType>("MARRIAGE");
  const [unionStatus, setUnionStatus] = useState<UnionStatus>("ONGOING");
  const [unionDateText, setUnionDateText] = useState("");
  const [unionPlace, setUnionPlace] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIndividuals(treeId)
      .then(setIndividuals)
      .catch((err: Error) => setError(err.message));
  }, [treeId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!personAId || !personBId) {
      setError(t("linkPeople.validationBoth"));
      return;
    }
    if (personAId === personBId) {
      setError(t("linkPeople.validationDistinct"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (linkKind === "A_PARENT_OF_B") {
        await addParent(treeId, personBId, personAId);
      } else if (linkKind === "B_PARENT_OF_A") {
        await addParent(treeId, personAId, personBId);
      } else {
        await createFamily(treeId, {
          partner1Id: personAId,
          partner2Id: personBId,
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
        <p className="field-hint">{isFixed ? t("linkPeople.hintFixed") : t("linkPeople.hint")}</p>

        {isFixed ? (
          <div className="link-people-fixed-pair">
            <p>
              <strong>{t("linkPeople.personA")}:</strong>{" "}
              {individuals.find((p) => p.id === personAId) ? personLabel(individuals.find((p) => p.id === personAId)!) : "…"}
            </p>
            <p>
              <strong>{t("linkPeople.personB")}:</strong>{" "}
              {individuals.find((p) => p.id === personBId) ? personLabel(individuals.find((p) => p.id === personBId)!) : "…"}
            </p>
          </div>
        ) : (
          <>
            <label>
              {t("linkPeople.personA")}
              <select value={personAId} onChange={(e) => setPersonAId(e.target.value)} required>
                <option value="">{t("linkPeople.personPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t("linkPeople.personB")}
              <select value={personBId} onChange={(e) => setPersonBId(e.target.value)} required>
                <option value="">{t("linkPeople.personPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <fieldset>
          <legend>{t("linkPeople.relationshipLegend")}</legend>
          <label>
            <input
              type="radio"
              checked={linkKind === "A_PARENT_OF_B"}
              onChange={() => setLinkKind("A_PARENT_OF_B")}
            />
            {t("linkPeople.aIsParentOfB")}
          </label>
          <label>
            <input
              type="radio"
              checked={linkKind === "B_PARENT_OF_A"}
              onChange={() => setLinkKind("B_PARENT_OF_A")}
            />
            {t("linkPeople.bIsParentOfA")}
          </label>
          <label>
            <input type="radio" checked={linkKind === "PARTNER"} onChange={() => setLinkKind("PARTNER")} />
            {t("linkPeople.partner")}
          </label>
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
