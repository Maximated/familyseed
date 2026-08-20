import { useTranslation } from "react-i18next";
import { DiagonalArrowIcon } from "./Icons";

type Props = {
  open: boolean;
  onToggle: () => void;
};

// A small always-visible trigger in the canvas's bottom-left corner,
// revealing the actual legend on hover (desktop) or tap (touch/PWA,
// via .legend-toggle-open) instead of it permanently occupying screen
// space — most noticeable in horizontal mode, where the canvas is
// already short and every row of chrome competes with it directly.
export default function Legend({ open, onToggle }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`legend-toggle${open ? " legend-toggle-open" : ""}`}>
      <button
        type="button"
        className="legend-trigger"
        onClick={onToggle}
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
