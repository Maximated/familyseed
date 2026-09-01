import { createPortal } from "react-dom";
import { MinusIcon, PlusIcon, XIcon } from "./Icons";

type Props = {
  x: number;
  y: number;
  canCollapseAncestors: boolean;
  canExpandAncestors: boolean;
  canCollapseDescendants: boolean;
  canExpandDescendants: boolean;
  onAncestorChange: (delta: 1 | -1) => void;
  onDescendantChange: (delta: 1 | -1) => void;
  onClose: () => void;
  labels: {
    expandAncestors: string;
    collapseAncestors: string;
    expandDescendants: string;
    collapseDescendants: string;
    close: string;
  };
};

// Same portal-to-body + fixed-pixel-position technique as CardActionBubble
// (see its own comment for why: family-chart's own pan/zoom transform
// promotes the canvas to its own GPU compositing layer, and living inside
// that subtree would tie this panel's size to it too, shrinking it away at
// low zoom). Unlike CardActionBubble this isn't a transient popup — it
// stays mounted for as long as its branch is open, so there's no dismiss-
// on-outside-click behavior here.
export default function LineageBranchControls({
  x,
  y,
  canCollapseAncestors,
  canExpandAncestors,
  canCollapseDescendants,
  canExpandDescendants,
  onAncestorChange,
  onDescendantChange,
  onClose,
  labels,
}: Props) {
  return createPortal(
    <div className="lineage-branch-controls" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onAncestorChange(-1)}
        disabled={!canCollapseAncestors}
        aria-label={labels.collapseAncestors}
        title={labels.collapseAncestors}
      >
        <MinusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onAncestorChange(1)}
        disabled={!canExpandAncestors}
        aria-label={labels.expandAncestors}
        title={labels.expandAncestors}
      >
        <PlusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onDescendantChange(-1)}
        disabled={!canCollapseDescendants}
        aria-label={labels.collapseDescendants}
        title={labels.collapseDescendants}
      >
        <MinusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onDescendantChange(1)}
        disabled={!canExpandDescendants}
        aria-label={labels.expandDescendants}
        title={labels.expandDescendants}
      >
        <PlusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button lineage-branch-controls-close"
        onClick={onClose}
        aria-label={labels.close}
        title={labels.close}
      >
        <XIcon size={16} />
      </button>
    </div>,
    document.body,
  );
}
