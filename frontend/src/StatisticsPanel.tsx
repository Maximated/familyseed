import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchStatistics, type GeneralStatistics, type PersonStatistics } from "./api";
import PersonStatsSection, { StatRow } from "./PersonStatsSection";

type Props = {
  treeId: string;
  selectedPersonId: string | null;
  selectedPersonName: string | null;
  onClose: () => void;
};

function GeneralSection({ general }: { general: GeneralStatistics }) {
  const { t } = useTranslation();
  const { sexCounts, sexPercentages } = general;

  return (
    <section className="stats-section">
      <h3 className="stats-section-heading">{t("statistics.sectionGeneral")}</h3>
      <StatRow
        label={t("statistics.sexMale")}
        value={`${sexCounts.male} (${sexPercentages.male}%)`}
      />
      <StatRow
        label={t("statistics.sexFemale")}
        value={`${sexCounts.female} (${sexPercentages.female}%)`}
      />
      <StatRow
        label={t("statistics.sexUnknown")}
        value={`${sexCounts.unknown} (${sexPercentages.unknown}%)`}
      />
      <StatRow label={t("statistics.lineageCount")} value={general.lineageCount} />
      <StatRow
        label={t("statistics.yearRangeLabel")}
        value={
          general.yearRange
            ? t("statistics.yearRange", { earliest: general.yearRange.earliest, latest: general.yearRange.latest })
            : t("statistics.yearRangeUnknown")
        }
      />
      <StatRow
        label={t("statistics.longestLivedLabel")}
        value={
          general.longestLived
            ? t("statistics.longestLived", { name: general.longestLived.name, age: general.longestLived.ageYears })
            : t("statistics.longestLivedUnknown")
        }
      />
      <StatRow
        label={t("statistics.largestLineageLabel")}
        value={
          general.largestLineage
            ? t("statistics.largestLineage", { name: general.largestLineage.name, count: general.largestLineage.memberCount })
            : t("statistics.largestLineageUnknown")
        }
      />
      <StatRow
        label={t("statistics.largestGenerationLabel")}
        value={
          general.largestGeneration
            ? t("statistics.largestGeneration", {
                generation: general.largestGeneration.generation,
                count: general.largestGeneration.count,
              })
            : t("statistics.largestGenerationUnknown")
        }
      />
      <StatRow label={t("statistics.familyNucleiCount")} value={general.familyNucleiCount} />
      <StatRow label={t("statistics.missingBirthLabel")} value={general.incompleteData.missingBirth} />
      <StatRow label={t("statistics.missingDeathLabel")} value={general.incompleteData.missingDeath} />
      <p className="field-hint">{t("statistics.missingDeathHint")}</p>
      <StatRow
        label={t("statistics.mostCommonBirthplaceLabel")}
        value={
          general.mostCommonBirthplace
            ? t("statistics.mostCommonBirthplace", {
                place: general.mostCommonBirthplace.place,
                count: general.mostCommonBirthplace.count,
              })
            : t("statistics.noBirthplaceData")
        }
      />
    </section>
  );
}

export default function StatisticsPanel({ treeId, selectedPersonId, selectedPersonName, onClose }: Props) {
  const { t } = useTranslation();
  const [general, setGeneral] = useState<GeneralStatistics | null>(null);
  const [person, setPerson] = useState<PersonStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStatistics(treeId, selectedPersonId ?? undefined)
      .then((result) => {
        if (cancelled) return;
        setGeneral(result.general);
        setPerson(result.person ?? null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [treeId, selectedPersonId]);

  return (
    <div className="popover popover-dark stats-panel" role="dialog" aria-label={t("statistics.title")}>
      {loading && <p className="status">{t("common.loading")}</p>}
      {error && <p className="status status-error">{error}</p>}
      {general && <GeneralSection general={general} />}
      {selectedPersonId && person && selectedPersonName ? (
        <PersonStatsSection person={person} personName={selectedPersonName} />
      ) : (
        !selectedPersonId && <p className="field-hint">{t("statistics.noPersonSelected")}</p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
