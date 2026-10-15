// Presentation rules for titled people (see Individual.hasTitles in
// schema.prisma). Mirrored on the frontend in frontend/src/titles.ts —
// the tree card and info panel render there, the PDF report and GEDCOM
// export render here, and both must name "Felipe I de Castilla" the same
// way. Spanish-only on this side: the report has no locale of its own.
export type TitleFields = {
  title: string;
  ordinal: string | null;
  domain: string | null;
  fromText: string | null;
  toText: string | null;
  consort: boolean;
  isPrimary: boolean;
};

export function primaryTitle<T extends TitleFields>(titles: T[]): T | undefined {
  return titles.find((t) => t.isPrimary) ?? titles[0];
}

// "Felipe I de Castilla" — the given name plus the primary title's ordinal
// and domain. Falls back to the plain "given surname" form when the
// primary title carries neither (a bare "Papa" says nothing about *which*
// person this is on a card).
export function titledDisplayName(givenNames: string, surname: string, titles: TitleFields[]): string {
  const primary = primaryTitle(titles);
  if (!primary || (!primary.ordinal && !primary.domain)) return `${givenNames} ${surname}`.trim();
  return [givenNames, primary.ordinal, primary.domain ? `de ${primary.domain}` : null].filter(Boolean).join(" ");
}

// "Rey consorte de Castilla — Felipe I · 1506–1506": one list line per
// held title, for the report and the GEDCOM TITL value.
export function formatTitle(title: TitleFields, givenNames?: string): string {
  let text = title.title;
  if (title.consort) text += " consorte";
  if (title.domain) text += ` de ${title.domain}`;
  if (title.ordinal && givenNames) text += ` — ${givenNames} ${title.ordinal}`;
  const dates = [title.fromText, title.toText].filter(Boolean).join("–");
  if (dates) text += ` · ${dates}`;
  return text;
}

// The reverse of formatTitle's "Rey consorte de Castilla" core (no
// ordinal/dates): splits at the first " de " into title + domain and
// peels a trailing "consorte" off the title. Shared by the GEDCOM and CSV
// importers, so a file from elsewhere with plain "Duque de Borgoña" text
// lands in the structured fields too.
export function parseTitleText(raw: string): { title: string; domain: string | null; consort: boolean } {
  let text = raw.trim().replace(/\s+—\s+.*$/, "");
  let domain: string | null = null;
  const deIndex = text.indexOf(" de ");
  if (deIndex > 0) {
    domain = text.slice(deIndex + 4).trim() || null;
    text = text.slice(0, deIndex);
  }
  const consort = /\bconsorte$/i.test(text);
  if (consort) text = text.replace(/\s*consorte$/i, "");
  return { title: text.trim(), domain, consort };
}

// CSV cell format for a person's titles — one column, titles separated by
// " ; ", fields within a title by " | " in the order
//   title | ordinal | domain | from | to | flags
// where flags is a comma list of "consorte" / "principal", e.g.
//   Rey | I | Castilla | 1506 | 1506 | consorte, principal ; Duque | IV | Borgoña | 1482 | |
// Pipes rather than a prose form so a spreadsheet user can fill it in
// unambiguously; a pipe-less entry ("Duque de Borgoña") still parses via
// parseTitleText.
export function serializeTitlesCsv(titles: TitleFields[]): string {
  return titles
    .map((t) => {
      const flags = [t.consort ? "consorte" : null, t.isPrimary ? "principal" : null].filter(Boolean).join(", ");
      return [t.title, t.ordinal ?? "", t.domain ?? "", t.fromText ?? "", t.toText ?? "", flags].join(" | ");
    })
    .join(" ; ");
}

export function parseTitlesCsv(cell: string | null | undefined): TitleFields[] {
  if (!cell || !cell.trim()) return [];
  const titles: TitleFields[] = [];
  for (const entry of cell.split(";")) {
    if (!entry.trim()) continue;
    const parts = entry.split("|").map((p) => p.trim());
    const parsed = parseTitleText(parts[0] ?? "");
    if (!parsed.title) continue;
    const flags = (parts[5] ?? "").toLowerCase();
    titles.push({
      title: parsed.title,
      ordinal: parts[1] || null,
      domain: parts[2] || parsed.domain,
      fromText: parts[3] || null,
      toText: parts[4] || null,
      consort: parsed.consort || /\bconsort/.test(flags),
      isPrimary: /\bprincipal|\bprimary/.test(flags),
    });
  }
  if (titles.length && !titles.some((t) => t.isPrimary)) titles[0].isPrimary = true;
  return titles;
}
