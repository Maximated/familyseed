import i18n from "./i18n";

// Presentation rules for titled people (Individual.hasTitles) — the
// frontend half of backend/src/titles.ts, which renders the same strings
// for the PDF report and GEDCOM export. Keep the two in step.
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

// "Felipe I de Castilla": given name + the primary title's ordinal and
// domain. A primary title with neither (a bare "Papa") falls back to the
// ordinary "given surname" form, since it wouldn't identify anyone.
export function titledDisplayName(givenNames: string, surname: string, titles: TitleFields[]): string {
  const primary = primaryTitle(titles);
  if (!primary || (!primary.ordinal && !primary.domain)) return `${givenNames} ${surname}`.trim();
  return [givenNames, primary.ordinal, primary.domain ? i18n.t("titles.ofDomain", { domain: primary.domain }) : null]
    .filter(Boolean)
    .join(" ");
}

// What the tree card / info panel call someone — the titled form when the
// toggle is on and there's at least one title, the plain name otherwise.
export function displayNameOf(data: {
  "first name"?: unknown;
  "last name"?: unknown;
  hasTitles?: unknown;
  titles?: unknown;
}): string {
  const given = String(data["first name"] ?? "");
  const surname = String(data["last name"] ?? "");
  const titles = data.hasTitles && Array.isArray(data.titles) ? (data.titles as TitleFields[]) : [];
  return titles.length ? titledDisplayName(given, surname, titles) : `${given} ${surname}`.trim();
}

// One list line per held title: "Rey consorte de Castilla — Felipe I · 1506".
export function formatTitle(title: TitleFields, givenNames?: string): string {
  let text = title.title;
  if (title.consort) text += ` ${i18n.t("titles.consortSuffix")}`;
  if (title.domain) text += ` ${i18n.t("titles.ofDomain", { domain: title.domain })}`;
  if (title.ordinal && givenNames) text += ` — ${givenNames} ${title.ordinal}`;
  const dates = [title.fromText, title.toText].filter(Boolean).join("–");
  if (dates) text += ` · ${dates}`;
  return text;
}
