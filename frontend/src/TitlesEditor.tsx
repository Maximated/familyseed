import { useTranslation } from "react-i18next";
import type { PersonTitle, TitleInput } from "./api";

// One editable row of the titles list — the form's own working copy of a
// PersonTitle, with every field as a string so the inputs stay controlled
// and a stable key so React doesn't remount rows when one is removed.
export type TitleDraft = {
  key: string;
  title: string;
  ordinal: string;
  domain: string;
  fromText: string;
  toText: string;
  consort: boolean;
  isPrimary: boolean;
};

let nextKey = 0;

export function emptyTitleDraft(isPrimary = false): TitleDraft {
  nextKey += 1;
  return { key: `t${nextKey}`, title: "", ordinal: "", domain: "", fromText: "", toText: "", consort: false, isPrimary };
}

export function draftsFromTitles(titles: PersonTitle[] | undefined): TitleDraft[] {
  return (titles ?? []).map((t) => ({
    ...emptyTitleDraft(),
    title: t.title,
    ordinal: t.ordinal ?? "",
    domain: t.domain ?? "",
    fromText: t.fromText ?? "",
    toText: t.toText ?? "",
    consort: t.consort,
    isPrimary: t.isPrimary,
  }));
}

// Rows without a title are just unfinished and dropped; the backend
// guarantees exactly one primary among what's left.
export function titlesPayload(drafts: TitleDraft[]): TitleInput[] {
  return drafts
    .filter((d) => d.title.trim())
    .map((d) => ({
      title: d.title.trim(),
      ordinal: d.ordinal.trim() || null,
      domain: d.domain.trim() || null,
      fromText: d.fromText.trim() || null,
      toText: d.toText.trim() || null,
      consort: d.consort,
      isPrimary: d.isPrimary,
    }));
}

// Suggestions only — the field is free text, so "Señor de Vizcaya" or a
// feminine form not listed here is just typed in.
const TITLE_PRESETS = [
  "Rey",
  "Reina",
  "Emperador",
  "Emperatriz",
  "Príncipe",
  "Princesa",
  "Infante",
  "Infanta",
  "Archiduque",
  "Archiduquesa",
  "Duque",
  "Duquesa",
  "Marqués",
  "Marquesa",
  "Conde",
  "Condesa",
  "Vizconde",
  "Vizcondesa",
  "Barón",
  "Baronesa",
  "Señor",
  "Señora",
  "Papa",
];

type Props = {
  titles: TitleDraft[];
  onChange: (titles: TitleDraft[]) => void;
};

export default function TitlesEditor({ titles, onChange }: Props) {
  const { t } = useTranslation();

  function update(key: string, patch: Partial<TitleDraft>) {
    onChange(titles.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function setPrimary(key: string) {
    onChange(titles.map((row) => ({ ...row, isPrimary: row.key === key })));
  }

  function remove(key: string) {
    const remaining = titles.filter((row) => row.key !== key);
    // Removing the primary hands the role to the first survivor, so the
    // card never ends up titled-but-nameless.
    if (remaining.length && !remaining.some((row) => row.isPrimary)) remaining[0] = { ...remaining[0], isPrimary: true };
    onChange(remaining);
  }

  function add() {
    onChange([...titles, emptyTitleDraft(titles.length === 0)]);
  }

  return (
    <div className="titles-editor">
      <datalist id="title-presets">
        {TITLE_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>
      {titles.map((row, index) => (
        <div className={`title-row${row.isPrimary ? " title-row-primary" : ""}`} key={row.key}>
          <div className="title-row-fields">
            <label>
              {t("titles.title")}
              <input
                list="title-presets"
                placeholder={t("titles.titlePlaceholder")}
                value={row.title}
                onChange={(e) => update(row.key, { title: e.target.value })}
              />
            </label>
            <label className="title-field-ordinal">
              {t("titles.ordinal")}
              <input
                placeholder={t("titles.ordinalPlaceholder")}
                value={row.ordinal}
                onChange={(e) => update(row.key, { ordinal: e.target.value })}
              />
            </label>
            <label>
              {t("titles.domain")}
              <input
                placeholder={t("titles.domainPlaceholder")}
                value={row.domain}
                onChange={(e) => update(row.key, { domain: e.target.value })}
              />
            </label>
            <label className="title-field-date">
              {t("titles.from")}
              <input
                placeholder={t("titles.datePlaceholder")}
                value={row.fromText}
                onChange={(e) => update(row.key, { fromText: e.target.value })}
              />
            </label>
            <label className="title-field-date">
              {t("titles.to")}
              <input
                placeholder={t("titles.datePlaceholder")}
                value={row.toText}
                onChange={(e) => update(row.key, { toText: e.target.value })}
              />
            </label>
          </div>
          <div className="title-row-flags">
            <label className="title-flag">
              <input
                type="radio"
                name="primary-title"
                checked={row.isPrimary}
                onChange={() => setPrimary(row.key)}
              />
              {t("titles.primary")}
            </label>
            <label className="title-flag">
              <input
                type="checkbox"
                checked={row.consort}
                onChange={(e) => update(row.key, { consort: e.target.checked })}
              />
              {t("titles.consort")}
            </label>
            <button
              type="button"
              className="title-remove"
              onClick={() => remove(row.key)}
              aria-label={t("titles.remove")}
              title={t("titles.remove")}
            >
              ×
            </button>
          </div>
          {index === 0 && <p className="field-hint">{t("titles.primaryHint")}</p>}
        </div>
      ))}
      <button type="button" className="titles-add" onClick={add}>
        {t("titles.add")}
      </button>
    </div>
  );
}
