import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchUnlocatedPlaces, locatePlace, searchPlaces, type PlaceSuggestion } from "./api";

type Props = {
  treeId: string;
  // Fires after each successful locate so the map behind can refresh.
  onLocated: () => void;
  onClose: () => void;
};

type Row = {
  text: string;
  uses: number;
  // What's currently being looked up — starts as the place text itself,
  // editable so "Lemberg" can be re-searched as "Lviv".
  query: string;
  status: "pending" | "searching" | "ready";
  suggestions: PlaceSuggestion[];
  chosen: number;
  applying: boolean;
  applied: number | null;
  error: string | null;
};

// Backfill pass for places typed before suggestions existed (or imported
// from a file without coordinates): one row per distinct text, each with a
// proposed match the user confirms explicitly. Nothing is written without
// a click — geocoders are confidently wrong about historical names.
export default function LocatePlacesView({ treeId, onLocated, onClose }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [locatedTotal, setLocatedTotal] = useState(0);
  const searchTimers = useRef(new Map<string, number>());

  useEffect(() => {
    fetchUnlocatedPlaces(treeId)
      .then((places) =>
        setRows(
          places.map((p) => ({
            text: p.text,
            uses: p.uses,
            query: p.text,
            status: "pending",
            suggestions: [],
            chosen: 0,
            applying: false,
            applied: null,
            error: null,
          })),
        ),
      )
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [treeId]);

  function patchRow(text: string, patch: Partial<Row> | ((row: Row) => Partial<Row>)) {
    setRows((prev) => prev.map((r) => (r.text === text ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));
  }

  // Lookups run one at a time, in list order: a big tree can have a few
  // hundred distinct places, and firing them all at once at the shared
  // public geocoder would just get rate-limited.
  const searchingRef = useRef(false);
  useEffect(() => {
    if (searchingRef.current) return;
    const next = rows.find((r) => r.status === "pending" && r.applied === null);
    if (!next) return;
    searchingRef.current = true;
    patchRow(next.text, { status: "searching" });
    searchPlaces(treeId, next.query)
      .then((suggestions) => patchRow(next.text, { status: "ready", suggestions, chosen: 0 }))
      .catch(() => patchRow(next.text, { status: "ready", suggestions: [] }))
      .finally(() => {
        searchingRef.current = false;
        // Nudge the effect to pick up the next pending row.
        setRows((prev) => [...prev]);
      });
  }, [rows, treeId]);

  function handleQueryChange(text: string, query: string) {
    patchRow(text, { query });
    const timers = searchTimers.current;
    window.clearTimeout(timers.get(text));
    timers.set(
      text,
      window.setTimeout(() => patchRow(text, { status: "pending", suggestions: [] }), 400),
    );
  }

  async function applyRow(row: Row): Promise<boolean> {
    const pick = row.suggestions[row.chosen];
    if (!pick) return false;
    patchRow(row.text, { applying: true, error: null });
    try {
      const { updated } = await locatePlace(treeId, row.text, pick.lat, pick.lng);
      patchRow(row.text, { applying: false, applied: updated });
      setLocatedTotal((n) => n + 1);
      onLocated();
      return true;
    } catch (err) {
      patchRow(row.text, { applying: false, error: (err as Error).message });
      return false;
    }
  }

  const proposable = rows.filter((r) => r.applied === null && r.status === "ready" && r.suggestions.length > 0);

  async function handleApplyAll() {
    if (!window.confirm(t("locatePlaces.applyAllConfirm", { count: proposable.length }))) return;
    setApplyingAll(true);
    for (const row of proposable) await applyRow(row);
    setApplyingAll(false);
  }

  const remaining = rows.filter((r) => r.applied === null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel locate-places-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{t("locatePlaces.title")}</h2>
        {loading && <p className="status">{t("common.loading")}</p>}
        {error && <p className="status status-error">{error}</p>}
        {!loading && !error && rows.length === 0 && <p className="status">{t("locatePlaces.empty")}</p>}

        {rows.length > 0 && (
          <>
            <p className="field-hint">{t("locatePlaces.intro")}</p>
            <ul className="locate-places-list">
              {rows.map((row) => (
                <li key={row.text} className={row.applied !== null ? "is-applied" : undefined}>
                  <div className="locate-places-head">
                    <strong>{row.text}</strong>
                    <span className="locate-places-uses">{t("locatePlaces.uses", { count: row.uses })}</span>
                  </div>
                  {row.applied !== null ? (
                    <p className="locate-places-applied">{t("locatePlaces.applied", { count: row.applied })}</p>
                  ) : (
                    <div className="locate-places-body">
                      <input
                        type="text"
                        value={row.query}
                        placeholder={t("locatePlaces.searchPlaceholder")}
                        onChange={(e) => handleQueryChange(row.text, e.target.value)}
                        disabled={row.applying}
                      />
                      {row.status !== "ready" ? (
                        <span className="field-hint">{t("locatePlaces.searching")}</span>
                      ) : row.suggestions.length === 0 ? (
                        <span className="field-hint">{t("locatePlaces.noMatch")}</span>
                      ) : (
                        <div className="locate-places-pick">
                          <select
                            value={row.chosen}
                            onChange={(e) => patchRow(row.text, { chosen: Number(e.target.value) })}
                            disabled={row.applying}
                          >
                            {row.suggestions.map((s, i) => (
                              <option key={`${s.label}-${s.lat}`} value={i}>
                                {s.label}
                                {s.source === "tree" ? ` (${t("place.inThisTree")})` : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => applyRow(row)}
                            disabled={row.applying || applyingAll}
                          >
                            {row.applying ? t("common.saving") : t("locatePlaces.apply")}
                          </button>
                        </div>
                      )}
                      {row.error && <p className="status status-error">{row.error}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {locatedTotal > 0 && <p className="field-hint">{t("locatePlaces.done", { count: locatedTotal })}</p>}

        <div className="modal-actions">
          {remaining.length > 0 && (
            <button type="button" onClick={handleApplyAll} disabled={applyingAll || proposable.length === 0}>
              {t("locatePlaces.applyAll", { count: proposable.length })}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
