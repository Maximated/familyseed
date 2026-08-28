import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  csvExportUrl,
  csvTemplateUrl,
  fetchTree,
  gedcomExportUrl,
  importCsv,
  importGedcom,
  type ImportResult,
  type Individual,
} from "./api";
import PersonPicker from "./PersonPicker";
import RelationshipWizard from "./RelationshipWizard";
import ExportImagePanel, { type ExportImageOptions } from "./ExportImagePanel";
import CsvGridImport from "./CsvGridImport";

type FileFormat = "ged" | "csv";

type Props = {
  treeId: string;
  initialPersonId?: string | null;
  initialPersonName?: string | null;
  onImported: () => void;
  onClose: () => void;
  // The tree-image export moved here from its own header popover (see
  // TreeView.tsx) — this component just renders the picker UI, the actual
  // capture logic stays in TreeView since it needs the live chart/canvas
  // refs. Optional: HomeScreen also renders this component (for importing
  // into a tree before ever opening its canvas), where there's no live
  // chart to export from — the image-export fieldset simply doesn't render
  // there.
  currentOrientation?: "vertical" | "horizontal";
  exportingImage?: boolean;
  onExportImage?: (options: ExportImageOptions) => void;
};

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function GedcomView({
  treeId,
  initialPersonId,
  initialPersonName,
  onImported,
  onClose,
  currentOrientation,
  exportingImage,
  onExportImage,
}: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [personId, setPersonId] = useState<string | null>(initialPersonId ?? null);
  const [personName, setPersonName] = useState<string | null>(initialPersonName ?? null);
  const [wizardIds, setWizardIds] = useState<string[] | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  // Shared by both import paths (file upload below and CsvGridImport) so
  // they can't drift apart — same success message, same "offer the
  // unrelated-people wizard" follow-up either way.
  async function handleImportResult(imported: ImportResult) {
    setResult(imported);
    onImported();
    // Only offer the wizard for people the import genuinely left without
    // any relationship — imported.individualIds is everyone the import
    // touched, most of whom are usually already correctly linked to each
    // other, so opening the wizard on the full list falsely claimed "N
    // personas sin relación" even for a perfectly-linked import.
    if (imported.individualIds.length > 0) {
      const { people } = await fetchTree(treeId);
      const importedIds = new Set(imported.individualIds);
      const unrelatedIds = people
        .filter(
          (p) =>
            importedIds.has(p.id) &&
            p.rels.parents.length === 0 &&
            p.rels.spouses.length === 0 &&
            p.rels.children.length === 0,
        )
        .map((p) => p.id);
      if (unrelatedIds.length > 0) setWizardIds(unrelatedIds);
    }
  }

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
      await handleImportResult(imported);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (wizardIds) {
    return (
      <RelationshipWizard
        treeId={treeId}
        personIds={wizardIds}
        onFinished={onImported}
        onClose={onClose}
      />
    );
  }

  if (showGrid) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel csv-grid-panel" onClick={(e) => e.stopPropagation()}>
          <h2>{t("csvGrid.title")}</h2>
          <CsvGridImport
            treeId={treeId}
            onBack={() => setShowGrid(false)}
            onImported={(imported) => {
              setShowGrid(false);
              handleImportResult(imported);
            }}
          />
        </div>
      </div>
    );
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
          <p className="field-hint">
            <button type="button" className="union-notes-edit-link" onClick={() => setShowGrid(true)}>
              {t("gedcom.openGridLink")}
            </button>
          </p>

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

        {currentOrientation && onExportImage && (
          <fieldset>
            <legend>{t("gedcom.exportImageHeading")}</legend>
            <ExportImagePanel currentOrientation={currentOrientation} exporting={Boolean(exportingImage)} onExport={onExportImage} />
          </fieldset>
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
