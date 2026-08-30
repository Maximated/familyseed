import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { addFamilyChild, copySpouseChildren, getSpouseChildCandidates, type Individual, type SpouseChildCandidate } from "./api";
import PersonPicker from "./PersonPicker";

export type UnionChild = { id: string; name: string };

type Props = {
  treeId: string;
  familyId: string;
  partner1Id: string;
  partner2Id: string;
  initialChildren: UnionChild[];
  // Called after a successful add so the caller can refresh the tree
  // canvas — the panel's own list already updates itself locally
  // (optimistic), same reasoning as UnionNotesEditor's onSaved.
  onSaved: () => void;
};

// Adding a child here (instead of from one parent's own edit form) links
// them to both partners at once — this union's two people are already
// fixed, so there's no separate "now do it again for the other parent"
// step the way there is when linking one parent at a time.
export default function UnionChildrenEditor({ treeId, familyId, partner1Id, partner2Id, initialChildren, onSaved }: Props) {
  const { t } = useTranslation();
  const [children, setChildren] = useState<UnionChild[]>(initialChildren);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spouseCandidates, setSpouseCandidates] = useState<SpouseChildCandidate[]>([]);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    setChildren(initialChildren);
  }, [initialChildren]);

  useEffect(() => {
    let cancelled = false;
    getSpouseChildCandidates(treeId, familyId)
      .then((candidates) => {
        if (!cancelled) setSpouseCandidates(candidates);
      })
      .catch(() => {
        // A stale/missing union just means the button doesn't appear.
      });
    return () => {
      cancelled = true;
    };
  }, [treeId, familyId]);

  async function handleAdd(person: Individual) {
    setError(null);
    try {
      await addFamilyChild(treeId, familyId, person.id);
      setChildren((prev) => [...prev, { id: person.id, name: `${person.givenNames} ${person.surname1}` }]);
      setSpouseCandidates((prev) => prev.filter((c) => c.id !== person.id));
      setAdding(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCopySpouseChildren() {
    setError(null);
    setCopying(true);
    try {
      const copied = await copySpouseChildren(treeId, familyId);
      setChildren((prev) => [...prev, ...copied.map((c) => ({ id: c.id, name: `${c.givenNames} ${c.surname1}` }))]);
      setSpouseCandidates([]);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="info-panel-section">
      <h3 className="info-panel-section-heading">{t("editPerson.childrenLegend")}</h3>
      {children.length === 0 ? (
        <p className="field-hint">{t("editPerson.noChildren")}</p>
      ) : (
        <ul className="info-panel-bullets">
          {children.map((child) => (
            <li key={child.id}>{child.name}</li>
          ))}
        </ul>
      )}
      {adding ? (
        <PersonPicker
          treeId={treeId}
          selectedName={null}
          excludeIds={[partner1Id, partner2Id, ...children.map((c) => c.id)]}
          excludeAncestorsOf={[partner1Id, partner2Id]}
          onSelect={handleAdd}
        />
      ) : (
        <button type="button" className="union-notes-edit-link" onClick={() => setAdding(true)}>
          {t("editPerson.addChild")}
        </button>
      )}
      {!adding && spouseCandidates.length > 0 && (
        <button
          type="button"
          className="union-notes-edit-link"
          onClick={handleCopySpouseChildren}
          disabled={copying}
        >
          {t("editPerson.copySpouseChildren")}
        </button>
      )}
      {error && <p className="status status-error">{error}</p>}
    </div>
  );
}
