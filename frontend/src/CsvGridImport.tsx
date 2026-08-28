import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { importCsv, type ImportResult } from "./api";
import { Trash2Icon } from "./Icons";

// Same column set and order as the backend's own CSV_HEADERS (backend/src/
// csv.ts) — kept as a plain literal here rather than imported, since that
// file isn't part of the frontend build. Any drift between the two would
// only mean a grid column silently stops mapping to a real field, so keep
// this in sync if CSV_HEADERS ever changes.
const CSV_COLUMNS = [
  "id",
  "given_names",
  "surname1",
  "surname2",
  "surname1_birth_name",
  "alias",
  "sex",
  "birth_date",
  "birth_place",
  "death_date",
  "death_place",
  "notes",
  "biography",
  "father_id",
  "mother_id",
  "spouse_id",
  "union_type",
  "union_status",
  "union_date",
  "union_place",
  "union_notes",
] as const;

// Narrow columns for short codes/ids, wide ones for freeform text — plain
// px widths rather than a shared CSS class per column, since the mapping
// is 1:1 with this specific column list and not reused anywhere else.
const COLUMN_WIDTH: Record<(typeof CSV_COLUMNS)[number], number> = {
  id: 50,
  given_names: 130,
  surname1: 130,
  surname2: 130,
  surname1_birth_name: 140,
  alias: 90,
  sex: 70,
  birth_date: 110,
  birth_place: 130,
  death_date: 110,
  death_place: 130,
  notes: 180,
  biography: 200,
  father_id: 70,
  mother_id: 70,
  spouse_id: 80,
  union_type: 120,
  union_status: 120,
  union_date: 110,
  union_place: 130,
  union_notes: 160,
};

const INITIAL_ROWS = 6;

function makeBlankRow(id: string): string[] {
  const row = CSV_COLUMNS.map(() => "");
  row[0] = id;
  return row;
}

// Standard CSV quoting: only wrap a field in quotes (doubling any quotes
// inside it) when it actually contains something the comma-delimited
// format would otherwise misread.
function csvCell(value: string): string {
  if (/["\n,]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

type Props = {
  treeId: string;
  onImported: (result: ImportResult) => void;
  onBack: () => void;
};

// A hand-fillable alternative to uploading a CSV file (see GedcomView,
// which renders this instead of its own main content once opened) — types
// straight into an in-page grid instead of preparing a file externally
// first, then reuses importCsv as-is by building the exact same CSV text
// client-side. No new backend endpoint, no separate validation path: it
// goes through exactly the same parsing/import code a real file upload
// would.
export default function CsvGridImport({ treeId, onImported, onBack }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[][]>(() =>
    Array.from({ length: INITIAL_ROWS }, (_, i) => makeBlankRow(String(i + 1))),
  );
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keeps handing out fresh row ids even after rows in between are
  // deleted or a paste jumps several rows ahead — never reuses a number
  // that's already on screen, which matters since the id column is what
  // father_id/mother_id/spouse_id reference across rows.
  const nextRowNumber = useRef(INITIAL_ROWS + 1);

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    setRows((prev) => {
      const next = prev.map((r) => r.slice());
      next[rowIndex][colIndex] = value;
      return next;
    });
  }

  function addRow() {
    setRows((prev) => [...prev, makeBlankRow(String(nextRowNumber.current++))]);
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  // Pasting a block copied from a real spreadsheet (tab-separated cells,
  // newline-separated rows) fans it out across cells starting at the
  // focused one, growing the grid if the paste reaches past its last row
  // — a single-cell paste (no tab/newline) is left to the input's own
  // default behavior.
  function handlePaste(rowIndex: number, colIndex: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    setRows((prev) => {
      const next = prev.map((r) => r.slice());
      lines.forEach((line, rOffset) => {
        const targetRow = rowIndex + rOffset;
        while (next.length <= targetRow) next.push(makeBlankRow(String(nextRowNumber.current++)));
        line.split("\t").forEach((cellValue, cOffset) => {
          const targetCol = colIndex + cOffset;
          if (targetCol < CSV_COLUMNS.length) next[targetRow][targetCol] = cellValue;
        });
      });
      return next;
    });
  }

  async function handleImport() {
    const nonEmptyRows = rows.filter((row) => row.some((cell, i) => i > 0 && cell.trim() !== ""));
    if (nonEmptyRows.length === 0) {
      setError(t("csvGrid.emptyError"));
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const csvText = [CSV_COLUMNS.join(","), ...nonEmptyRows.map((row) => row.map(csvCell).join(","))].join("\n");
      const file = new File([csvText], "grid-import.csv", { type: "text/csv" });
      const result = await importCsv(treeId, file);
      onImported(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <p className="field-hint">{t("csvGrid.hint")}</p>
      <div className="csv-grid-wrap">
        <table className="csv-grid-table">
          <thead>
            <tr>
              <th className="csv-grid-row-handle" aria-hidden="true" />
              {CSV_COLUMNS.map((col) => (
                <th key={col} style={{ width: COLUMN_WIDTH[col] }} title={col}>
                  {t(`csvGrid.columns.${col}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="csv-grid-row-handle">
                  <button
                    type="button"
                    className="icon-button icon-button-danger"
                    onClick={() => removeRow(rowIndex)}
                    aria-label={t("csvGrid.removeRow")}
                    title={t("csvGrid.removeRow")}
                  >
                    <Trash2Icon size={14} />
                  </button>
                </td>
                {row.map((cell, colIndex) => (
                  <td key={colIndex}>
                    <input
                      type="text"
                      value={cell}
                      style={{ width: COLUMN_WIDTH[CSV_COLUMNS[colIndex]] }}
                      onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                      onPaste={(e) => handlePaste(rowIndex, colIndex, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="csv-grid-toolbar">
        <button type="button" className="union-notes-edit-link" onClick={addRow}>
          {t("csvGrid.addRow")}
        </button>
      </div>

      {error && <p className="status status-error">{error}</p>}

      <div className="modal-actions">
        <button type="button" onClick={onBack} disabled={importing}>
          {t("app.back")}
        </button>
        <button type="button" onClick={handleImport} disabled={importing}>
          {importing ? t("gedcom.importing") : t("csvGrid.import")}
        </button>
      </div>
    </>
  );
}
