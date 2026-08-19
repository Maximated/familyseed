import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addParent,
  createFamily,
  fetchIndividualRelations,
  fillFamilyPartner,
  type Individual,
  type IndividualRelations,
  type RelatedPerson,
} from "./api";
import PersonPicker from "./PersonPicker";

type Props = {
  treeId: string;
  // The batch just created by an import — walked one at a time, in order.
  personIds: string[];
  // Called once, when the wizard actually finishes (not on early "Ahora
  // no") — every link along the way is already saved via its own API call,
  // this is just the caller's cue to refresh whatever list/tree it shows.
  onFinished: () => void;
  onClose: () => void;
};

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  const year = p.birthDateText ? ` (${p.birthDateText})` : "";
  return `${[p.givenNames, surname].filter(Boolean).join(" ")}${year}`;
}

// Shown once per person, per relationship kind (parent/partner/child) —
// each is independently optional: adding one doesn't require filling the
// others, and "Siguiente" always works regardless of what's been added.
function AddRelationSection({
  legend,
  hint,
  people,
  peopleLabel,
  treeId,
  excludeIds,
  onAdd,
  addLabel,
}: {
  legend: string;
  hint?: string;
  people: Individual[];
  peopleLabel: (p: Individual) => string;
  treeId: string;
  excludeIds: string[];
  onAdd: (person: Individual) => Promise<void>;
  addLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <fieldset>
      <legend>{legend}</legend>
      {hint && <p className="field-hint">{hint}</p>}
      {people.length === 0 ? null : (
        <ul className="edit-parents-list">
          {people.map((p) => (
            <li key={p.id}>{peopleLabel(p)}</li>
          ))}
        </ul>
      )}
      {adding ? (
        <PersonPicker
          treeId={treeId}
          selectedName={null}
          excludeIds={excludeIds}
          onSelect={async (person) => {
            setError(null);
            try {
              await onAdd(person);
              setAdding(false);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      ) : (
        <button type="button" className="union-notes-edit-link" onClick={() => setAdding(true)}>
          {addLabel}
        </button>
      )}
      {error && <p className="status status-error">{error}</p>}
    </fieldset>
  );
}

export default function RelationshipWizard({ treeId, personIds, onFinished, onClose }: Props) {
  const { t } = useTranslation();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [relations, setRelations] = useState<IndividualRelations | null>(null);
  const [loading, setLoading] = useState(false);

  const [addingPartner, setAddingPartner] = useState(false);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  // Set when the just-picked partner already has children on a family with
  // only one known parent — asks whether those children should end up
  // shared by both, instead of silently creating a second, separate union.
  const [pendingPartner, setPendingPartner] = useState<{
    partner: Individual;
    familyId: string;
    children: RelatedPerson[];
  } | null>(null);

  const currentId = personIds[index];
  const done = index >= personIds.length;

  useEffect(() => {
    if (!started || done) return;
    setLoading(true);
    fetchIndividualRelations(treeId, currentId)
      .then(setRelations)
      .finally(() => setLoading(false));
  }, [started, done, treeId, currentId]);

  useEffect(() => {
    setAddingPartner(false);
    setPartnerError(null);
    setPendingPartner(null);
  }, [currentId]);

  async function refresh() {
    const updated = await fetchIndividualRelations(treeId, currentId);
    setRelations(updated);
  }

  // A family counts as "has unclaimed children" only when it's the sole
  // family with an empty slot — if the candidate has two or more, it's
  // ambiguous which past union the new partner should join, so the smart
  // merge is skipped and a plain new union is created instead (safe
  // default, no risk of attaching someone to the wrong past relationship).
  async function findInheritableChildren(candidate: Individual) {
    const candidateRelations = await fetchIndividualRelations(treeId, candidate.id);
    const emptySlotFamilyIds = candidateRelations.partnerships.filter((p) => p.partner === null).map((p) => p.familyId);
    if (emptySlotFamilyIds.length !== 1) return null;
    const [familyId] = emptySlotFamilyIds;
    const children = candidateRelations.children.filter((c) => c.familyId === familyId);
    return children.length > 0 ? { familyId, children } : null;
  }

  async function handlePartnerSelected(candidate: Individual) {
    setPartnerError(null);
    try {
      const inheritable = await findInheritableChildren(candidate);
      if (inheritable) {
        setPendingPartner({ partner: candidate, ...inheritable });
      } else {
        await createFamily(treeId, { partner1Id: currentId, partner2Id: candidate.id, unionType: "MARRIAGE" });
        setAddingPartner(false);
        await refresh();
      }
    } catch (err) {
      setPartnerError((err as Error).message);
    }
  }

  async function resolvePendingPartner(inheritChildren: boolean) {
    if (!pendingPartner) return;
    setPartnerError(null);
    try {
      if (inheritChildren) {
        await fillFamilyPartner(treeId, pendingPartner.familyId, currentId);
      } else {
        await createFamily(treeId, { partner1Id: currentId, partner2Id: pendingPartner.partner.id, unionType: "MARRIAGE" });
      }
      setPendingPartner(null);
      setAddingPartner(false);
      await refresh();
    } catch (err) {
      setPartnerError((err as Error).message);
    }
  }

  function handleFinishNow() {
    onFinished();
    onClose();
  }

  if (!started) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <h2>{t("relationshipWizard.introTitle")}</h2>
          <p>{t("relationshipWizard.introBody", { count: personIds.length })}</p>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              {t("relationshipWizard.skipAll")}
            </button>
            <button type="button" className="btn-primary" onClick={() => setStarted(true)}>
              {t("relationshipWizard.start")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="modal-backdrop" onClick={handleFinishNow}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <h2>{t("relationshipWizard.doneTitle")}</h2>
          <p>{t("relationshipWizard.doneBody")}</p>
          <div className="modal-actions">
            <button type="button" className="btn-primary" onClick={handleFinishNow}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <p className="field-hint">{t("relationshipWizard.progress", { current: index + 1, total: personIds.length })}</p>
        <h2>{loading || !relations ? t("common.loading") : personLabel(relations.individual)}</h2>

        {!loading && relations && (() => {
          const partners = relations.partnerships.map((p) => p.partner).filter((p): p is Individual => p !== null);
          // No picker offers someone already related to this person in ANY
          // of the three ways — otherwise "add partner" would happily let
          // you re-link someone who's already their child's other parent
          // (a real Family row already ties them together, just without an
          // explicit union type), creating a second, redundant union.
          const alreadyRelatedIds = [
            currentId,
            ...relations.parents.map((p) => p.id),
            ...partners.map((p) => p.id),
            ...relations.children.map((p) => p.id),
          ];

          return (
            <>
              <AddRelationSection
                legend={t("editPerson.parentsLegend")}
                people={relations.parents}
                peopleLabel={(p) => `${p.givenNames} ${p.surname1}`}
                treeId={treeId}
                excludeIds={alreadyRelatedIds}
                addLabel={t("editPerson.addParent")}
                onAdd={async (parent) => {
                  await addParent(treeId, currentId, parent.id);
                  await refresh();
                }}
              />

              <fieldset>
                <legend>{t("relationshipWizard.partnerLegend")}</legend>
                {partners.length === 0 ? null : (
                  <ul className="edit-parents-list">
                    {partners.map((p) => (
                      <li key={p.id}>{`${p.givenNames} ${p.surname1}`}</li>
                    ))}
                  </ul>
                )}
                {pendingPartner ? (
                  <div className="field-hint">
                    <p>
                      {t("relationshipWizard.inheritChildrenPrompt", {
                        partner: personLabel(pendingPartner.partner),
                        children: pendingPartner.children.map((c) => `${c.givenNames} ${c.surname1}`).join(", "),
                      })}
                    </p>
                    <div className="modal-actions">
                      <button type="button" onClick={() => resolvePendingPartner(false)}>
                        {t("relationshipWizard.inheritChildrenNo")}
                      </button>
                      <button type="button" className="btn-primary" onClick={() => resolvePendingPartner(true)}>
                        {t("relationshipWizard.inheritChildrenYes")}
                      </button>
                    </div>
                  </div>
                ) : addingPartner ? (
                  <PersonPicker
                    treeId={treeId}
                    selectedName={null}
                    excludeIds={alreadyRelatedIds}
                    onSelect={handlePartnerSelected}
                  />
                ) : (
                  <button type="button" className="union-notes-edit-link" onClick={() => setAddingPartner(true)}>
                    {t("relationshipWizard.addPartner")}
                  </button>
                )}
                {partnerError && <p className="status status-error">{partnerError}</p>}
              </fieldset>

              <AddRelationSection
                legend={t("editPerson.childrenLegend")}
                people={relations.children}
                peopleLabel={(p) => `${p.givenNames} ${p.surname1}`}
                treeId={treeId}
                excludeIds={alreadyRelatedIds}
                addLabel={t("editPerson.addChild")}
                onAdd={async (child) => {
                  await addParent(treeId, child.id, currentId);
                  await refresh();
                }}
              />
            </>
          );
        })()}

        <div className="modal-actions">
          <button type="button" onClick={handleFinishNow}>
            {t("relationshipWizard.finishNow")}
          </button>
          <button type="button" className="btn-primary" onClick={() => setIndex((i) => i + 1)}>
            {t("relationshipWizard.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
