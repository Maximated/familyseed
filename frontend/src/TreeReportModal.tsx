import { useState } from "react";
import { useTranslation } from "react-i18next";
import { personReportUrl, type Individual, type ReportDirection } from "./api";
import PersonPicker from "./PersonPicker";

type Props = {
  treeId: string;
  onClose: () => void;
};

const REPORT_DIRECTIONS: ReportDirection[] = ["ancestors", "descendants", "both"];

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function TreeReportModal({ treeId, onClose }: Props) {
  const { t } = useTranslation();
  const [personId, setPersonId] = useState<string | null>(null);
  const [personName, setPersonName] = useState<string | null>(null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("app.report")}</h2>

        <fieldset>
          <legend>{t("personPicker.placeholder")}</legend>
          <PersonPicker
            treeId={treeId}
            selectedName={personName}
            onSelect={(person) => {
              setPersonId(person.id);
              setPersonName(personLabel(person));
            }}
          />
        </fieldset>

        {personId && (
          <div className="gedcom-export-list">
            {REPORT_DIRECTIONS.map((direction) => (
              <a
                key={direction}
                className="gedcom-export-item"
                href={personReportUrl(treeId, personId, direction)}
                target="_blank"
                rel="noreferrer"
              >
                {t(`report.${direction}`)}
              </a>
            ))}
          </div>
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
