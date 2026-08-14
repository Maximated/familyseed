import { useTranslation } from "react-i18next";

type Props = {
  magnified: boolean;
  onToggle: () => void;
};

// Rendered from two different spots in TreeView depending on tree
// orientation (see the .legend-panel CSS comment for why) — kept as its
// own component so that split doesn't mean keeping two copies of this
// markup in sync by hand.
export default function Legend({ magnified, onToggle }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={`legend-panel${magnified ? " legend-magnified" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={magnified}
      aria-label={t("legend.toggleMagnify")}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
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
    </div>
  );
}
