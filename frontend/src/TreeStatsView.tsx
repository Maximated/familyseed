import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchLineages,
  fetchMyIdentity,
  fetchStatistics,
  fetchTree,
  type GeneralStatistics,
  type IndividualFilters,
  type Lineage,
  type TreePerson,
} from "./api";
import EditPersonForm from "./EditPersonForm";
import IndividualsSearchView from "./IndividualsSearchView";
import LineagesManageView from "./LineagesManageView";
import DuplicatesView from "./DuplicatesView";
import TrashView from "./TrashView";
import RelationshipWizard from "./RelationshipWizard";
import { StatRow } from "./PersonStatsSection";
import { DuplicatesIcon, Trash2Icon, UnresolvedIcon } from "./Icons";

type Props = {
  treeId: string;
  treeName: string;
  onClose: () => void;
};

// A stat's own count/name rendered as a drill-down link when there's
// actually something to show — a "0" or an empty lineage would just open
// onto a blank list, so those fall back to plain, unclickable text.
function StatLink({ enabled, onClick, children }: { enabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return enabled ? (
    <button type="button" className="stats-stat-link" onClick={onClick}>
      {children}
    </button>
  ) : (
    <>{children}</>
  );
}

export default function TreeStatsView({ treeId, treeName, onClose }: Props) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<GeneralStatistics | null>(null);
  const [people, setPeople] = useState<TreePerson[]>([]);
  const [lineages, setLineages] = useState<Lineage[]>([]);
  const [myIdentityPersonId, setMyIdentityPersonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every mutation so the nested IndividualsSearchView (key'd on
  // this) remounts and re-fetches instead of quietly showing stale rows —
  // it has no other way to know its own last fetch is now out of date.
  const [refreshToken, setRefreshToken] = useState(0);

  const [searchView, setSearchView] = useState<{ title: string; filters: IndividualFilters } | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [showLineagesManage, setShowLineagesManage] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [wizardIds, setWizardIds] = useState<string[] | null>(null);
  const [noUnrelatedMessage, setNoUnrelatedMessage] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  function refresh() {
    setRefreshToken((v) => v + 1);
    Promise.all([fetchStatistics(treeId), fetchTree(treeId), fetchLineages(treeId)])
      .then(([{ general }, { people }, lineages]) => {
        setStats(general);
        setPeople(people);
        setLineages(lineages);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchStatistics(treeId), fetchTree(treeId), fetchLineages(treeId), fetchMyIdentity(treeId)])
      .then(([{ general }, { people }, lineages, identity]) => {
        if (cancelled) return;
        setStats(general);
        setPeople(people);
        setLineages(lineages);
        setMyIdentityPersonId(identity.individualId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeId]);

  // Both a search result row's own click and its edit pencil land here —
  // this screen only ever opens a list to edit who's in it, so there's no
  // separate "view in the canvas" destination worth building for a "go to
  // person" click the way TreeView's own has one.
  function openEdit(personId: string) {
    setSearchView(null);
    setEditingPersonId(personId);
  }

  function openUnrelatedWizard() {
    const unrelatedIds = people
      .filter((p) => p.rels.parents.length === 0 && p.rels.spouses.length === 0 && p.rels.children.length === 0)
      .map((p) => p.id);
    if (unrelatedIds.length === 0) {
      setNoUnrelatedMessage(true);
      window.setTimeout(() => setNoUnrelatedMessage(false), 3000);
      return;
    }
    setWizardIds(unrelatedIds);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel tree-stats-view" onClick={(e) => e.stopPropagation()}>
        <h2>{t("treeStats.title", { name: treeName })}</h2>

        {error && <p className="status status-error">{error}</p>}
        {loading ? (
          <p className="status">{t("common.loading")}</p>
        ) : (
          stats && (
            <div className="person-stats-tab">
              <section className="stats-section">
                <h3 className="stats-section-heading">{t("statistics.sectionGeneral")}</h3>
                <StatRow
                  label={t("statistics.sexMale")}
                  value={
                    <StatLink
                      enabled={stats.sexCounts.male > 0}
                      onClick={() =>
                        setSearchView({ title: t("statistics.sexMale"), filters: { sex: "MALE" } })
                      }
                    >
                      {stats.sexCounts.male} ({stats.sexPercentages.male}%)
                    </StatLink>
                  }
                />
                <StatRow
                  label={t("statistics.sexFemale")}
                  value={
                    <StatLink
                      enabled={stats.sexCounts.female > 0}
                      onClick={() =>
                        setSearchView({ title: t("statistics.sexFemale"), filters: { sex: "FEMALE" } })
                      }
                    >
                      {stats.sexCounts.female} ({stats.sexPercentages.female}%)
                    </StatLink>
                  }
                />
                <StatRow
                  label={t("statistics.sexUnknown")}
                  value={
                    <StatLink
                      enabled={stats.sexCounts.unknown > 0}
                      onClick={() =>
                        setSearchView({ title: t("statistics.sexUnknown"), filters: { sex: "UNKNOWN" } })
                      }
                    >
                      {stats.sexCounts.unknown} ({stats.sexPercentages.unknown}%)
                    </StatLink>
                  }
                />
                <StatRow
                  label={t("statistics.lineageCount")}
                  value={
                    <StatLink enabled={stats.lineageCount > 0} onClick={() => setShowLineagesManage(true)}>
                      {stats.lineageCount}
                    </StatLink>
                  }
                />
                <StatRow
                  label={t("statistics.yearRangeLabel")}
                  value={
                    stats.yearRange
                      ? t("statistics.yearRange", { earliest: stats.yearRange.earliest, latest: stats.yearRange.latest })
                      : t("statistics.yearRangeUnknown")
                  }
                />
                <StatRow
                  label={t("statistics.longestLivedLabel")}
                  value={
                    stats.longestLived ? (
                      <StatLink enabled onClick={() => openEdit(stats.longestLived!.individualId)}>
                        {t("statistics.longestLived", { name: stats.longestLived.name, age: stats.longestLived.ageYears })}
                      </StatLink>
                    ) : (
                      t("statistics.longestLivedUnknown")
                    )
                  }
                />
                <StatRow
                  label={t("statistics.largestLineageLabel")}
                  value={
                    stats.largestLineage ? (
                      <StatLink
                        enabled
                        onClick={() =>
                          setSearchView({
                            title: stats.largestLineage!.name,
                            filters: { lineageId: stats.largestLineage!.lineageId },
                          })
                        }
                      >
                        {t("statistics.largestLineage", {
                          name: stats.largestLineage.name,
                          count: stats.largestLineage.memberCount,
                        })}
                      </StatLink>
                    ) : (
                      t("statistics.largestLineageUnknown")
                    )
                  }
                />
                <StatRow
                  label={t("statistics.largestGenerationLabel")}
                  value={
                    stats.largestGeneration
                      ? t("statistics.largestGeneration", {
                          generation: stats.largestGeneration.generation,
                          count: stats.largestGeneration.count,
                        })
                      : t("statistics.largestGenerationUnknown")
                  }
                />
                <StatRow label={t("statistics.familyNucleiCount")} value={stats.familyNucleiCount} />
                <StatRow
                  label={t("statistics.missingBirthLabel")}
                  value={
                    <StatLink
                      enabled={stats.incompleteData.missingBirth > 0}
                      onClick={() =>
                        setSearchView({ title: t("statistics.missingBirthLabel"), filters: { missingBirth: true } })
                      }
                    >
                      {stats.incompleteData.missingBirth}
                    </StatLink>
                  }
                />
                <StatRow
                  label={t("statistics.missingDeathLabel")}
                  value={
                    <StatLink
                      enabled={stats.incompleteData.missingDeath > 0}
                      onClick={() =>
                        setSearchView({ title: t("statistics.missingDeathLabel"), filters: { missingDeath: true } })
                      }
                    >
                      {stats.incompleteData.missingDeath}
                    </StatLink>
                  }
                />
                <p className="field-hint">{t("statistics.missingDeathHint")}</p>
                <StatRow
                  label={t("statistics.mostCommonBirthplaceLabel")}
                  value={
                    stats.mostCommonBirthplace ? (
                      <StatLink
                        enabled
                        onClick={() =>
                          setSearchView({
                            title: stats.mostCommonBirthplace!.place,
                            filters: { place: stats.mostCommonBirthplace!.place },
                          })
                        }
                      >
                        {t("statistics.mostCommonBirthplace", {
                          place: stats.mostCommonBirthplace.place,
                          count: stats.mostCommonBirthplace.count,
                        })}
                      </StatLink>
                    ) : (
                      t("statistics.noBirthplaceData")
                    )
                  }
                />
              </section>

              <section className="stats-section">
                <h3 className="stats-section-heading">{t("treeStats.managementHeading")}</h3>
                <div className="tree-stats-management-actions">
                  <button
                    type="button"
                    className="btn-outline tree-stats-action"
                    onClick={() => setShowDuplicates(true)}
                  >
                    <DuplicatesIcon size={18} />
                    {t("app.duplicates")}
                  </button>
                  <button type="button" className="btn-outline tree-stats-action" onClick={openUnrelatedWizard}>
                    <UnresolvedIcon size={18} />
                    {t("app.unrelatedWizard")}
                  </button>
                  <button type="button" className="btn-outline tree-stats-action" onClick={() => setShowTrash(true)}>
                    <Trash2Icon size={18} />
                    {t("app.trash")}
                  </button>
                </div>
                {noUnrelatedMessage && <p className="status">{t("relationshipWizard.noneUnrelated")}</p>}
              </section>
            </div>
          )
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>

      {searchView && (
        <IndividualsSearchView
          key={refreshToken}
          treeId={treeId}
          title={searchView.title}
          initialFilters={searchView.filters}
          onNavigateToPerson={openEdit}
          onEditPerson={openEdit}
          onClose={() => setSearchView(null)}
        />
      )}
      {editingPersonId && (
        <EditPersonForm
          treeId={treeId}
          personId={editingPersonId}
          people={people}
          myIdentityPersonId={myIdentityPersonId}
          onIdentityChanged={setMyIdentityPersonId}
          onSaved={() => {
            setEditingPersonId(null);
            refresh();
          }}
          onDeleted={() => {
            setEditingPersonId(null);
            refresh();
          }}
          onClose={() => setEditingPersonId(null)}
          onRelationsChanged={refresh}
        />
      )}
      {showLineagesManage && (
        <LineagesManageView
          treeId={treeId}
          lineages={lineages}
          onChanged={() => fetchLineages(treeId).then(setLineages).catch(() => {})}
          onClose={() => setShowLineagesManage(false)}
        />
      )}
      {showDuplicates && (
        <DuplicatesView
          treeId={treeId}
          onMerged={refresh}
          onClose={() => setShowDuplicates(false)}
        />
      )}
      {wizardIds && (
        <RelationshipWizard
          treeId={treeId}
          personIds={wizardIds}
          onFinished={refresh}
          onClose={() => setWizardIds(null)}
        />
      )}
      {showTrash && (
        <TrashView treeId={treeId} onRestored={refresh} onClose={() => setShowTrash(false)} />
      )}
    </div>
  );
}
