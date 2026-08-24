import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchStatistics, type PersonStatistics } from "./api";
import PersonStatsSection from "./PersonStatsSection";

type Props = {
  treeId: string;
  personId: string;
};

// Same fetch-on-personId-change pattern as RelationsTab/PersonMediaTab —
// only ever asks the backend for this one person's stats (no ?general),
// since the InfoPanel context is about this specific person, not the tree.
export default function PersonStatisticsTab({ treeId, personId }: Props) {
  const { t } = useTranslation();
  const [person, setPerson] = useState<PersonStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStatistics(treeId, personId)
      .then((result) => {
        if (!cancelled) setPerson(result.person ?? null);
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
  }, [treeId, personId]);

  if (loading) return <p className="status">{t("common.loading")}</p>;
  if (error) return <p className="status status-error">{error}</p>;
  if (!person) return null;

  return (
    <div className="person-stats-tab">
      <PersonStatsSection person={person} />
    </div>
  );
}
