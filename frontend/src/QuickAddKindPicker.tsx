import { useTranslation } from "react-i18next";
import type { RelationshipKind } from "./AddPersonForm";

// Not itself a RelationshipKind AddPersonForm/the backend know about — "+
// sibling" is sugar for CHILD_OF_PARENTS with both of the clicked card's own
// parents copied in (see handleQuickAddKindPicked in TreeView.tsx, which
// does that lookup and translates this into an ordinary CHILD_OF_PARENTS
// QuickAddInitialRelation before AddPersonForm ever sees it).
export type QuickAddPickerKind = RelationshipKind | "SIBLING_OF";

type Props = {
  onPick: (kind: QuickAddPickerKind) => void;
  onClose: () => void;
  loading: boolean;
};

// Opened by a card's own "+" corner button (see TreeView.tsx) — picking one
// of these feeds straight into AddPersonForm's initialRelation, with that
// card's own person (or, for "sibling", their parents) already filled into
// the right slot. Each option is plain clickable text, not a boxed button or
// toggle — an earlier version used IOSToggle rows with a hold-then-fade
// transition into AddPersonForm, dropped by request: picking a relation is a
// single, low-stakes tap that should react immediately, not spend several
// hundred ms proving to the user that it registered.
export default function QuickAddKindPicker({ onPick, onClose, loading }: Props) {
  const { t } = useTranslation();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-frosted quickadd-kind-picker" onClick={(e) => e.stopPropagation()}>
        <h2>{t("quickAdd.title")}</h2>
        <ul className="quickadd-kind-list">
          <li>
            <button type="button" className="quickadd-kind-link" onClick={() => onPick("CHILD_OF_PARENTS")} disabled={loading}>
              {t("quickAdd.child")}
            </button>
          </li>
          <li>
            <button type="button" className="quickadd-kind-link" onClick={() => onPick("SIBLING_OF")} disabled={loading}>
              {t("quickAdd.sibling")}
            </button>
          </li>
          <li>
            <button type="button" className="quickadd-kind-link" onClick={() => onPick("PARTNER")} disabled={loading}>
              {t("quickAdd.partner")}
            </button>
          </li>
          <li>
            <button type="button" className="quickadd-kind-link" onClick={() => onPick("PARENT_OF")} disabled={loading}>
              {t("quickAdd.parent")}
            </button>
          </li>
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
