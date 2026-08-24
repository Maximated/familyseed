import { useTranslation } from "react-i18next";
import type { PersonStatistics } from "./api";

export function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stats-row">
      <span className="stats-stat-label">{label}</span>
      <span className="stats-stat-value">{value}</span>
    </div>
  );
}

// "34 años" if exact, "c. 34 años" if either date behind it is an estimate
// (ABOUT/BEFORE/AFTER precision) — reused for both the person's own age and
// each parent's age at this person's birth, so an approximate gap (e.g. two
// "hacia" dates landing a few years apart) never reads as a data error.
function formatAgeYears(t: (key: string, opts?: Record<string, unknown>) => string, years: number, exact: boolean): string {
  const withUnit = t("statistics.currentAge", { age: years });
  return exact ? withUnit : t("common.circaValue", { value: withUnit });
}

type Props = {
  person: PersonStatistics;
  // Omit when the surrounding UI already shows the person's name (e.g. the
  // InfoPanel "Estadísticas" tab, where the panel header already has it) —
  // the standalone StatisticsPanel passes this to head its own section.
  personName?: string;
};

export default function PersonStatsSection({ person, personName }: Props) {
  const { t } = useTranslation();

  const ageValue = !person.age
    ? t("statistics.ageUnknown")
    : person.age.atDeath
      ? `${formatAgeYears(t, person.age.years, person.age.exact)} ${t("statistics.ageAtDeath")}`
      : formatAgeYears(t, person.age.years, person.age.exact);

  const hasApproxParentAge = person.parentsAgeAtBirth.some((entry) => !entry.exact);

  const relationshipValue =
    !person.meNotSet && person.relationshipToMe
      ? person.relationshipToMe.kind === "self"
        ? t("statistics.relationshipSelf")
        : person.relationshipToMe.kind === "disconnected"
          ? t("statistics.relationshipDisconnected")
          : t("statistics.relationshipToMe", { relationship: person.relationshipToMe.labelEs })
      : null;

  const generationValue =
    !person.meNotSet && person.generationRelativeToMe !== null
      ? person.generationRelativeToMe === 0
        ? t("statistics.generationRelativeToMeSame")
        : t("statistics.generationRelativeToMe", { generation: person.generationRelativeToMe })
      : null;

  return (
    <section className="stats-section">
      {personName && <h3 className="stats-section-heading">{personName}</h3>}
      <StatRow label={t("statistics.age")} value={ageValue} />
      <StatRow label={t("statistics.ancestorLevels")} value={person.ancestorGenerations} />
      <StatRow label={t("statistics.descendantLevels")} value={person.descendantGenerations} />
      <StatRow label={t("statistics.totalAncestors")} value={person.totalAncestors} />
      <StatRow label={t("statistics.totalDescendants")} value={person.totalDescendants} />
      <StatRow label={t("statistics.siblingsCount")} value={person.siblingsCount} />
      <StatRow label={t("statistics.childrenCount")} value={person.childrenCount} />
      <StatRow label={t("statistics.unionsCount")} value={person.unionsCount} />
      {person.parentsAgeAtBirth.map((entry) => (
        <p key={entry.parentId} className="field-hint">
          {t("statistics.parentAgeAtBirth", {
            name: entry.parentName,
            age: formatAgeYears(t, entry.ageYears, entry.exact),
          })}
        </p>
      ))}
      {hasApproxParentAge && <p className="field-hint">{t("statistics.parentsAgeApproxHint")}</p>}
      {person.meNotSet ? (
        <p className="field-hint">{t("statistics.meNotSet")}</p>
      ) : (
        <>
          {generationValue && <p className="stats-sentence">{generationValue}</p>}
          {relationshipValue && <p className="stats-sentence">{relationshipValue}</p>}
        </>
      )}
    </section>
  );
}
