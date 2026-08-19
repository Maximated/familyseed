import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  addIndividualLineage,
  addParent,
  createFamily,
  createLineage,
  deleteIndividual,
  fetchIndividualRelations,
  fetchLineages,
  mediaUrl,
  removeIndividualLineage,
  removeParent,
  updateIndividual,
  uploadPersonPhoto,
  type DatePrecision,
  type Individual,
  type Lineage,
  type Partnership,
  type RelatedPerson,
  type Sex,
  type UpdateIndividualPayload,
} from "./api";
import { resizeImage } from "./media";
import PersonPicker from "./PersonPicker";
import { Trash2Icon } from "./Icons";

// The backend stores full ISO timestamps (UTC midnight) for date-value
// fields; `<input type="date">` needs just the `YYYY-MM-DD` prefix.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

type Props = {
  treeId: string;
  personId: string;
  onSaved: (personId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
  // Adding a parent takes effect immediately (its own API call, not part of
  // the "Guardar" submit below) — this lets the tree behind the modal
  // reflect it right away instead of only after the whole form is saved.
  onRelationsChanged: () => void;
};

export default function EditPersonForm({ treeId, personId, onSaved, onDeleted, onClose, onRelationsChanged }: Props) {
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

  const [parents, setParents] = useState<RelatedPerson[]>([]);
  const [addingParent, setAddingParent] = useState(false);
  const [parentError, setParentError] = useState<string | null>(null);

  const [children, setChildren] = useState<RelatedPerson[]>([]);
  const [addingChild, setAddingChild] = useState(false);
  const [childError, setChildError] = useState<string | null>(null);

  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [addingPartner, setAddingPartner] = useState(false);
  const [partnerError, setPartnerError] = useState<string | null>(null);

  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [lineageIds, setLineageIds] = useState<string[]>([]);
  const [addingLineage, setAddingLineage] = useState(false);
  const [newLineageName, setNewLineageName] = useState("");
  const [lineageError, setLineageError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchIndividualRelations(treeId, personId)
      .then(({ individual: person, parents, children, partnerships }) => {
        setGivenNames(person.givenNames);
        setSurname1(person.surname1);
        setSurname2(person.surname2 ?? "");
        setSurname1BirthName(person.surname1BirthName ?? "");
        setAlias(person.alias ?? "");
        setSex(person.sex);
        setBirthDateText(person.birthDateText ?? "");
        setBirthDateValue(toDateInputValue(person.birthDateValue));
        setBirthDatePrecision(person.birthDatePrecision ?? "EXACT");
        setBirthPlace(person.birthPlace ?? "");
        setDeathDateText(person.deathDateText ?? "");
        setDeathDateValue(toDateInputValue(person.deathDateValue));
        setDeathDatePrecision(person.deathDatePrecision ?? "EXACT");
        setDeathPlace(person.deathPlace ?? "");
        setNotes(person.notes ?? "");
        setBiography(person.biography ?? "");
        setPhotoPreview(person.photoUrl ? mediaUrl(person.photoUrl) : null);
        setParents(parents);
        setChildren(children);
        setPartnerships(partnerships);
        setLineageIds(person.lineageIds ?? []);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    fetchLineages(treeId)
      .then(setLineages)
      .catch(() => {
        // The rest of the form still works without the lineage list.
      });
  }, [treeId, personId]);

  // Applied immediately (its own API call), not batched with the "Guardar"
  // submit below — surname-derived lineages are added automatically on
  // every save (see the backend's deriveLineagesFromSurnames), so a
  // "replace the whole set with this stale snapshot" call from here would
  // race with that and could wipe out a membership the save had just added.
  async function toggleLineage(id: string) {
    setLineageError(null);
    const wasActive = lineageIds.includes(id);
    setLineageIds((prev) => (wasActive ? prev.filter((x) => x !== id) : [...prev, id]));
    try {
      if (wasActive) await removeIndividualLineage(treeId, personId, id);
      else await addIndividualLineage(treeId, personId, id);
      onRelationsChanged();
    } catch (err) {
      setLineageIds((prev) => (wasActive ? [...prev, id] : prev.filter((x) => x !== id)));
      setLineageError((err as Error).message);
    }
  }

  async function handleCreateLineage() {
    if (!newLineageName.trim()) return;
    setLineageError(null);
    try {
      const lineage = await createLineage(treeId, newLineageName.trim());
      await addIndividualLineage(treeId, personId, lineage.id);
      setLineages((prev) => [...prev, lineage]);
      setLineageIds((prev) => [...prev, lineage.id]);
      setNewLineageName("");
      setAddingLineage(false);
      onRelationsChanged();
    } catch (err) {
      setLineageError((err as Error).message);
    }
  }

  async function handleAddParent(parent: Individual) {
    setParentError(null);
    try {
      await addParent(treeId, personId, parent.id);
      const { parents: updatedParents } = await fetchIndividualRelations(treeId, personId);
      setParents(updatedParents);
      setAddingParent(false);
      onRelationsChanged();
    } catch (err) {
      setParentError((err as Error).message);
    }
  }

  // Same addParent endpoint as above, just with the roles reversed: this
  // person becomes the picked individual's parent, instead of the picked
  // individual becoming this person's parent.
  async function handleAddChild(child: Individual) {
    setChildError(null);
    try {
      await addParent(treeId, child.id, personId);
      const { children: updatedChildren } = await fetchIndividualRelations(treeId, personId);
      setChildren(updatedChildren);
      setAddingChild(false);
      onRelationsChanged();
    } catch (err) {
      setChildError((err as Error).message);
    }
  }

  // Defaults the new union to MARRIAGE, same as RelationshipWizard's own
  // partner step — refining the type/status/date is one click away
  // afterward via the union's own info panel, so it isn't duplicated here.
  async function handleAddPartner(partner: Individual) {
    setPartnerError(null);
    try {
      await createFamily(treeId, { partner1Id: personId, partner2Id: partner.id, unionType: "MARRIAGE" });
      const { partnerships: updatedPartnerships } = await fetchIndividualRelations(treeId, personId);
      setPartnerships(updatedPartnerships);
      setAddingPartner(false);
      onRelationsChanged();
    } catch (err) {
      setPartnerError((err as Error).message);
    }
  }

  // Undoes a wrongly-picked parent — a mistake here is easy to make (the
  // picker only searches by name) and previously the only fix was deleting
  // the person entirely and starting over.
  async function handleRemoveParent(parentId: string) {
    setParentError(null);
    try {
      await removeParent(treeId, personId, parentId);
      const { parents: updatedParents } = await fetchIndividualRelations(treeId, personId);
      setParents(updatedParents);
      onRelationsChanged();
    } catch (err) {
      setParentError((err as Error).message);
    }
  }

  // Same removeParent endpoint, roles reversed like handleAddChild above.
  async function handleRemoveChild(childId: string) {
    setChildError(null);
    try {
      await removeParent(treeId, childId, personId);
      const { children: updatedChildren } = await fetchIndividualRelations(treeId, personId);
      setChildren(updatedChildren);
      onRelationsChanged();
    } catch (err) {
      setChildError((err as Error).message);
    }
  }

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
      // `null` (not `undefined`) for anything the user cleared — this is an
      // edit form for an existing record, so an emptied field means "remove
      // this," not "leave it as whatever's already saved."
      const payload: UpdateIndividualPayload = {
        givenNames: givenNames.trim(),
        surname1: surname1.trim(),
        surname2: surname2.trim() || null,
        surname1BirthName: surname1BirthName.trim() || null,
        alias: alias.trim() || null,
        sex,
        birthDateText: birthDateText.trim() || null,
        birthDateValue: birthDateValue || null,
        birthDatePrecision: birthDateValue ? birthDatePrecision : null,
        birthPlace: birthPlace.trim() || null,
        deathDateText: deathDateText.trim() || null,
        deathDateValue: deathDateValue || null,
        deathDatePrecision: deathDateValue ? deathDatePrecision : null,
        deathPlace: deathPlace.trim() || null,
        notes: notes.trim() || null,
        biography: biography.trim() || null,
      };
      await updateIndividual(treeId, personId, payload);
      // Saving can auto-derive a new lineage from the surname (see the
      // backend), so pick up whatever it added before the form closes.
      const { individual: refreshed } = await fetchIndividualRelations(treeId, personId);
      setLineageIds(refreshed.lineageIds ?? []);

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
              <legend>{t("editPerson.parentsLegend")}</legend>
              {parents.length === 0 ? (
                <p className="field-hint">{t("editPerson.noParents")}</p>
              ) : (
                <ul className="edit-parents-list">
                  {parents.map((parent) => (
                    <li key={parent.id}>
                      <span>{`${parent.givenNames} ${parent.surname1}`}</span>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => handleRemoveParent(parent.id)}
                        aria-label={t("editPerson.removeParent")}
                        title={t("editPerson.removeParent")}
                      >
                        <Trash2Icon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {parents.length < 2 &&
                (addingParent ? (
                  <PersonPicker treeId={treeId} selectedName={null} onSelect={handleAddParent} />
                ) : (
                  <button type="button" className="union-notes-edit-link" onClick={() => setAddingParent(true)}>
                    {t("editPerson.addParent")}
                  </button>
                ))}
              {parentError && <p className="status status-error">{parentError}</p>}
            </fieldset>

            <fieldset>
              <legend>{t("editPerson.partnersLegend")}</legend>
              {partnerships.length === 0 ? (
                <p className="field-hint">{t("editPerson.noPartners")}</p>
              ) : (
                <ul className="edit-parents-list">
                  {partnerships.map(
                    (partnership) =>
                      partnership.partner && (
                        <li key={partnership.familyId}>
                          <span>{`${partnership.partner.givenNames} ${partnership.partner.surname1}`}</span>
                        </li>
                      ),
                  )}
                </ul>
              )}
              {addingPartner ? (
                <PersonPicker
                  treeId={treeId}
                  selectedName={null}
                  onSelect={handleAddPartner}
                  excludeIds={[personId, ...partnerships.flatMap((p) => (p.partner ? [p.partner.id] : []))]}
                />
              ) : (
                <button type="button" className="union-notes-edit-link" onClick={() => setAddingPartner(true)}>
                  {t("editPerson.addPartner")}
                </button>
              )}
              {partnerError && <p className="status status-error">{partnerError}</p>}
            </fieldset>

            <fieldset>
              <legend>{t("editPerson.childrenLegend")}</legend>
              {children.length === 0 ? (
                <p className="field-hint">{t("editPerson.noChildren")}</p>
              ) : (
                <ul className="edit-parents-list">
                  {children.map((child) => (
                    <li key={child.id}>
                      <span>{`${child.givenNames} ${child.surname1}`}</span>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => handleRemoveChild(child.id)}
                        aria-label={t("editPerson.removeChild")}
                        title={t("editPerson.removeChild")}
                      >
                        <Trash2Icon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {addingChild ? (
                <PersonPicker treeId={treeId} selectedName={null} onSelect={handleAddChild} />
              ) : (
                <button type="button" className="union-notes-edit-link" onClick={() => setAddingChild(true)}>
                  {t("editPerson.addChild")}
                </button>
              )}
              {childError && <p className="status status-error">{childError}</p>}
            </fieldset>

            <fieldset>
              <legend>{t("editPerson.lineagesLegend")}</legend>
              <p className="field-hint">{t("editPerson.lineagesHint")}</p>
              {lineages.length === 0 ? (
                <p className="field-hint">{t("editPerson.noLineages")}</p>
              ) : (
                <div className="lineage-list">
                  {lineages.map((lineage) => {
                    const active = lineageIds.includes(lineage.id);
                    return (
                      <button
                        key={lineage.id}
                        type="button"
                        className={`lineage-list-item${active ? " lineage-list-item-active" : ""}`}
                        onClick={() => toggleLineage(lineage.id)}
                        aria-pressed={active}
                      >
                        {lineage.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {addingLineage ? (
                <div className="field-row">
                  <input
                    type="text"
                    placeholder={t("editPerson.newLineagePlaceholder")}
                    value={newLineageName}
                    onChange={(e) => setNewLineageName(e.target.value)}
                    autoFocus
                  />
                  <button type="button" onClick={handleCreateLineage}>
                    {t("common.save")}
                  </button>
                  <button type="button" onClick={() => { setAddingLineage(false); setNewLineageName(""); }}>
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button type="button" className="union-notes-edit-link" onClick={() => setAddingLineage(true)}>
                  {t("editPerson.addLineage")}
                </button>
              )}
              {lineageError && <p className="status status-error">{lineageError}</p>}
            </fieldset>

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
                <div className="field-row">
                  <input type="date" value={birthDateValue} onChange={(e) => setBirthDateValue(e.target.value)} />
                  <select
                    value={birthDatePrecision}
                    onChange={(e) => setBirthDatePrecision(e.target.value as DatePrecision)}
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
                  <input type="date" value={deathDateValue} onChange={(e) => setDeathDateValue(e.target.value)} />
                  <select
                    value={deathDatePrecision}
                    onChange={(e) => setDeathDatePrecision(e.target.value as DatePrecision)}
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
