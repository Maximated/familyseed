import { parse as parseCsvSync } from "csv-parse/sync";
import { stringify as stringifyCsvSync } from "csv-stringify/sync";
import { prisma } from "./db.js";
import { deriveLineagesFromSurnames } from "./routes/individuals.js";

// ---------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------

type Sex = "MALE" | "FEMALE" | "UNKNOWN";
type DatePrecision = "EXACT" | "ABOUT" | "BEFORE" | "AFTER" | "UNKNOWN";
type UnionType = "MARRIAGE" | "PARTNERSHIP" | "EXTRAMARITAL" | "UNKNOWN";
type UnionStatus = "ONGOING" | "ENDED_BY_DEATH" | "DIVORCED" | "SEPARATED" | "ANNULLED";

// Our own simple format (not tied to any other genealogy tool) — one row
// per person, parent links expressed via a CSV-local `id` column rather
// than database ids, so a file can be filled in by hand in a spreadsheet
// before ever touching the app. Order matters for the downloadable
// template but not for import (columns are matched by header name).
//
// spouse_id + the union_* columns are how a couple gets recorded even
// with no children together (father_id/mother_id alone can only imply a
// relationship via a shared child) and how the union's own type/status/
// date/place/notes survive a round trip, which they never used to —
// only one of the two partners' rows needs to fill these in for a given
// pair (see importCsvIntoTree), and like father_id/mother_id, a person
// with more than one relationship can only have one of them represented
// here — same trade-off this format already makes for adoption.
export const CSV_HEADERS = [
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

export function csvTemplate(): string {
  const example1 = {
    id: "1",
    given_names: "Juana",
    surname1: "García",
    surname2: "López",
    surname1_birth_name: "",
    alias: "",
    sex: "F",
    birth_date: "1930-04-12",
    birth_place: "Sevilla",
    death_date: "~2005",
    death_place: "",
    notes: "",
    biography: "",
    father_id: "",
    mother_id: "",
    spouse_id: "3",
    union_type: "MARRIAGE",
    union_status: "ENDED_BY_DEATH",
    union_date: "1952-06-10",
    union_place: "Sevilla",
    union_notes: "",
  };
  const example2 = {
    id: "2",
    given_names: "Pedro",
    surname1: "García",
    surname2: "",
    surname1_birth_name: "",
    alias: "",
    sex: "M",
    birth_date: "1955-09-01",
    birth_place: "",
    death_date: "",
    death_place: "",
    notes: "",
    biography: "",
    father_id: "",
    mother_id: "1",
    spouse_id: "",
    union_type: "",
    union_status: "",
    union_date: "",
    union_place: "",
    union_notes: "",
  };
  // Demonstrates a couple with no children together — the only way to
  // record that a relationship exists at all without spouse_id, since
  // father_id/mother_id can only ever be inferred from a shared child.
  const example3 = {
    id: "3",
    given_names: "Antonio",
    surname1: "Ruiz",
    surname2: "",
    surname1_birth_name: "",
    alias: "",
    sex: "M",
    birth_date: "1928-01-20",
    birth_place: "",
    death_date: "",
    death_place: "",
    notes: "",
    biography: "",
    father_id: "",
    mother_id: "",
    spouse_id: "",
    union_type: "",
    union_status: "",
    union_date: "",
    union_place: "",
    union_notes: "",
  };
  return stringifyCsvSync([example1, example2, example3], { header: true, columns: CSV_HEADERS as unknown as string[] });
}

// ---------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------

function normalizeSex(raw: string | undefined): Sex {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "M" || v === "MALE" || v === "H" || v === "HOMBRE") return "MALE";
  if (v === "F" || v === "FEMALE" || v === "MUJER") return "FEMALE";
  return "UNKNOWN";
}

// Accepts the enum's own value or a plain Spanish word — same spirit as
// normalizeSex, since a hand-filled spreadsheet is more likely to have
// "Matrimonio" in it than "MARRIAGE". Falls back to the schema's own
// default (UNKNOWN/ONGOING) for anything blank or unrecognized, same as
// leaving a Family's union fields untouched at creation would.
function normalizeUnionType(raw: string | undefined): UnionType {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "MARRIAGE" || v === "MATRIMONIO") return "MARRIAGE";
  if (v === "PARTNERSHIP" || v === "PAREJA DE HECHO" || v === "PAREJA") return "PARTNERSHIP";
  if (v === "EXTRAMARITAL" || v === "RELACION EXTRAMATRIMONIAL" || v === "RELACIÓN EXTRAMATRIMONIAL") return "EXTRAMARITAL";
  return "UNKNOWN";
}

function normalizeUnionStatus(raw: string | undefined): UnionStatus {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "ENDED_BY_DEATH" || v === "VIUDEZ" || v === "FALLECIMIENTO") return "ENDED_BY_DEATH";
  if (v === "DIVORCED" || v === "DIVORCIO") return "DIVORCED";
  if (v === "SEPARATED" || v === "SEPARACION" || v === "SEPARACIÓN") return "SEPARATED";
  if (v === "ANNULLED" || v === "ANULADO" || v === "ANULACION" || v === "ANULACIÓN") return "ANNULLED";
  return "ONGOING";
}

// Accepts ISO (YYYY-MM-DD), Spanish-style DD/MM/YYYY, or a bare year, with
// an optional "~" (about), "<" (before), ">" (after) prefix — same
// precision axis as GEDCOM's ABT/BEF/AFT, spelled with symbols since
// there's no fixed-width field grammar to lean on in a CSV.
function parseCsvDate(raw: string | undefined): { text: string | undefined; value: Date | undefined; precision: DatePrecision | undefined } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { text: undefined, value: undefined, precision: undefined };

  let precision: DatePrecision = "EXACT";
  let rest = trimmed;
  if (rest.startsWith("~")) {
    precision = "ABOUT";
    rest = rest.slice(1).trim();
  } else if (rest.startsWith("<")) {
    precision = "BEFORE";
    rest = rest.slice(1).trim();
  } else if (rest.startsWith(">")) {
    precision = "AFTER";
    rest = rest.slice(1).trim();
  }

  let value: Date | undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rest);
  const spanish = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rest);
  const yearOnly = /^\d{4}$/.exec(rest);
  if (iso) {
    value = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  } else if (spanish) {
    value = new Date(Date.UTC(Number(spanish[3]), Number(spanish[2]) - 1, Number(spanish[1])));
  } else if (yearOnly) {
    value = new Date(Date.UTC(Number(rest), 0, 1));
  }

  if (!value) precision = "UNKNOWN";
  return { text: trimmed, value, precision };
}

type CsvRow = Record<string, string | undefined>;

export type ParsedCsvIndividual = {
  csvId: string | null;
  givenNames: string;
  surname1: string;
  surname2: string | null;
  surname1BirthName: string | null;
  alias: string | null;
  sex: Sex;
  birthDateText: string | null;
  birthDateValue: Date | null;
  birthDatePrecision: DatePrecision | null;
  birthPlace: string | null;
  deathDateText: string | null;
  deathDateValue: Date | null;
  deathDatePrecision: DatePrecision | null;
  deathPlace: string | null;
  notes: string | null;
  biography: string | null;
  fatherCsvId: string | null;
  motherCsvId: string | null;
  spouseCsvId: string | null;
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionDateValue: Date | null;
  unionDatePrecision: DatePrecision | null;
  unionPlace: string | null;
  unionNotes: string | null;
};

function blankToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export function parseCsvFile(text: string): ParsedCsvIndividual[] {
  let rows: CsvRow[];
  try {
    rows = parseCsvSync(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      // Numbers/Excel export CSV with ";" instead of "," under several
      // European locales (comma is the decimal separator there) — auto-
      // detecting among the common candidates avoids every field ending up
      // concatenated into one when someone re-saves our own template.
      delimiter: [",", ";", "\t"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "formato inválido";
    throw new Error(`No se pudo interpretar el CSV: ${message}`);
  }

  if (rows.length === 0) {
    throw new Error("El archivo CSV no contiene ninguna fila de datos");
  }

  const seenIds = new Set<string>();
  const individuals: ParsedCsvIndividual[] = rows.map((row, index) => {
    const givenNames = blankToNull(row.given_names);
    const surname1 = blankToNull(row.surname1);
    if (!givenNames && !surname1) {
      throw new Error(`Fila ${index + 2}: falta "given_names" o "surname1"`);
    }

    const csvId = blankToNull(row.id);
    if (csvId) {
      if (seenIds.has(csvId)) {
        throw new Error(`Fila ${index + 2}: el id "${csvId}" está repetido en el archivo`);
      }
      seenIds.add(csvId);
    }

    const birth = parseCsvDate(row.birth_date);
    const death = parseCsvDate(row.death_date);
    const union = parseCsvDate(row.union_date);

    return {
      csvId,
      givenNames: givenNames ?? "(sin nombre)",
      surname1: surname1 ?? "(sin apellido)",
      surname2: blankToNull(row.surname2),
      surname1BirthName: blankToNull(row.surname1_birth_name),
      alias: blankToNull(row.alias),
      sex: normalizeSex(row.sex),
      birthDateText: birth.text ?? null,
      birthDateValue: birth.value ?? null,
      birthDatePrecision: birth.precision ?? null,
      birthPlace: blankToNull(row.birth_place),
      deathDateText: death.text ?? null,
      deathDateValue: death.value ?? null,
      deathDatePrecision: death.precision ?? null,
      deathPlace: blankToNull(row.death_place),
      notes: blankToNull(row.notes),
      biography: blankToNull(row.biography),
      fatherCsvId: blankToNull(row.father_id),
      motherCsvId: blankToNull(row.mother_id),
      spouseCsvId: blankToNull(row.spouse_id),
      unionType: normalizeUnionType(row.union_type),
      unionStatus: normalizeUnionStatus(row.union_status),
      unionDateText: union.text ?? null,
      unionDateValue: union.value ?? null,
      unionDatePrecision: union.precision ?? null,
      unionPlace: blankToNull(row.union_place),
      unionNotes: blankToNull(row.union_notes),
    };
  });

  for (const ind of individuals) {
    if (ind.fatherCsvId && !seenIds.has(ind.fatherCsvId)) {
      throw new Error(`father_id "${ind.fatherCsvId}" no corresponde a ningún id de este archivo`);
    }
    if (ind.motherCsvId && !seenIds.has(ind.motherCsvId)) {
      throw new Error(`mother_id "${ind.motherCsvId}" no corresponde a ningún id de este archivo`);
    }
    if (ind.spouseCsvId && !seenIds.has(ind.spouseCsvId)) {
      throw new Error(`spouse_id "${ind.spouseCsvId}" no corresponde a ningún id de este archivo`);
    }
    if (ind.spouseCsvId && ind.csvId === ind.spouseCsvId) {
      throw new Error(`Fila con id "${ind.csvId}": spouse_id no puede apuntar a la misma persona`);
    }
  }

  return individuals;
}

// Creates individuals (and the families implied by father_id/mother_id
// pairs) in one tree. Rows that carry a CSV `id` are upserted by a
// synthetic gedcom_xref ("csv:<id>") so re-importing an edited copy of the
// same file updates existing rows instead of duplicating them — the same
// idempotency GEDCOM import already gets from its own xrefs. Rows with no
// `id` are always created fresh, since there's nothing stable to key on.
export async function importCsvIntoTree(
  treeId: string,
  text: string,
): Promise<{ individuals: number; families: number; individualIds: string[] }> {
  const parsed = parseCsvFile(text);

  return prisma.$transaction(
    async (tx) => {
      const csvIdToDbId = new Map<string, string>();
      const individualIds: string[] = [];

      for (const ind of parsed) {
        const xref = ind.csvId ? `csv:${ind.csvId}` : null;
        const data = {
          givenNames: ind.givenNames,
          surname1: ind.surname1,
          surname2: ind.surname2,
          surname1BirthName: ind.surname1BirthName,
          alias: ind.alias,
          sex: ind.sex,
          birthDateText: ind.birthDateText,
          birthDateValue: ind.birthDateValue,
          birthDatePrecision: ind.birthDatePrecision,
          birthPlace: ind.birthPlace,
          deathDateText: ind.deathDateText,
          deathDateValue: ind.deathDateValue,
          deathDatePrecision: ind.deathDatePrecision,
          deathPlace: ind.deathPlace,
          notes: ind.notes,
          biography: ind.biography,
        };

        const row = xref
          ? await tx.individual.upsert({
              where: { treeId_gedcomXref: { treeId, gedcomXref: xref } },
              create: { treeId, gedcomXref: xref, ...data },
              update: data,
            })
          : await tx.individual.create({ data: { treeId, ...data } });

        if (ind.csvId) csvIdToDbId.set(ind.csvId, row.id);
        individualIds.push(row.id);

        // Same auto-derivation a manual create/edit gets — otherwise a
        // bulk import silently skips the "ramas" (lineages) every other
        // way of adding a person already builds up automatically.
        await deriveLineagesFromSurnames(tx, treeId, row.id, [ind.surname1, ind.surname1BirthName]);
      }

      // Group children by (father, mother) pair so siblings share one
      // Family row instead of getting one each.
      const familyKeyToChildren = new Map<string, { partner1Id: string | null; partner2Id: string | null; childIds: string[] }>();
      for (const ind of parsed) {
        if (!ind.fatherCsvId && !ind.motherCsvId) continue;
        const partner1Id = ind.fatherCsvId ? (csvIdToDbId.get(ind.fatherCsvId) ?? null) : null;
        const partner2Id = ind.motherCsvId ? (csvIdToDbId.get(ind.motherCsvId) ?? null) : null;
        const childId = ind.csvId ? csvIdToDbId.get(ind.csvId) : undefined;
        if (!childId) continue;

        const key = `${partner1Id ?? ""}|${partner2Id ?? ""}`;
        const entry = familyKeyToChildren.get(key) ?? { partner1Id, partner2Id, childIds: [] };
        entry.childIds.push(childId);
        familyKeyToChildren.set(key, entry);
      }

      let familiesWritten = 0;
      for (const { partner1Id, partner2Id, childIds } of familyKeyToChildren.values()) {
        let family = await tx.family.findFirst({ where: { treeId, partner1Id, partner2Id } });
        if (!family) {
          family = await tx.family.create({ data: { treeId, partner1Id, partner2Id } });
        }
        familiesWritten++;
        for (const childId of childIds) {
          await tx.familyChild.upsert({
            where: { familyId_individualId: { familyId: family.id, individualId: childId } },
            create: { familyId: family.id, individualId: childId, relationType: "BIOLOGICAL" },
            update: {},
          });
        }
      }

      // Explicit couples, via spouse_id — the only way a childless pair
      // ever gets a Family row at all, and the only current source of
      // real union_type/status/date/place/notes (father_id/mother_id
      // alone never carried any of that). Only one row per pair needs to
      // declare it; `pairKey` skips the second row once the first's
      // already been processed, rather than re-processing (and
      // potentially conflicting with) the same union twice.
      const processedPairs = new Set<string>();
      for (const ind of parsed) {
        if (!ind.spouseCsvId || !ind.csvId) continue;
        const selfId = csvIdToDbId.get(ind.csvId);
        const spouseId = csvIdToDbId.get(ind.spouseCsvId);
        if (!selfId || !spouseId) continue;

        const pairKey = [selfId, spouseId].sort().join("|");
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const unionData = {
          unionType: ind.unionType,
          unionStatus: ind.unionStatus,
          unionDateText: ind.unionDateText,
          unionDateValue: ind.unionDateValue,
          unionDatePrecision: ind.unionDatePrecision,
          unionPlace: ind.unionPlace,
          notes: ind.unionNotes,
        };

        const existing = await tx.family.findFirst({
          where: {
            treeId,
            OR: [
              { partner1Id: selfId, partner2Id: spouseId },
              { partner1Id: spouseId, partner2Id: selfId },
            ],
          },
        });
        if (existing) {
          await tx.family.update({ where: { id: existing.id }, data: unionData });
        } else {
          await tx.family.create({ data: { treeId, partner1Id: selfId, partner2Id: spouseId, ...unionData } });
          familiesWritten++;
        }
      }

      return { individuals: parsed.length, families: familiesWritten, individualIds };
    },
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

export type ExportCsvIndividual = {
  id: string;
  givenNames: string;
  surname1: string;
  surname2: string | null;
  surname1BirthName: string | null;
  alias: string | null;
  sex: Sex;
  birthDateText: string | null;
  birthPlace: string | null;
  deathDateText: string | null;
  deathPlace: string | null;
  notes: string | null;
  biography: string | null;
};

export type ExportCsvFamily = {
  partner1Id: string | null;
  partner2Id: string | null;
  childIds: string[];
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionPlace: string | null;
  notes: string | null;
};

// One row per person, using the real database id as the CSV `id` — good
// enough for a round trip back into this same app (or another FamilySeed
// tree), though a person who's a child in more than one family (e.g.
// adopted) only gets one father_id/mother_id pair here, and likewise a
// person in more than one union only gets one spouse_id/union_* set —
// GEDCOM export preserves the full relationship model; this format
// trades that for being editable by hand in a spreadsheet.
export function serializeCsv(individuals: ExportCsvIndividual[], families: ExportCsvFamily[]): string {
  const parentsByChild = new Map<string, { fatherId: string | null; motherId: string | null }>();
  for (const fam of families) {
    for (const childId of fam.childIds) {
      if (parentsByChild.has(childId)) continue;
      parentsByChild.set(childId, { fatherId: fam.partner1Id, motherId: fam.partner2Id });
    }
  }

  // Emitted on partner1's row (falling back to partner2's if partner1
  // isn't in this export, e.g. an ancestors-only slice) so each union
  // appears exactly once instead of redundantly on both partners' rows.
  const unionByPersonId = new Map<
    string,
    { spouseId: string; unionType: UnionType; unionStatus: UnionStatus; unionDateText: string | null; unionPlace: string | null; notes: string | null }
  >();
  for (const fam of families) {
    if (!fam.partner1Id || !fam.partner2Id) continue;
    const unionInfo = {
      unionType: fam.unionType,
      unionStatus: fam.unionStatus,
      unionDateText: fam.unionDateText,
      unionPlace: fam.unionPlace,
      notes: fam.notes,
    };
    if (!unionByPersonId.has(fam.partner1Id)) {
      unionByPersonId.set(fam.partner1Id, { spouseId: fam.partner2Id, ...unionInfo });
    } else if (!unionByPersonId.has(fam.partner2Id)) {
      unionByPersonId.set(fam.partner2Id, { spouseId: fam.partner1Id, ...unionInfo });
    }
    // else: both partners' one spouse_id slot is already taken by a
    // different union of theirs — can't be represented in this export,
    // same documented limitation as father_id/mother_id above.
  }

  const rows = individuals.map((ind) => {
    const parents = parentsByChild.get(ind.id);
    const union = unionByPersonId.get(ind.id);
    return {
      id: ind.id,
      given_names: ind.givenNames,
      surname1: ind.surname1,
      surname2: ind.surname2 ?? "",
      surname1_birth_name: ind.surname1BirthName ?? "",
      alias: ind.alias ?? "",
      sex: ind.sex === "MALE" ? "M" : ind.sex === "FEMALE" ? "F" : "",
      birth_date: ind.birthDateText ?? "",
      birth_place: ind.birthPlace ?? "",
      death_date: ind.deathDateText ?? "",
      death_place: ind.deathPlace ?? "",
      notes: ind.notes ?? "",
      biography: ind.biography ?? "",
      father_id: parents?.fatherId ?? "",
      mother_id: parents?.motherId ?? "",
      spouse_id: union?.spouseId ?? "",
      union_type: union?.unionType ?? "",
      union_status: union?.unionStatus ?? "",
      union_date: union?.unionDateText ?? "",
      union_place: union?.unionPlace ?? "",
      union_notes: union?.notes ?? "",
    };
  });

  return stringifyCsvSync(rows, { header: true, columns: CSV_HEADERS as unknown as string[] });
}
