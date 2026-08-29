import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { importCsv, type ImportResult, type Individual } from "./api";
import { SearchIcon, Trash2Icon } from "./Icons";
import PersonPicker from "./PersonPicker";

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

type Column = (typeof CSV_COLUMNS)[number];

// Narrow columns for short codes/ids, wide ones for freeform text — plain
// px widths rather than a shared CSS class per column, since the mapping
// is 1:1 with this specific column list and not reused anywhere else.
const COLUMN_WIDTH: Record<Column, number> = {
  id: 50,
  given_names: 130,
  surname1: 130,
  surname2: 130,
  surname1_birth_name: 140,
  alias: 90,
  sex: 90,
  birth_date: 130,
  birth_place: 130,
  death_date: 130,
  death_place: 130,
  notes: 180,
  biography: 200,
  father_id: 110,
  mother_id: 110,
  spouse_id: 110,
  union_type: 140,
  union_status: 150,
  union_date: 130,
  union_place: 130,
  union_notes: 160,
};

const DATE_COLUMNS = new Set<Column>(["birth_date", "death_date", "union_date"]);
const ID_REF_COLUMNS = new Set<Column>(["father_id", "mother_id", "spouse_id"]);

const INITIAL_ROWS = 6;

function makeBlankRow(id: string): string[] {
  const row = CSV_COLUMNS.map(() => "");
  row[0] = id;
  return row;
}

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
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
  // Which father_id/mother_id/spouse_id cell (if any) has its "pick a
  // person" dialog open.
  const [pickerTarget, setPickerTarget] = useState<{ rowIndex: number; colIndex: number } | null>(null);
  // A raw id value (whatever's actually sitting in the cell) -> the real
  // person's name, filled in only when that value came from picking an
  // existing tree member below — this is what turns an otherwise-opaque
  // database id back into something readable in the grid. A plain
  // same-grid row reference (a small typed number) never gets an entry
  // here, which is fine: the row itself is right there on screen already.
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  const sexOptions = [
    { value: "", label: t("csvGrid.blankOption") },
    { value: "M", label: t("personFields.sexMale") },
    { value: "F", label: t("personFields.sexFemale") },
  ];
  const unionTypeOptions = [
    { value: "", label: t("csvGrid.blankOption") },
    { value: "MARRIAGE", label: t("unionType.MARRIAGE") },
    { value: "PARTNERSHIP", label: t("unionType.PARTNERSHIP") },
    { value: "EXTRAMARITAL", label: t("unionType.EXTRAMARITAL") },
  ];
  const unionStatusOptions = [
    { value: "", label: t("csvGrid.blankOption") },
    { value: "ENDED_BY_DEATH", label: t("unionStatus.ENDED_BY_DEATH") },
    { value: "DIVORCED", label: t("unionStatus.DIVORCED") },
    { value: "SEPARATED", label: t("unionStatus.SEPARATED") },
    { value: "ANNULLED", label: t("unionStatus.ANNULLED") },
  ];
  const SELECT_OPTIONS: Partial<Record<Column, { value: string; label: string }[]>> = {
    sex: sexOptions,
    union_type: unionTypeOptions,
    union_status: unionStatusOptions,
  };

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
                {row.map((cell, colIndex) => {
                  const col = CSV_COLUMNS[colIndex];
                  const width = COLUMN_WIDTH[col];

                  if (ID_REF_COLUMNS.has(col)) {
                    const resolved = cell.trim() ? resolvedNames[cell.trim()] : undefined;
                    return (
                      <td key={colIndex}>
                        <div className="csv-grid-idref" style={{ width }}>
                          <input
                            type="text"
                            value={cell}
                            onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                            onPaste={(e) => handlePaste(rowIndex, colIndex, e)}
                          />
                          <button
                            type="button"
                            className="csv-grid-idref-pick"
                            onClick={() => setPickerTarget({ rowIndex, colIndex })}
                            aria-label={t("csvGrid.pickPerson")}
                            title={t("csvGrid.pickPerson")}
                          >
                            <SearchIcon size={13} />
                          </button>
                        </div>
                        {resolved && <div className="csv-grid-idref-hint">→ {resolved}</div>}
                      </td>
                    );
                  }

                  const options = SELECT_OPTIONS[col];
                  if (options) {
                    return (
                      <td key={colIndex}>
                        <select
                          value={cell}
                          style={{ width }}
                          onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                        >
                          {options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  }

                  return (
                    <td key={colIndex}>
                      <input
                        type="text"
                        value={cell}
                        style={{ width }}
                        placeholder={DATE_COLUMNS.has(col) ? t("csvGrid.datePlaceholder") : undefined}
                        title={DATE_COLUMNS.has(col) ? t("csvGrid.dateHint") : undefined}
                        onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                        onPaste={(e) => handlePaste(rowIndex, colIndex, e)}
                      />
                    </td>
                  );
                })}
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

      {pickerTarget && (
        <div className="modal-backdrop" onClick={() => setPickerTarget(null)}>
          <div className="modal-panel csv-grid-picker-panel" onClick={(e) => e.stopPropagation()}>
            <h3>{t(`csvGrid.columns.${CSV_COLUMNS[pickerTarget.colIndex]}`)}</h3>

            <p className="field-hint">{t("csvGrid.pickExistingHint")}</p>
            <PersonPicker
              treeId={treeId}
              selectedName={null}
              onSelect={(person) => {
                updateCell(pickerTarget.rowIndex, pickerTarget.colIndex, person.id);
                setResolvedNames((prev) => ({ ...prev, [person.id]: personLabel(person) }));
                setPickerTarget(null);
              }}
            />

            <p className="field-hint">{t("csvGrid.pickRowHint")}</p>
            <ul className="csv-grid-picker-rows">
              {rows.map((row, i) => {
                if (i === pickerTarget.rowIndex) return null;
                const rowId = row[0].trim();
                if (!rowId) return null;
                const name = `${row[1]} ${row[2]}`.trim();
                return (
                  <li key={i}>
                    <button
                      type="button"
                      className="union-notes-edit-link"
                      onClick={() => {
                        updateCell(pickerTarget.rowIndex, pickerTarget.colIndex, rowId);
                        setPickerTarget(null);
                      }}
                    >
                      {name || t("csvGrid.unnamedRow", { n: i + 1 })}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="modal-actions">
              <button type="button" onClick={() => setPickerTarget(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
