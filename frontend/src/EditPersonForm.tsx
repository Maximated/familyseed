import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  deleteIndividual,
  fetchIndividual,
  mediaUrl,
  updateIndividual,
  uploadPersonPhoto,
  type Individual,
  type Sex,
  type UpdateIndividualPayload,
} from "./api";
import { resizeImage } from "./media";

type Props = {
  treeId: string;
  personId: string;
  onSaved: (personId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
};

export default function EditPersonForm({ treeId, personId, onSaved, onDeleted, onClose }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [givenNames, setGivenNames] = useState("");
  const [surname1, setSurname1] = useState("");
  const [surname2, setSurname2] = useState("");
  const [surname1BirthName, setSurname1BirthName] = useState("");
  const [alias, setAlias] = useState("");
  const [sex, setSex] = useState<Sex>("UNKNOWN");
  const [birthDateText, setBirthDateText] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [deathDateText, setDeathDateText] = useState("");
  const [deathPlace, setDeathPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [biography, setBiography] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchIndividual(treeId, personId)
      .then((person: Individual) => {
        setGivenNames(person.givenNames);
        setSurname1(person.surname1);
        setSurname2(person.surname2 ?? "");
        setSurname1BirthName(person.surname1BirthName ?? "");
        setAlias(person.alias ?? "");
        setSex(person.sex);
        setBirthDateText(person.birthDateText ?? "");
        setBirthPlace(person.birthPlace ?? "");
        setDeathDateText(person.deathDateText ?? "");
        setDeathPlace(person.deathPlace ?? "");
        setNotes(person.notes ?? "");
        setBiography(person.biography ?? "");
        setPhotoPreview(person.photoUrl ? mediaUrl(person.photoUrl) : null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [treeId, personId]);

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!givenNames.trim() || !surname1.trim()) {
      setError(t("editPerson.validationRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: UpdateIndividualPayload = {
        givenNames: givenNames.trim(),
        surname1: surname1.trim(),
        surname2: surname2.trim() || undefined,
        surname1BirthName: surname1BirthName.trim() || undefined,
        alias: alias.trim() || undefined,
        sex,
        birthDateText: birthDateText.trim() || undefined,
        birthPlace: birthPlace.trim() || undefined,
        deathDateText: deathDateText.trim() || undefined,
        deathPlace: deathPlace.trim() || undefined,
        notes: notes.trim() || undefined,
        biography: biography.trim() || undefined,
      };
      await updateIndividual(treeId, personId, payload);

      if (photoFile) {
        const resized = await resizeImage(photoFile, 500, 0.85);
        await uploadPersonPhoto(treeId, personId, resized, photoFile.name).catch(() => {
          // The rest of the edit already saved — a failed photo upload
          // shouldn't block finishing.
        });
      }

      onSaved(personId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteIndividual(treeId, personId);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{t("editPerson.title")}</h2>

        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : (
          <>
            <fieldset>
              <legend>{t("editPerson.personLegend")}</legend>
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
              <button type="button" onClick={onClose} disabled={submitting || deleting}>
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={submitting || deleting}>
                {submitting ? t("common.saving") : t("common.save")}
              </button>
            </div>

            <div className="danger-zone">
              {!confirmingDelete ? (
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={submitting || deleting}
                >
                  {t("editPerson.deletePerson")}
                </button>
              ) : (
                <div className="delete-confirm">
                  <p>
                    <Trans
                      i18nKey="editPerson.confirmDelete"
                      values={{ name: `${givenNames} ${surname1}` }}
                      components={{ 1: <strong /> }}
                    />
                  </p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="delete-button"
                      onClick={handleConfirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? t("editPerson.deleting") : t("editPerson.confirmYes")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
