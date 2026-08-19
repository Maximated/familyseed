import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createIndividual,
  uploadPersonPhoto,
  type DatePrecision,
  type Individual,
  type Relationship,
  type Sex,
  type UnionStatus,
  type UnionType,
} from "./api";
import { resizeImage } from "./media";
import PhotoCropModal from "./PhotoCropModal";
import PersonPicker from "./PersonPicker";
import IOSToggle from "./IOSToggle";

type RelationshipKind = "NONE" | "CHILD_OF_PARENTS" | "PARTNER" | "PARENT_OF";

type Props = {
  treeId: string;
  onCreated: (newPersonId: string) => void;
  onClose: () => void;
};

function personLabel(person: Individual) {
  const year = person.birthDateText ? ` (${person.birthDateText})` : "";
  const surname = [person.surname1, person.surname2].filter(Boolean).join(" ");
  return `${person.givenNames} ${surname}${year}`;
}

export default function AddPersonForm({ treeId, onCreated, onClose }: Props) {
  const { t } = useTranslation();
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind>("CHILD_OF_PARENTS");
  const [parent1, setParent1] = useState<Individual | null>(null);
  const [parent2, setParent2] = useState<Individual | null>(null);
  const [partner, setPartner] = useState<Individual | null>(null);
  const [unionType, setUnionType] = useState<UnionType>("MARRIAGE");
  const [unionStatus, setUnionStatus] = useState<UnionStatus>("ONGOING");
  const [unionDateText, setUnionDateText] = useState("");
  const [unionPlace, setUnionPlace] = useState("");
  const [child, setChild] = useState<Individual | null>(null);

  const [givenNames, setGivenNames] = useState("");
  const [surname1, setSurname1] = useState("");
  const [surname2, setSurname2] = useState("");
  const [surname1BirthName, setSurname1BirthName] = useState("");
  const [alias, setAlias] = useState("");
  const [sex, setSex] = useState<Sex>("UNKNOWN");
  const [birthDateText, setBirthDateText] = useState("");
  const [birthDateValue, setBirthDateValue] = useState("");
  const [birthDatePrecision, setBirthDatePrecision] = useState<DatePrecision>("EXACT");
  const [birthPlace, setBirthPlace] = useState("");
  const [deathDateText, setDeathDateText] = useState("");
  const [deathDateValue, setDeathDateValue] = useState("");
  const [deathDatePrecision, setDeathDatePrecision] = useState<DatePrecision>("EXACT");
  const [deathPlace, setDeathPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [biography, setBiography] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCropSource(file);
  }

  function handlePhotoCropped(cropped: File) {
    setPhotoFile(cropped);
    setPhotoPreview(URL.createObjectURL(cropped));
    setCropSource(null);
  }

  function buildRelationship(): Relationship | undefined {
    if (relationshipKind === "CHILD_OF_PARENTS") {
      return {
        kind: "CHILD_OF_PARENTS",
        parent1Id: parent1?.id ?? "",
        parent2Id: parent2?.id || undefined,
      };
    }
    if (relationshipKind === "PARTNER") {
      return {
        kind: "PARTNER",
        partnerId: partner?.id ?? "",
        unionType,
        unionStatus,
        unionDateText: unionDateText || undefined,
        unionPlace: unionPlace || undefined,
      };
    }
    if (relationshipKind === "PARENT_OF") {
      return { kind: "PARENT_OF", childId: child?.id ?? "" };
    }
    return undefined;
  }

  function validate(): string | null {
    if (!givenNames.trim() || !surname1.trim()) {
      return t("addPerson.validationRequired");
    }
    if (relationshipKind === "CHILD_OF_PARENTS" && !parent1) {
      return t("addPerson.validationParent");
    }
    if (relationshipKind === "PARTNER" && !partner) {
      return t("addPerson.validationPartner");
    }
    if (relationshipKind === "PARENT_OF" && !child) {
      return t("addPerson.validationChild");
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { individual } = await createIndividual(treeId, {
        individual: {
          givenNames: givenNames.trim(),
          surname1: surname1.trim(),
          surname2: surname2.trim() || undefined,
          surname1BirthName: surname1BirthName.trim() || undefined,
          alias: alias.trim() || undefined,
          sex,
          birthDateText: birthDateText.trim() || undefined,
          birthDateValue: birthDateValue || undefined,
          birthDatePrecision: birthDateValue ? birthDatePrecision : undefined,
          birthPlace: birthPlace.trim() || undefined,
          deathDateText: deathDateText.trim() || undefined,
          deathDateValue: deathDateValue || undefined,
          deathDatePrecision: deathDateValue ? deathDatePrecision : undefined,
          deathPlace: deathPlace.trim() || undefined,
          notes: notes.trim() || undefined,
          biography: biography.trim() || undefined,
        },
        relationship: buildRelationship(),
      });

      if (photoFile) {
        const resized = await resizeImage(photoFile, 500, 0.85);
        await uploadPersonPhoto(treeId, individual.id, resized, photoFile.name).catch(() => {
          // The person is already created — a failed photo upload shouldn't
          // block finishing the form, just leave the avatar unset.
        });
      }

      onCreated(individual.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{t("addPerson.title")}</h2>

        <fieldset>
          <legend>{t("addPerson.relationshipLegend")}</legend>
          <IOSToggle
            checked={relationshipKind === "CHILD_OF_PARENTS"}
            onChange={() => setRelationshipKind("CHILD_OF_PARENTS")}
            label={t("addPerson.childOf")}
          />
          {relationshipKind === "CHILD_OF_PARENTS" && (
            <div className="indent">
              <PersonPicker
                treeId={treeId}
                selectedName={parent1 ? personLabel(parent1) : null}
                onSelect={setParent1}
                excludeIds={parent2 ? [parent2.id] : undefined}
              />
              {parent2 ? (
                <p className="person-picker-selected">
                  {personLabel(parent2)}{" "}
                  <button type="button" className="person-picker-change" onClick={() => setParent2(null)}>
                    {t("addPerson.removeOtherParent")}
                  </button>
                </p>
              ) : (
                <PersonPicker
                  treeId={treeId}
                  selectedName={null}
                  onSelect={setParent2}
                  excludeIds={parent1 ? [parent1.id] : undefined}
                />
              )}
              <p className="field-hint">{t("addPerson.unionHint")}</p>
            </div>
          )}

          <IOSToggle
            checked={relationshipKind === "PARTNER"}
            onChange={() => setRelationshipKind("PARTNER")}
            label={t("addPerson.partnerOf")}
          />
          {relationshipKind === "PARTNER" && (
            <div className="indent">
              <PersonPicker treeId={treeId} selectedName={partner ? personLabel(partner) : null} onSelect={setPartner} />
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

          <IOSToggle
            checked={relationshipKind === "PARENT_OF"}
            onChange={() => setRelationshipKind("PARENT_OF")}
            label={t("addPerson.parentOf")}
          />
          {relationshipKind === "PARENT_OF" && (
            <div className="indent">
              <PersonPicker treeId={treeId} selectedName={child ? personLabel(child) : null} onSelect={setChild} />
            </div>
          )}

          <IOSToggle
            checked={relationshipKind === "NONE"}
            onChange={() => setRelationshipKind("NONE")}
            label={t("addPerson.noRelation")}
          />
        </fieldset>

        <fieldset>
          <legend>{t("addPerson.personLegend")}</legend>
          <label>
            {t("personFields.photo")}
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
          </label>
          {photoPreview && <img src={photoPreview} alt={t("personFields.photoPreviewAlt")} className="photo-preview" />}
          <label>
            {t("personFields.givenNames")}
            <input value={givenNames} onChange={(e) => setGivenNames(e.target.value)} required />
          </label>
          <label>
            {t("personFields.surname1")}
            <input value={surname1} onChange={(e) => setSurname1(e.target.value)} required />
          </label>
          <label>
            {t("personFields.surname2")}
            <input value={surname2} onChange={(e) => setSurname2(e.target.value)} />
          </label>
          <label>
            {t("personFields.surname1BirthName")}
            <input
              placeholder={t("personFields.surname1BirthNamePlaceholder")}
              value={surname1BirthName}
              onChange={(e) => setSurname1BirthName(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.alias")}
            <input
              placeholder={t("personFields.aliasPlaceholder")}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.sex")}
            <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
              <option value="UNKNOWN">{t("personFields.sexUnknown")}</option>
              <option value="MALE">{t("personFields.sexMale")}</option>
              <option value="FEMALE">{t("personFields.sexFemale")}</option>
            </select>
          </label>
          <label>
            {t("personFields.birthDate")}
            <div className="field-row">
              <input
                type="date"
                value={birthDateValue}
                onChange={(e) => setBirthDateValue(e.target.value)}
              />
              <select value={birthDatePrecision} onChange={(e) => setBirthDatePrecision(e.target.value as DatePrecision)}>
                <option value="EXACT">{t("datePrecision.EXACT")}</option>
                <option value="ABOUT">{t("datePrecision.ABOUT")}</option>
                <option value="BEFORE">{t("datePrecision.BEFORE")}</option>
                <option value="AFTER">{t("datePrecision.AFTER")}</option>
              </select>
            </div>
            <p className="field-hint">{t("personFields.dateValueHint")}</p>
            <input
              type="text"
              placeholder={t("personFields.birthDatePlaceholder")}
              value={birthDateText}
              onChange={(e) => setBirthDateText(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.birthPlace")}
            <input
              placeholder={t("personFields.placePlaceholder")}
              value={birthPlace}
              onChange={(e) => setBirthPlace(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.deathDate")}
            <div className="field-row">
              <input
                type="date"
                value={deathDateValue}
                onChange={(e) => setDeathDateValue(e.target.value)}
              />
              <select value={deathDatePrecision} onChange={(e) => setDeathDatePrecision(e.target.value as DatePrecision)}>
                <option value="EXACT">{t("datePrecision.EXACT")}</option>
                <option value="ABOUT">{t("datePrecision.ABOUT")}</option>
                <option value="BEFORE">{t("datePrecision.BEFORE")}</option>
                <option value="AFTER">{t("datePrecision.AFTER")}</option>
              </select>
            </div>
            <p className="field-hint">{t("personFields.dateValueHint")}</p>
            <input
              type="text"
              placeholder={t("personFields.deathDatePlaceholder")}
              value={deathDateText}
              onChange={(e) => setDeathDateText(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.deathPlace")}
            <input
              placeholder={t("personFields.placePlaceholder")}
              value={deathPlace}
              onChange={(e) => setDeathPlace(e.target.value)}
            />
          </label>
          <label>
            {t("personFields.notes")}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <label>
            {t("personFields.biography")}
            <textarea
              placeholder={t("personFields.biographyPlaceholder")}
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              rows={4}
            />
          </label>
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
    {cropSource && <PhotoCropModal file={cropSource} onCropped={handlePhotoCropped} onCancel={() => setCropSource(null)} />}
    </>
  );
}
