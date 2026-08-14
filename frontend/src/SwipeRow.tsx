import { useRef, useState } from "react";

// Wide enough for one or two icon buttons by default — the actions
// revealed by the swipe render at exactly this width, so the drag
// distance and the "past halfway, snap open" threshold both key off it.
// Callers with a wider action (e.g. a text button instead of icons) can
// override it via the `actionsWidth` prop.
const DEFAULT_ACTIONS_WIDTH = 84;

type Props = {
  children: React.ReactNode;
  actions: React.ReactNode;
  actionsWidth?: number;
};

// A list row you swipe left to reveal action buttons (edit/delete/restore)
// underneath, instead of showing them permanently boxed next to the row —
// used by IndividualsSearchView, TrashView, and LineagesManageView. Pointer
// Events (not touch-specific) so this works with a mouse drag too, not just
// on a touchscreen.
export default function SwipeRow({ children, actions, actionsWidth = DEFAULT_ACTIONS_WIDTH }: Props) {
  const ACTIONS_WIDTH = actionsWidth;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [liveX, setLiveX] = useState(0);
  // Kept alive past pointerup (only cleared on the next pointerdown) so the
  // click event that immediately follows a tap can still consult it — that's
  // how "tap while already open" gets told apart from "tap while closed".
  const gestureRef = useRef<{ startX: number; base: number; moved: boolean } | null>(null);

  const translateX = dragging ? liveX : open ? -ACTIONS_WIDTH : 0;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const base = open ? -ACTIONS_WIDTH : 0;
    gestureRef.current = { startX: e.clientX, base, moved: false };
    setDragging(true);
    setLiveX(base);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gestureRef.current;
    if (!g) return;
    const delta = e.clientX - g.startX;
    if (Math.abs(delta) > 4) g.moved = true;
    setLiveX(Math.min(0, Math.max(-ACTIONS_WIDTH, g.base + delta)));
  }

  function handlePointerUp() {
    const g = gestureRef.current;
    if (!g) return;
    setDragging(false);
    if (g.moved) {
      setOpen(liveX < -ACTIONS_WIDTH / 2);
    } else if (g.base !== 0) {
      // A plain tap while already open closes it instead of firing
      // whatever's underneath — the swipe has to be re-done to act.
      setOpen(false);
    }
  }

  // Runs before the row content's own onClick (e.g. "navigate to this
  // person") — swallow that click if this gesture just dragged the row, or
  // if it was a tap that closed an already-open row, so the two gestures
  // never both fire off the same touch/click.
  function handleContentClickCapture(e: React.MouseEvent) {
    const g = gestureRef.current;
    if (g && (g.moved || g.base !== 0)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  return (
    <div className="swipe-row">
      <div className="swipe-row-actions" style={{ width: ACTIONS_WIDTH }}>
        {actions}
      </div>
      <div
        className="swipe-row-content"
        style={{ transform: `translateX(${translateX}px)`, transition: dragging ? "none" : undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleContentClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
