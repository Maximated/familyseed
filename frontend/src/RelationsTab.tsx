import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIndividualRelations, type Individual, type IndividualRelations } from "./api";

type Props = {
  personId: string;
  onNavigate: (personId: string) => void;
};

function personLine(p: Pick<Individual, "givenNames" | "surname1" | "surname2">): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

function RelationGroup({
  title,
  people,
  onNavigate,
}: {
  title: string;
  people: { id: string; givenNames: string; surname1: string; surname2: string | null }[];
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relations-group">
      <h3 className="relations-group-heading">{title}</h3>
      {people.length === 0 ? (
        <p className="field-hint">{t("relations.none")}</p>
      ) : (
        <ul className="relations-list">
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" className="relations-item" onClick={() => onNavigate(p.id)}>
                {personLine(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RelationsTab({ personId, onNavigate }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<IndividualRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchIndividualRelations(personId)
      .then((result) => {
        if (!cancelled) setData(result);
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
  }, [personId]);

  if (loading) return <p className="status">{t("common.loading")}</p>;
  if (error) return <p className="status status-error">{error}</p>;
  if (!data) return null;

  const partners = data.partnerships
    .filter((p): p is typeof p & { partner: Individual } => p.partner !== null)
    .map((p) => p.partner);

  return (
    <div className="relations-tab">
      <RelationGroup title={t("relations.parents")} people={data.parents} onNavigate={onNavigate} />
      <RelationGroup title={t("relations.siblings")} people={data.siblings} onNavigate={onNavigate} />
      <RelationGroup title={t("relations.partners")} people={partners} onNavigate={onNavigate} />
      <RelationGroup title={t("relations.children")} people={data.children} onNavigate={onNavigate} />
    </div>
  );
}
