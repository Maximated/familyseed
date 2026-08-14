import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { csvExportUrl, csvTemplateUrl, gedcomExportUrl, importCsv, importGedcom, type Individual } from "./api";
import PersonPicker from "./PersonPicker";

type FileFormat = "ged" | "csv";

type Props = {
  treeId: string;
  initialPersonId?: string | null;
  initialPersonName?: string | null;
  onImported: () => void;
  onClose: () => void;
};

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function GedcomView({ treeId, initialPersonId, initialPersonName, onImported, onClose }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ individuals: number; families: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [personId, setPersonId] = useState<string | null>(initialPersonId ?? null);
  const [personName, setPersonName] = useState<string | null>(initialPersonName ?? null);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    const format: FileFormat | null = name.endsWith(".ged") ? "ged" : name.endsWith(".csv") ? "csv" : null;
    if (!format) {
      setError(t("gedcom.importErrorType"));
      return;
    }
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const imported = format === "csv" ? await importCsv(treeId, file) : await importGedcom(treeId, file);
      setResult(imported);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) handleFile(file);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("gedcom.title")}</h2>

        <fieldset>
          <legend>{t("gedcom.importHeading")}</legend>
          <div
            className={`gedcom-dropzone${dragging ? " gedcom-dropzone-active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <p>{importing ? t("gedcom.importing") : t("gedcom.dropHint")}</p>
            {!importing && <p className="field-hint">{t("gedcom.dropHintOrBrowse")}</p>}
          </div>
          <input ref={fileInputRef} type="file" accept=".ged,.csv" onChange={handleInputChange} style={{ display: "none" }} />

          {result && (
            <p className="status">{t("gedcom.importSuccess", { individuals: result.individuals, families: result.families })}</p>
          )}
          {error && <p className="status status-error">{error}</p>}
        </fieldset>

        <fieldset>
          <legend>{t("gedcom.exportHeading")}</legend>
          <div className="gedcom-export-list">
            <a className="gedcom-export-item" href={gedcomExportUrl(treeId)} target="_blank" rel="noreferrer">
              {t("gedcom.exportFullTree")}
            </a>
            <a className="gedcom-export-item" href={csvExportUrl(treeId)} target="_blank" rel="noreferrer">
              {t("gedcom.exportFullTreeCsv")}
            </a>
          </div>
          <PersonPicker
            treeId={treeId}
            selectedName={personName}
            onSelect={(person) => {
              setPersonId(person.id);
              setPersonName(personLabel(person));
            }}
          />
          {personId && personName && (
            <div className="gedcom-export-list">
              <a
                className="gedcom-export-item"
                href={gedcomExportUrl(treeId, personId, "ancestors")}
                target="_blank"
                rel="noreferrer"
              >
                {t("gedcom.exportAncestorsOf", { name: personName })}
              </a>
              <a
                className="gedcom-export-item"
                href={gedcomExportUrl(treeId, personId, "descendants")}
                target="_blank"
                rel="noreferrer"
              >
                {t("gedcom.exportDescendantsOf", { name: personName })}
              </a>
              <a
                className="gedcom-export-item"
                href={csvExportUrl(treeId, personId, "ancestors")}
                target="_blank"
                rel="noreferrer"
              >
                {t("gedcom.exportAncestorsOfCsv", { name: personName })}
              </a>
              <a
                className="gedcom-export-item"
                href={csvExportUrl(treeId, personId, "descendants")}
                target="_blank"
                rel="noreferrer"
              >
                {t("gedcom.exportDescendantsOfCsv", { name: personName })}
              </a>
            </div>
          )}
          <p className="field-hint">{t("gedcom.exportHint")}</p>
          <p className="field-hint">
            <a href={csvTemplateUrl(treeId)} target="_blank" rel="noreferrer">
              {t("gedcom.csvTemplateLink")}
            </a>
          </p>
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
