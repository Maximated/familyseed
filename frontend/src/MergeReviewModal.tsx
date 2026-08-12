import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIndividual, mediaUrl, mergeIndividuals, type Individual, type IndividualFields } from "./api";
import PhotoLightbox from "./PhotoLightbox";

type Props = {
  treeId: string;
  aId: string;
  bId: string;
  onMerged: () => void;
  onClose: () => void;
};

type FieldKey =
  | "givenNames"
  | "surname1"
  | "surname2"
  | "surname1BirthName"
  | "alias"
  | "sex"
  | "photoUrl"
  | "birthDateText"
  | "birthDateValue"
  | "birthDatePrecision"
  | "birthPlace"
  | "deathDateText"
  | "deathDateValue"
  | "deathDatePrecision"
  | "deathPlace"
  | "notes"
  | "biography";

const FIELD_ORDER: FieldKey[] = [
  "givenNames",
  "surname1",
  "surname2",
  "surname1BirthName",
  "alias",
  "sex",
  "photoUrl",
  "birthDateText",
  "birthDateValue",
  "birthDatePrecision",
  "birthPlace",
  "deathDateText",
  "deathDateValue",
  "deathDatePrecision",
  "deathPlace",
  "notes",
  "biography",
];

const FIELD_LABEL_KEY: Record<FieldKey, string> = {
  givenNames: "personFields.givenNames",
  surname1: "personFields.surname1",
  surname2: "personFields.surname2",
  surname1BirthName: "personFields.surname1BirthName",
  alias: "personFields.alias",
  sex: "personFields.sex",
  photoUrl: "mergeReview.photoLabel",
  birthDateText: "personFields.birthDate",
  birthDateValue: "personFields.birthDate",
  birthDatePrecision: "personFields.birthDate",
  birthPlace: "personFields.birthPlace",
  deathDateText: "personFields.deathDate",
  deathDateValue: "personFields.deathDate",
  deathDatePrecision: "personFields.deathDate",
  deathPlace: "personFields.deathPlace",
  notes: "personFields.notes",
  biography: "personFields.biography",
};

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

// The backend stores full ISO timestamps (UTC midnight) for date-value
// fields but its `format: "date"` validation wants just the `YYYY-MM-DD`
// prefix — matches EditPersonForm's toDateInputValue for the same reason.
function toDateOnly(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

function personLabel(p: Individual): string {
  const surname = [p.surname1, p.surname2].filter(Boolean).join(" ");
  return [p.givenNames, surname].filter(Boolean).join(" ");
}

export default function MergeReviewModal({ treeId, aId, bId, onMerged, onClose }: Props) {
  const { t } = useTranslation();
  const [a, setA] = useState<Individual | null>(null);
  const [b, setB] = useState<Individual | null>(null);
  const [keepIsA, setKeepIsA] = useState(true);
  const [choices, setChoices] = useState<Partial<Record<FieldKey, "a" | "b">>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchIndividual(treeId, aId), fetchIndividual(treeId, bId)])
      .then(([fetchedA, fetchedB]) => {
        setA(fetchedA);
        setB(fetchedB);
        const defaults: Partial<Record<FieldKey, "a" | "b">> = {};
        for (const key of FIELD_ORDER) {
          const aEmpty = isEmpty(fetchedA[key]);
          const bEmpty = isEmpty(fetchedB[key]);
          if (aEmpty && !bEmpty) defaults[key] = "b";
          else defaults[key] = "a";
        }
        setChoices(defaults);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [treeId, aId, bId]);

  const conflicts = useMemo(() => {
    if (!a || !b) return [];
    return FIELD_ORDER.filter((key) => String(a[key] ?? "") !== String(b[key] ?? ""));
  }, [a, b]);

  function formatValue(person: Individual, key: FieldKey): string {
    if (key === "sex") return t(`sex.${person.sex === "FEMALE" ? "FEMALE" : person.sex === "MALE" ? "MALE" : "UNKNOWN"}`);
    if (key === "birthDatePrecision") return person.birthDatePrecision ? t(`datePrecision.${person.birthDatePrecision}`) : "";
    if (key === "deathDatePrecision") return person.deathDatePrecision ? t(`datePrecision.${person.deathDatePrecision}`) : "";
    if (key === "birthDateValue" || key === "deathDateValue") {
      const value = person[key];
      return value ? value.slice(0, 10) : "";
    }
    const value = person[key];
    return typeof value === "string" ? value : "";
  }

  async function handleSubmit() {
    if (!a || !b) return;
    const keep = keepIsA ? a : b;
    const loser = keepIsA ? b : a;

    const individual: IndividualFields = {
      givenNames: keep.givenNames,
      surname1: keep.surname1,
      surname2: keep.surname2,
      surname1BirthName: keep.surname1BirthName,
      alias: keep.alias,
      sex: keep.sex,
      photoUrl: keep.photoUrl ?? undefined,
      birthDateText: keep.birthDateText,
      birthDateValue: toDateOnly(keep.birthDateValue),
      birthDatePrecision: keep.birthDatePrecision,
      birthPlace: keep.birthPlace,
      deathDateText: keep.deathDateText,
      deathDateValue: toDateOnly(keep.deathDateValue),
      deathDatePrecision: keep.deathDatePrecision,
      deathPlace: keep.deathPlace,
      notes: keep.notes,
      biography: keep.biography,
    };

    for (const key of conflicts) {
      const winner = choices[key] === "a" ? a : choices[key] === "b" ? b : keep;
      if (key === "photoUrl") {
        individual.photoUrl = winner.photoUrl ?? undefined;
      } else if (key === "birthDateValue" || key === "deathDateValue") {
        individual[key] = toDateOnly(winner[key]);
      } else {
        (individual as Record<string, unknown>)[key] = winner[key];
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await mergeIndividuals(treeId, keep.id, loser.id, individual);
      onMerged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel merge-review-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("mergeReview.title")}</h2>

        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : !a || !b ? (
          <p className="status status-error">{error}</p>
        ) : (
          <>
            <div className="merge-review-columns">
              {[a, b].map((person, index) => {
                const isKeep = (index === 0) === keepIsA;
                return (
                  <div key={person.id} className={`merge-review-column${isKeep ? " merge-review-column-keep" : ""}`}>
                    <p className="merge-review-name">{personLabel(person)}</p>
                    <button type="button" onClick={() => setKeepIsA(index === 0)} disabled={isKeep}>
                      {isKeep ? t("mergeReview.keepThis") : t("mergeReview.useAsKeep")}
                    </button>
                    {!isKeep && <p className="field-hint">{t("mergeReview.willDisappear")}</p>}
                  </div>
                );
              })}
            </div>

            {conflicts.length === 0 ? (
              <p className="field-hint">{t("mergeReview.noConflicts")}</p>
            ) : (
              <ul className="merge-review-fields">
                {conflicts.map((key) => (
                  <li key={key} className="merge-review-field">
                    <span className="merge-review-field-label">{t(FIELD_LABEL_KEY[key])}</span>
                    <div className="merge-review-field-options">
                      {(["a", "b"] as const).map((side) => {
                        const person = side === "a" ? a : b;
                        const value = formatValue(person, key);
                        return (
                          <label key={side} className="merge-review-option">
                            <input
                              type="radio"
                              name={`merge-field-${key}`}
                              checked={choices[key] === side}
                              onChange={() => setChoices((prev) => ({ ...prev, [key]: side }))}
                            />
                            {key === "photoUrl" ? (
                              value ? (
                                <img
                                  className="merge-review-photo"
                                  src={mediaUrl(value)}
                                  alt=""
                                  style={{ cursor: "zoom-in" }}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setLightboxUrl(mediaUrl(value));
                                  }}
                                />
                              ) : (
                                <span className="field-hint">{t("mergeReview.noPhoto")}</span>
                              )
                            ) : (
                              <span>{value || t("mergeReview.emptyValue")}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="field-hint">{t("mergeReview.warning")}</p>
            {error && <p className="status status-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting}>
                {submitting ? t("mergeReview.confirming") : t("mergeReview.confirm")}
              </button>
            </div>
          </>
        )}
      </div>
      {lightboxUrl && <PhotoLightbox src={lightboxUrl} shape="circle" onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
