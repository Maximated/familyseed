import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { addFamilyChild, type Individual } from "./api";
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

  useEffect(() => {
    setChildren(initialChildren);
  }, [initialChildren]);

  async function handleAdd(person: Individual) {
    setError(null);
    try {
      await addFamilyChild(treeId, familyId, person.id);
      setChildren((prev) => [...prev, { id: person.id, name: `${person.givenNames} ${person.surname1}` }]);
      setAdding(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
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
          onSelect={handleAdd}
        />
      ) : (
        <button type="button" className="union-notes-edit-link" onClick={() => setAdding(true)}>
          {t("editPerson.addChild")}
        </button>
      )}
      {error && <p className="status status-error">{error}</p>}
    </div>
  );
}
