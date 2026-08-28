import { createPortal } from "react-dom";
import { ExpandIcon, PencilIcon, PlusIcon } from "./Icons";

type Props = {
  x: number;
  y: number;
  onExpand: () => void;
  onEdit: () => void;
  onQuickAdd: () => void;
  labels: { expand: string; edit: string; quickAdd: string };
};

// Touch/PWA replacement for the four tiny corner buttons a card shows on
// :hover on a real pointer (see .card-expand-toggle/.card-edit-toggle/
// .card-quickadd-toggle in App.css) — hover isn't a real touch gesture, and
// those buttons are also sized to sit right at the card's edge, scaling
// with the canvas's own pan/zoom transform, which makes them tiny and
// fiddly to hit once zoomed out even where a touch's simulated `:hover`
// does reveal them. This is a separate, portaled popup instead: fixed
// pixel size regardless of canvas zoom, and big enough for a thumb.
//
// Portaled to document.body for the same reason HoverPreview is — family-
// chart's own pan/zoom transform promotes the canvas to its own GPU
// compositing layer, and living inside that subtree would tie this
// popup's own size to it too, which is exactly what it needs to not do.
export default function CardActionBubble({ x, y, onExpand, onEdit, onQuickAdd, labels }: Props) {
  return createPortal(
    // Two nested boxes rather than one: the outer one only ever carries the
    // static left/top + centering translate, so the inner one is free to
    // run its own scale/opacity entrance animation on `transform` without
    // the two fighting over that single CSS property.
    <div className="card-action-bubble-anchor" style={{ left: x, top: y }}>
      <div className="card-action-bubble" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="card-action-bubble-button"
          onClick={onExpand}
          aria-label={labels.expand}
          title={labels.expand}
        >
          <ExpandIcon size={22} />
        </button>
        <button
          type="button"
          className="card-action-bubble-button"
          onClick={onEdit}
          aria-label={labels.edit}
          title={labels.edit}
        >
          <PencilIcon size={22} />
        </button>
        <button
          type="button"
          className="card-action-bubble-button"
          onClick={onQuickAdd}
          aria-label={labels.quickAdd}
          title={labels.quickAdd}
        >
          <PlusIcon size={22} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
