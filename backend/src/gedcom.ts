import { parse } from "parse-gedcom";
import { prisma } from "./db.js";
import { deriveLineagesFromSurnames } from "./routes/individuals.js";

// ---------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------

type Sex = "MALE" | "FEMALE" | "UNKNOWN";
type DatePrecision = "EXACT" | "ABOUT" | "BEFORE" | "AFTER" | "UNKNOWN";
type UnionType = "MARRIAGE" | "PARTNERSHIP" | "EXTRAMARITAL" | "UNKNOWN";
type UnionStatus = "ONGOING" | "ENDED_BY_DEATH" | "DIVORCED" | "SEPARATED" | "ANNULLED";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_INDEX = new Map(MONTHS.map((m, i) => [m, i]));

function escapeGedcomLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function gedcomDate(value: Date | null | undefined, precision: DatePrecision | null | undefined, text: string | null | undefined): string | null {
  if (value) {
    const prefix = precision === "ABOUT" ? "ABT " : precision === "BEFORE" ? "BEF " : precision === "AFTER" ? "AFT " : "";
    const day = value.getUTCDate();
    const month = MONTHS[value.getUTCMonth()];
    const year = value.getUTCFullYear();
    return `${prefix}${day} ${month} ${year}`;
  }
  // No structured value — most individuals/unions added by hand only ever
  // get the free-text field filled in (birthDateValue stays null). GEDCOM's
  // grammar requires freeform text in a DATE line to be a "date phrase"
  // wrapped in parens, not a bare value.
  if (text) return `(${escapeGedcomLine(text)})`;
  return null;
}

function noteLines(level: number, tag: string, text: string): string[] {
  const [first, ...rest] = text.split(/\r\n|\r|\n/);
  const lines = [`${level} ${tag} ${escapeGedcomLine(first)}`];
  for (const line of rest) lines.push(`${level + 1} CONT ${escapeGedcomLine(line)}`);
  return lines;
}

// The reverse of noteLines — reassembles a NOTE's own value plus any
// CONT (new line) / CONC (same line, no separator) continuation children
// back into the original multi-line text.
function readNote(node: GedNode | undefined): string | null {
  const note = findChild(node, "NOTE");
  if (!note) return null;
  let text = note.value ?? "";
  for (const child of note.children) {
    if (child.type === "CONT") text += "\n" + (child.value ?? "");
    else if (child.type === "CONC") text += child.value ?? "";
  }
  const trimmed = text.trim();
  return trimmed || null;
}

// ---------------------------------------------------------------------
// Export: our data model -> GEDCOM 5.5.1 text
// ---------------------------------------------------------------------

export type ExportIndividual = {
  id: string;
  givenNames: string;
  surname1: string;
  surname2: string | null;
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
};

export type ExportFamily = {
  id: string;
  partner1Id: string | null;
  partner2Id: string | null;
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionDateValue: Date | null;
  unionDatePrecision: DatePrecision | null;
  unionPlace: string | null;
  notes: string | null;
  childIds: string[];
};

// Xrefs are regenerated fresh on every export (@I1@, @F1@, ...) rather than
// reusing a stored gedcomXref — a GEDCOM file only needs internally
// consistent pointers, not ones stable across exports, and this sidesteps
// having to dedupe/reserve old xrefs against newly assigned ones.
export function serializeGedcom(individuals: ExportIndividual[], families: ExportFamily[]): string {
  const individualXref = new Map(individuals.map((ind, i) => [ind.id, `I${i + 1}`]));
  const familyXref = new Map(families.map((fam, i) => [fam.id, `F${i + 1}`]));
  const individualsById = new Map(individuals.map((ind) => [ind.id, ind]));

  const famsByIndividual = new Map<string, string[]>();
  const famcByIndividual = new Map<string, string[]>();
  for (const family of families) {
    const xref = familyXref.get(family.id)!;
    for (const partnerId of [family.partner1Id, family.partner2Id]) {
      if (!partnerId) continue;
      if (!famsByIndividual.has(partnerId)) famsByIndividual.set(partnerId, []);
      famsByIndividual.get(partnerId)!.push(xref);
    }
    for (const childId of family.childIds) {
      if (!famcByIndividual.has(childId)) famcByIndividual.set(childId, []);
      famcByIndividual.get(childId)!.push(xref);
    }
  }

  const lines: string[] = ["0 HEAD", "1 SOUR FamilySeed", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8"];

  for (const individual of individuals) {
    const xref = individualXref.get(individual.id)!;
    lines.push(`0 @${xref}@ INDI`);

    const surname = [individual.surname1, individual.surname2].filter(Boolean).join(" ");
    lines.push(`1 NAME ${escapeGedcomLine(individual.givenNames)} /${escapeGedcomLine(surname)}/`);
    if (individual.givenNames) lines.push(`2 GIVN ${escapeGedcomLine(individual.givenNames)}`);
    if (surname) lines.push(`2 SURN ${escapeGedcomLine(surname)}`);
    if (individual.alias) lines.push(`2 NICK ${escapeGedcomLine(individual.alias)}`);

    lines.push(`1 SEX ${individual.sex === "MALE" ? "M" : individual.sex === "FEMALE" ? "F" : "U"}`);

    const birthDate = gedcomDate(individual.birthDateValue, individual.birthDatePrecision, individual.birthDateText);
    if (birthDate || individual.birthPlace) {
      lines.push("1 BIRT");
      if (birthDate) lines.push(`2 DATE ${birthDate}`);
      if (individual.birthPlace) lines.push(`2 PLAC ${escapeGedcomLine(individual.birthPlace)}`);
    }

    const deathDate = gedcomDate(individual.deathDateValue, individual.deathDatePrecision, individual.deathDateText);
    if (deathDate || individual.deathPlace) {
      lines.push("1 DEAT");
      if (deathDate) lines.push(`2 DATE ${deathDate}`);
      if (individual.deathPlace) lines.push(`2 PLAC ${escapeGedcomLine(individual.deathPlace)}`);
    }

    for (const famXref of famcByIndividual.get(individual.id) ?? []) lines.push(`1 FAMC @${famXref}@`);
    for (const famXref of famsByIndividual.get(individual.id) ?? []) lines.push(`1 FAMS @${famXref}@`);

    if (individual.biography) lines.push(...noteLines(1, "NOTE", individual.biography));
    if (individual.notes) lines.push(...noteLines(1, "NOTE", individual.notes));
  }

  for (const family of families) {
    const xref = familyXref.get(family.id)!;
    lines.push(`0 @${xref}@ FAM`);

    const partner1 = family.partner1Id ? individualsById.get(family.partner1Id) : undefined;
    const partner2 = family.partner2Id ? individualsById.get(family.partner2Id) : undefined;
    // Our schema doesn't gender-lock partner1/partner2 — GEDCOM's HUSB/WIFE
    // do, so pick by sex where known and fall back to partner1->HUSB.
    const wifeFirst = partner1?.sex === "FEMALE" && partner2?.sex !== "FEMALE";
    const husband = wifeFirst ? partner2 : partner1;
    const wife = wifeFirst ? partner1 : partner2;

    if (husband) lines.push(`1 HUSB @${individualXref.get(husband.id)}@`);
    if (wife) lines.push(`1 WIFE @${individualXref.get(wife.id)}@`);

    const unionDate = gedcomDate(family.unionDateValue, family.unionDatePrecision, family.unionDateText);
    if (family.unionType === "MARRIAGE" || unionDate || family.unionPlace) {
      lines.push("1 MARR");
      if (unionDate) lines.push(`2 DATE ${unionDate}`);
      if (family.unionPlace) lines.push(`2 PLAC ${escapeGedcomLine(family.unionPlace)}`);
    }
    if (family.unionStatus === "DIVORCED" || family.unionStatus === "SEPARATED") lines.push("1 DIV");
    if (family.unionStatus === "ANNULLED") lines.push("1 ANUL");
    if (family.notes) lines.push(...noteLines(1, "NOTE", family.notes));

    for (const childId of family.childIds) {
      const childXref = individualXref.get(childId);
      if (childXref) lines.push(`1 CHIL @${childXref}@`);
    }
  }

  lines.push("0 TRLR");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------
// Import: GEDCOM text -> our data model
// ---------------------------------------------------------------------

type GedNode = {
  type: string;
  data?: { xref_id?: string; pointer?: string; formal_name?: string };
  value?: string;
  children: GedNode[];
};

function findChild(node: GedNode | undefined, type: string): GedNode | undefined {
  return node?.children.find((c) => c.type === type);
}

function findChildren(node: GedNode | undefined, type: string): GedNode[] {
  return node?.children.filter((c) => c.type === type) ?? [];
}

function stripXref(xref: string | undefined): string | null {
  if (!xref) return null;
  return xref.replace(/^@/, "").replace(/@$/, "");
}

// Handles the common GEDCOM date shapes: "12 MAR 1925", "MAR 1925", "1925",
// and the ABT/EST/CAL/BEF/AFT/BET qualifiers. Anything it can't confidently
// parse is still kept verbatim as the free-text value — display never loses
// information even when the structured date does.
function parseGedcomDate(raw: string | undefined): { text: string | undefined; value: Date | undefined; precision: DatePrecision | undefined } {
  if (!raw) return { text: undefined, value: undefined, precision: undefined };
  const trimmed = raw.trim();

  // A parenthesized "date phrase" is deliberately freeform (see
  // gedcomDate's export side) — keep it as text only, no structured value.
  const phraseMatch = trimmed.match(/^\((.*)\)$/);
  if (phraseMatch) return { text: phraseMatch[1].trim(), value: undefined, precision: undefined };

  const text = trimmed;
  let precision: DatePrecision = "EXACT";
  let rest = text;

  const qualifierMatch = rest.match(/^(ABT|EST|CAL|BEF|AFT|BET)\.?\s+/i);
  if (qualifierMatch) {
    const q = qualifierMatch[1].toUpperCase();
    precision = q === "BEF" ? "BEFORE" : q === "AFT" ? "AFTER" : "ABOUT";
    rest = rest.slice(qualifierMatch[0].length);
    // "BET 1920 AND 1925" — keep the first bound, treat as approximate.
    rest = rest.replace(/\s+AND\s+.*$/i, "");
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (MONTH_INDEX.has(upper)) {
      month = MONTH_INDEX.get(upper);
    } else if (/^\d{1,2}$/.test(token)) {
      day = Number(token);
    } else if (/^\d{3,4}$/.test(token)) {
      year = Number(token);
    }
  }

  if (year === undefined) return { text, value: undefined, precision: undefined };
  const value = new Date(Date.UTC(year, month ?? 0, day ?? 1));
  return { text, value, precision };
}

function parseName(nameNode: GedNode | undefined): { givenNames: string; surname1: string; alias: string | null } {
  const alias = findChild(nameNode, "NICK")?.value?.trim() || null;
  const givn = findChild(nameNode, "GIVN")?.value?.trim();
  const surn = findChild(nameNode, "SURN")?.value?.trim();
  if (givn || surn) return { givenNames: givn ?? "", surname1: surn ?? "", alias };

  const raw = nameNode?.value ?? "";
  const match = raw.match(/^([^/]*)\/([^/]*)\/?/);
  if (match) return { givenNames: match[1].trim(), surname1: match[2].trim(), alias };
  return { givenNames: raw.trim(), surname1: "", alias };
}

export type ParsedIndividual = {
  xref: string;
  givenNames: string;
  surname1: string;
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
};

export type ParsedFamily = {
  xref: string;
  husbandXref: string | null;
  wifeXref: string | null;
  childXrefs: string[];
  unionType: UnionType;
  unionStatus: UnionStatus;
  unionDateText: string | null;
  unionDateValue: Date | null;
  unionDatePrecision: DatePrecision | null;
  unionPlace: string | null;
  notes: string | null;
};

export function parseGedcomFile(text: string): { individuals: ParsedIndividual[]; families: ParsedFamily[] } {
  const ast = parse(text) as GedNode;

  const individuals: ParsedIndividual[] = [];
  for (const node of ast.children.filter((c) => c.type === "INDI")) {
    const xref = stripXref(node.data?.xref_id);
    if (!xref) continue;

    const { givenNames, surname1, alias } = parseName(findChild(node, "NAME"));
    const sexValue = findChild(node, "SEX")?.value?.trim().toUpperCase();
    const sex: Sex = sexValue === "M" ? "MALE" : sexValue === "F" ? "FEMALE" : "UNKNOWN";

    const birt = findChild(node, "BIRT");
    const birth = parseGedcomDate(findChild(birt, "DATE")?.value);
    const deat = findChild(node, "DEAT");
    const death = parseGedcomDate(findChild(deat, "DATE")?.value);

    individuals.push({
      xref,
      givenNames,
      surname1,
      alias,
      sex,
      birthDateText: birth.text ?? null,
      birthDateValue: birth.value ?? null,
      birthDatePrecision: birth.precision ?? null,
      birthPlace: findChild(birt, "PLAC")?.value?.trim() || null,
      deathDateText: death.text ?? null,
      deathDateValue: death.value ?? null,
      deathDatePrecision: death.precision ?? null,
      deathPlace: findChild(deat, "PLAC")?.value?.trim() || null,
    });
  }

  const families: ParsedFamily[] = [];
  for (const node of ast.children.filter((c) => c.type === "FAM")) {
    const xref = stripXref(node.data?.xref_id);
    if (!xref) continue;

    const marr = findChild(node, "MARR");
    const marriage = parseGedcomDate(findChild(marr, "DATE")?.value);
    const unionStatus: UnionStatus = findChild(node, "DIV") ? "DIVORCED" : findChild(node, "ANUL") ? "ANNULLED" : "ONGOING";

    families.push({
      xref,
      husbandXref: stripXref(findChild(node, "HUSB")?.data?.pointer),
      wifeXref: stripXref(findChild(node, "WIFE")?.data?.pointer),
      childXrefs: findChildren(node, "CHIL").map((c) => stripXref(c.data?.pointer)).filter((x): x is string => !!x),
      unionType: marr ? "MARRIAGE" : "UNKNOWN",
      unionStatus,
      unionDateText: marriage.text ?? null,
      unionDateValue: marriage.value ?? null,
      unionDatePrecision: marriage.precision ?? null,
      unionPlace: findChild(marr, "PLAC")?.value?.trim() || null,
      notes: readNote(node),
    });
  }

  return { individuals, families };
}

// Creates or updates individuals/families by their GEDCOM xref, scoped to
// one tree — re-importing the same file (or a newer export from another
// program that kept the same xrefs) updates existing rows instead of
// duplicating them, via the unique (treeId, gedcomXref) constraint already
// on both models. Kept separate from the HTTP route so it can be exercised
// directly (e.g. against a scratch tree) without going through multipart.
export async function importGedcomIntoTree(
  treeId: string,
  text: string,
): Promise<{ individuals: number; families: number; individualIds: string[] }> {
  const parsed = parseGedcomFile(text);
  if (parsed.individuals.length === 0) {
    throw new Error("El archivo no contiene ningún individuo (registro INDI)");
  }

  return prisma.$transaction(
    async (tx) => {
      const xrefToId = new Map<string, string>();

      for (const ind of parsed.individuals) {
        const row = await tx.individual.upsert({
          where: { treeId_gedcomXref: { treeId, gedcomXref: ind.xref } },
          create: {
            treeId,
            gedcomXref: ind.xref,
            givenNames: ind.givenNames || "(sin nombre)",
            surname1: ind.surname1 || "(sin apellido)",
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
          },
          update: {
            givenNames: ind.givenNames || "(sin nombre)",
            surname1: ind.surname1 || "(sin apellido)",
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
          },
        });
        xrefToId.set(ind.xref, row.id);

        // Same auto-derivation a manual create/edit gets — GEDCOM has no
        // birth-surname concept to pass through, just the current one.
        await deriveLineagesFromSurnames(tx, treeId, row.id, [ind.surname1]);
      }

      let familiesWritten = 0;
      for (const fam of parsed.families) {
        const partner1Id = fam.husbandXref ? (xrefToId.get(fam.husbandXref) ?? null) : null;
        const partner2Id = fam.wifeXref ? (xrefToId.get(fam.wifeXref) ?? null) : null;

        const family = await tx.family.upsert({
          where: { treeId_gedcomXref: { treeId, gedcomXref: fam.xref } },
          create: {
            treeId,
            gedcomXref: fam.xref,
            partner1Id,
            partner2Id,
            unionType: fam.unionType,
            unionStatus: fam.unionStatus,
            unionDateText: fam.unionDateText,
            unionDateValue: fam.unionDateValue,
            unionDatePrecision: fam.unionDatePrecision,
            unionPlace: fam.unionPlace,
            notes: fam.notes,
          },
          update: {
            partner1Id,
            partner2Id,
            unionType: fam.unionType,
            unionStatus: fam.unionStatus,
            unionDateText: fam.unionDateText,
            unionDateValue: fam.unionDateValue,
            unionDatePrecision: fam.unionDatePrecision,
            unionPlace: fam.unionPlace,
            notes: fam.notes,
          },
        });
        familiesWritten++;

        for (const childXref of fam.childXrefs) {
          const childId = xrefToId.get(childXref);
          if (!childId) continue;
          await tx.familyChild.upsert({
            where: { familyId_individualId: { familyId: family.id, individualId: childId } },
            create: { familyId: family.id, individualId: childId, relationType: "BIOLOGICAL" },
            update: {},
          });
        }
      }

      return { individuals: xrefToId.size, families: familiesWritten, individualIds: [...xrefToId.values()] };
    },
    { timeout: 30_000 },
  );
}
