import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { DiagonalArrowIcon } from "./Icons";
import { UNION_STATUS_ICON_PATHS, UNION_TYPE_ICON_PATHS, UnionIconSvg } from "./unionMarkIcons";
import type { UnionStatus, UnionType } from "./api";

// Reuses unionType.*/unionStatus.* (the same labels InfoPanel shows for a
// union's own type/status) rather than a separate, parallel set of legend
// strings — one one-word difference between the two would've been a
// silent inconsistency, not a deliberate one.
const UNION_TYPES: UnionType[] = ["MARRIAGE", "PARTNERSHIP", "EXTRAMARITAL", "UNKNOWN"];
// ONGOING has no icon of its own (see unionMarkIcons.tsx) — the four
// statuses that do are exactly the ones worth explaining here.
const UNION_STATUSES: UnionStatus[] = ["ENDED_BY_DEATH", "DIVORCED", "SEPARATED", "ANNULLED"];

// A small always-visible trigger in the canvas's bottom-left corner,
// revealing the actual legend on hover (desktop) or tap (touch/PWA)
// instead of it permanently occupying screen space — most noticeable in
// horizontal mode, where the canvas is already short and every row of
// chrome competes with it directly.
//
// Open state is owned entirely here (not lifted to a parent prop) and
// driven by both mouseenter/mouseleave *and* the button's own click,
// rather than mixing JS state with a CSS :hover rule — the two used to
// fight: clicking the trigger while the mouse was still resting on it
// (the normal way to click anything) toggled `open` to false, but the
// separate :hover rule kept showing the panel anyway since the pointer
// never actually left, so closing by click only ever appeared to work
// after moving the mouse away. Doing the reveal in JS too means a click's
// own state change is authoritative regardless of hover, and it doesn't
// get reopened until the pointer genuinely leaves and re-enters.
//
// The panel itself is portaled to document.body (position: fixed, anchored
// off the trigger's own measured rect) instead of rendering inline here:
// family-chart's own pan/zoom transform promotes the tree canvas to its own
// GPU compositing layer, and backdrop-filter can't blur across that layer
// boundary in Chromium-based browsers with stricter compositing (confirmed
// in Brave). Since the panel is no longer a DOM descendant of this wrapper
// once portaled, "is the pointer over the trigger or the panel" can't rely
// on physical containment anymore — a short close delay (closeTimerRef)
// bridges the moment the pointer crosses from one to the other so hovering
// from the trigger onto the panel above it doesn't flicker-close.
export default function Legend() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 32, bottom: 76 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      // Offset past the trigger's own position (not flush with it) — sitting
      // exactly in the corner the trigger occupies read as cramped, PWA users
      // reported it as too tucked into the edge to comfortably reach.
      if (rect) setAnchor({ left: rect.left + 16, bottom: window.innerHeight - rect.top + 24 });
    };
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    return () => window.removeEventListener("resize", updateAnchor);
  }, []);

  const reveal = () => {
    window.clearTimeout(closeTimerRef.current);
    setOpen(true);
  };
  const scheduleHide = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 150);
  };
  const toggleClick = () => {
    window.clearTimeout(closeTimerRef.current);
    setOpen((v) => !v);
  };

  return (
    <div className={`legend-toggle${open ? " legend-toggle-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="legend-trigger"
        onClick={toggleClick}
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        onFocus={reveal}
        onBlur={scheduleHide}
        aria-expanded={open}
        aria-label={t("legend.toggleReveal")}
        title={t("legend.toggleReveal")}
      >
        <DiagonalArrowIcon />
      </button>
      {createPortal(
        <div
          className={`legend-panel${open ? " legend-panel-open" : ""}`}
          style={{ left: anchor.left, bottom: anchor.bottom }}
          onMouseEnter={reveal}
          onMouseLeave={scheduleHide}
        >
          {UNION_TYPES.map((type) => (
            <span className="legend-item" key={type}>
              <span className="legend-icon">
                <UnionIconSvg paths={UNION_TYPE_ICON_PATHS[type]} size={17} />
              </span>
              <span className="legend-label">{t(`unionType.${type}`)}</span>
            </span>
          ))}
          {UNION_STATUSES.map((status) => (
            <span className="legend-item" key={status}>
              <span className="legend-icon">
                <UnionIconSvg paths={UNION_STATUS_ICON_PATHS[status]!} size={17} />
              </span>
              <span className="legend-label">{t(`unionStatus.${status}`)}</span>
            </span>
          ))}
          <span className="legend-hint">{t("legend.orderHint")}</span>
          <span className="legend-hint">{t("legend.hint")}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
