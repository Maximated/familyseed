import { useState } from "react";
import { useTranslation } from "react-i18next";
import { personReportUrl, type Individual, type ReportDirection, type ReportLayout } from "./api";
import PersonPicker from "./PersonPicker";
import IOSToggle from "./IOSToggle";

type Props = {
  treeId: string;
  onClose: () => void;
};

const REPORT_DIRECTIONS: ReportDirection[] = ["ancestors", "descendants", "both"];
const REPORT_LAYOUTS: ReportLayout[] = ["vertical", "horizontal", "descending"];

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function TreeReportModal({ treeId, onClose }: Props) {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<Individual[]>([]);
  const [layout, setLayout] = useState<ReportLayout>("vertical");

  function removeRoot(id: string) {
    setRoots((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("app.report")}</h2>

        <fieldset>
          <legend>{t("personPicker.placeholder")}</legend>
          {roots.map((person) => (
            <p key={person.id} className="person-picker-selected">
              {personLabel(person)}{" "}
              <button type="button" className="person-picker-change" onClick={() => removeRoot(person.id)}>
                {t("report.removeRoot")}
              </button>
            </p>
          ))}
          <PersonPicker
            treeId={treeId}
            selectedName={null}
            onSelect={(person) => setRoots((prev) => [...prev, person])}
            excludeIds={roots.map((p) => p.id)}
          />
          {roots.length > 0 && <p className="field-hint">{t("report.addAnotherRootHint")}</p>}
        </fieldset>

        {roots.length > 0 && (
          <>
            <fieldset>
              <legend>{t("report.layoutLegend")}</legend>
              {REPORT_LAYOUTS.map((option) => (
                <IOSToggle
                  key={option}
                  checked={layout === option}
                  onChange={() => setLayout(option)}
                  label={t(`report.layout.${option}`)}
                />
              ))}
            </fieldset>

            <div className="gedcom-export-list">
              {REPORT_DIRECTIONS.map((direction) => (
                <a
                  key={direction}
                  className="gedcom-export-item"
                  href={personReportUrl(
                    treeId,
                    roots.map((p) => p.id),
                    direction,
                    layout,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(`report.${direction}`)}
                </a>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
