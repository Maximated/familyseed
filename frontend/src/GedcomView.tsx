import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gedcomExportUrl, importGedcom } from "./api";

type Props = {
  currentPersonId: string | null;
  currentPersonName: string | null;
  onImported: () => void;
  onClose: () => void;
};

export default function GedcomView({ currentPersonId, currentPersonName, onImported, onClose }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ individuals: number; families: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".ged")) {
      setError(t("gedcom.importErrorType"));
      return;
    }
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const imported = await importGedcom(file);
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
          <input ref={fileInputRef} type="file" accept=".ged" onChange={handleInputChange} style={{ display: "none" }} />

          {result && (
            <p className="status">{t("gedcom.importSuccess", { individuals: result.individuals, families: result.families })}</p>
          )}
          {error && <p className="status status-error">{error}</p>}
        </fieldset>

        <fieldset>
          <legend>{t("gedcom.exportHeading")}</legend>
          <div className="gedcom-export-list">
            <a className="gedcom-export-item" href={gedcomExportUrl()} target="_blank" rel="noreferrer">
              {t("gedcom.exportFullTree")}
            </a>
            {currentPersonId && currentPersonName && (
              <>
                <a
                  className="gedcom-export-item"
                  href={gedcomExportUrl(currentPersonId, "ancestors")}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("gedcom.exportAncestorsOf", { name: currentPersonName })}
                </a>
                <a
                  className="gedcom-export-item"
                  href={gedcomExportUrl(currentPersonId, "descendants")}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("gedcom.exportDescendantsOf", { name: currentPersonName })}
                </a>
              </>
            )}
          </div>
          <p className="field-hint">{t("gedcom.exportHint")}</p>
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
