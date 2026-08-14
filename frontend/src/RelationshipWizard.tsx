import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addParent,
  createFamily,
  fetchIndividualRelations,
  type Individual,
  type IndividualRelations,
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

  const currentId = personIds[index];
  const done = index >= personIds.length;

  useEffect(() => {
    if (!started || done) return;
    setLoading(true);
    fetchIndividualRelations(treeId, currentId)
      .then(setRelations)
      .finally(() => setLoading(false));
  }, [started, done, treeId, currentId]);

  async function refresh() {
    const updated = await fetchIndividualRelations(treeId, currentId);
    setRelations(updated);
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
            <button type="button" onClick={() => setStarted(true)}>
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
            <button type="button" onClick={handleFinishNow}>
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

              <AddRelationSection
                legend={t("relationshipWizard.partnerLegend")}
                people={partners}
                peopleLabel={(p) => `${p.givenNames} ${p.surname1}`}
                treeId={treeId}
                excludeIds={alreadyRelatedIds}
                addLabel={t("relationshipWizard.addPartner")}
                onAdd={async (partner) => {
                  await createFamily(treeId, { partner1Id: currentId, partner2Id: partner.id, unionType: "MARRIAGE" });
                  await refresh();
                }}
              />

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
          <button type="button" onClick={() => setIndex((i) => i + 1)}>
            {t("relationshipWizard.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
