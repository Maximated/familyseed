import { useState } from "react";
import { useTranslation } from "react-i18next";
import IOSToggle from "./IOSToggle";

export type ExportImageOptions = {
  transparent: boolean;
  format: "png" | "svg";
  pixelRatio: number;
  scope: "current" | "whole";
  orientation: "vertical" | "horizontal";
};

type Props = {
  // Whatever orientation the tree is actually showing right now, used only
  // to seed this panel's own orientation toggle on mount — matches the old
  // popover's "defaults to what's on screen" behavior without needing a
  // reset-on-open effect, since this component remounts fresh each time
  // the GEDCOM/export modal opens.
  currentOrientation: "vertical" | "horizontal";
  exporting: boolean;
  onExport: (options: ExportImageOptions) => void;
};

export default function ExportImagePanel({ currentOrientation, exporting, onExport }: Props) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [background, setBackground] = useState<"opaque" | "transparent">("opaque");
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [scope, setScope] = useState<"current" | "whole">("whole");
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">(currentOrientation);

  return (
    <div className="export-image-panel">
      <div className="export-option-group">
        <span className="export-option-label">{t("app.exportFormatLabel")}</span>
        <IOSToggle checked={format === "png"} onChange={() => setFormat("png")} label="PNG" />
        <IOSToggle checked={format === "svg"} onChange={() => setFormat("svg")} label="SVG" />
        {format === "svg" && <p className="field-hint">{t("app.exportFormatSvgHint")}</p>}
      </div>

      <div className="export-option-group">
        <span className="export-option-label">{t("app.exportScopeLabel")}</span>
        <IOSToggle checked={scope === "current"} onChange={() => setScope("current")} label={t("app.exportScopeCurrent")} />
        <IOSToggle checked={scope === "whole"} onChange={() => setScope("whole")} label={t("app.exportScopeWhole")} />
      </div>

      <div className="export-option-group">
        <span className="export-option-label">{t("app.exportOrientationLabel")}</span>
        <IOSToggle
          checked={orientation === "vertical"}
          onChange={() => setOrientation("vertical")}
          label={t("app.orientationVertical")}
        />
        <IOSToggle
          checked={orientation === "horizontal"}
          onChange={() => setOrientation("horizontal")}
          label={t("app.orientationHorizontal")}
        />
      </div>

      <div className="export-option-group">
        <span className="export-option-label">{t("app.exportBackgroundLabel")}</span>
        <IOSToggle
          checked={background === "opaque"}
          onChange={() => setBackground("opaque")}
          label={t("app.exportTreeImageWithBg")}
        />
        <IOSToggle
          checked={background === "transparent"}
          onChange={() => setBackground("transparent")}
          label={t("app.exportTreeImageTransparent")}
        />
      </div>

      {format === "png" && (
        <div className="export-option-group">
          <span className="export-option-label">{t("app.exportQualityLabel")}</span>
          <IOSToggle checked={quality === "standard"} onChange={() => setQuality("standard")} label={t("app.exportQualityStandard")} />
          <IOSToggle checked={quality === "high"} onChange={() => setQuality("high")} label={t("app.exportQualityHigh")} />
        </div>
      )}

      <button
        type="button"
        className="btn-primary export-option-submit"
        disabled={exporting}
        onClick={() =>
          onExport({
            transparent: background === "transparent",
            format,
            pixelRatio: quality === "high" ? 4 : 2,
            scope,
            orientation,
          })
        }
      >
        {exporting ? t("app.exportingTreeImage") : t("app.exportSubmit")}
      </button>
    </div>
  );
}
