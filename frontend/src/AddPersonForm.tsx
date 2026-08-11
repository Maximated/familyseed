import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createIndividual,
  fetchIndividuals,
  uploadPersonPhoto,
  type DatePrecision,
  type Individual,
  type Relationship,
  type Sex,
  type UnionType,
} from "./api";
import { resizeImage } from "./media";

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
  const [individuals, setIndividuals] = useState<Individual[]>([]);
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind>("CHILD_OF_PARENTS");
  const [parent1Id, setParent1Id] = useState("");
  const [parent2Id, setParent2Id] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [unionType, setUnionType] = useState<UnionType>("MARRIAGE");
  const [unionDateText, setUnionDateText] = useState("");
  const [unionPlace, setUnionPlace] = useState("");
  const [childId, setChildId] = useState("");

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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  useEffect(() => {
    fetchIndividuals(treeId)
      .then(setIndividuals)
      .catch((err: Error) => setError(err.message));
  }, [treeId]);

  function buildRelationship(): Relationship | undefined {
    if (relationshipKind === "CHILD_OF_PARENTS") {
      return {
        kind: "CHILD_OF_PARENTS",
        parent1Id,
        parent2Id: parent2Id || undefined,
      };
    }
    if (relationshipKind === "PARTNER") {
      return {
        kind: "PARTNER",
        partnerId,
        unionType,
        unionDateText: unionDateText || undefined,
        unionPlace: unionPlace || undefined,
      };
    }
    if (relationshipKind === "PARENT_OF") {
      return { kind: "PARENT_OF", childId };
    }
    return undefined;
  }

  function validate(): string | null {
    if (!givenNames.trim() || !surname1.trim()) {
      return t("addPerson.validationRequired");
    }
    if (relationshipKind === "CHILD_OF_PARENTS" && !parent1Id) {
      return t("addPerson.validationParent");
    }
    if (relationshipKind === "PARTNER" && !partnerId) {
      return t("addPerson.validationPartner");
    }
    if (relationshipKind === "PARENT_OF" && !childId) {
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
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{t("addPerson.title")}</h2>

        <fieldset>
          <legend>{t("addPerson.relationshipLegend")}</legend>
          <label>
            <input
              type="radio"
              checked={relationshipKind === "CHILD_OF_PARENTS"}
              onChange={() => setRelationshipKind("CHILD_OF_PARENTS")}
            />
            {t("addPerson.childOf")}
          </label>
          {relationshipKind === "CHILD_OF_PARENTS" && (
            <div className="indent">
              <select value={parent1Id} onChange={(e) => setParent1Id(e.target.value)}>
                <option value="">{t("addPerson.parentPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <select value={parent2Id} onChange={(e) => setParent2Id(e.target.value)}>
                <option value="">{t("addPerson.otherParentPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <p className="field-hint">{t("addPerson.unionHint")}</p>
            </div>
          )}

          <label>
            <input
              type="radio"
              checked={relationshipKind === "PARTNER"}
              onChange={() => setRelationshipKind("PARTNER")}
            />
            {t("addPerson.partnerOf")}
          </label>
          {relationshipKind === "PARTNER" && (
            <div className="indent">
              <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">{t("addPerson.partnerPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
              <select value={unionType} onChange={(e) => setUnionType(e.target.value as UnionType)}>
                <option value="MARRIAGE">{t("unionType.MARRIAGE")}</option>
                <option value="PARTNERSHIP">{t("unionType.PARTNERSHIP")}</option>
                <option value="EXTRAMARITAL">{t("unionType.EXTRAMARITAL")}</option>
                <option value="UNKNOWN">{t("unionType.UNKNOWN")}</option>
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

          <label>
            <input
              type="radio"
              checked={relationshipKind === "PARENT_OF"}
              onChange={() => setRelationshipKind("PARENT_OF")}
            />
            {t("addPerson.parentOf")}
          </label>
          {relationshipKind === "PARENT_OF" && (
            <div className="indent">
              <select value={childId} onChange={(e) => setChildId(e.target.value)}>
                <option value="">{t("addPerson.childPlaceholder")}</option>
                {individuals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label>
            <input
              type="radio"
              checked={relationshipKind === "NONE"}
              onChange={() => setRelationshipKind("NONE")}
            />
            {t("addPerson.noRelation")}
          </label>
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
  );
}
