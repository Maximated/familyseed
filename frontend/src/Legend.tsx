import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { DiagonalArrowIcon } from "./Icons";

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
  const [anchor, setAnchor] = useState({ left: 16, bottom: 60 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
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
          <span className="legend-item">
            <span className="legend-icon">⚭</span>
            <span className="legend-label">{t("legend.marriage")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">⚭²</span>
            <span className="legend-label">{t("legend.marriage2")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">⚯</span>
            <span className="legend-label">{t("legend.partnership")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">※</span>
            <span className="legend-label">{t("legend.extramarital")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">※²</span>
            <span className="legend-label">{t("legend.extramarital2")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">⚮</span>
            <span className="legend-label">{t("legend.endedByDivorce")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">✝</span>
            <span className="legend-label">{t("legend.endedByDeath")}</span>
          </span>
          <span className="legend-item">
            <span className="legend-icon">○</span>
            <span className="legend-label">{t("legend.unknown")}</span>
          </span>
          <span className="legend-hint">{t("legend.hint")}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
