import { useState } from "react";
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
export default function Legend() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`legend-toggle${open ? " legend-toggle-open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="legend-trigger"
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label={t("legend.toggleReveal")}
        title={t("legend.toggleReveal")}
      >
        <DiagonalArrowIcon />
      </button>
      <div className="legend-panel">
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
      </div>
    </div>
  );
}
