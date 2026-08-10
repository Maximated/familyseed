import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createTree, fetchTrees, type TreeSummary } from "./api";
import { useAuth } from "./AuthContext";
import LanguageSwitcher from "./LanguageSwitcher";
import GedcomView from "./GedcomView";
import TreeReportModal from "./TreeReportModal";

function TreeRow({
  tree,
  onOpen,
  onGedcom,
  onReport,
}: {
  tree: TreeSummary;
  onOpen: (id: string) => void;
  onGedcom: (id: string) => void;
  onReport: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="home-tree-row">
      <div className="home-tree-main" onClick={() => onOpen(tree.id)}>
        <span className="home-tree-name">{tree.name}</span>
        <span className="home-tree-role">{t(`roles.${tree.role}`)}</span>
      </div>
      <div className="home-tree-actions">
        <button
          type="button"
          className="home-tree-action"
          onClick={(e) => {
            e.stopPropagation();
            onGedcom(tree.id);
          }}
        >
          {t("app.gedcom")}
        </button>
        <button
          type="button"
          className="home-tree-action"
          onClick={(e) => {
            e.stopPropagation();
            onReport(tree.id);
          }}
        >
          {t("app.report")}
        </button>
      </div>
    </li>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [owned, setOwned] = useState<TreeSummary[]>([]);
  const [shared, setShared] = useState<TreeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTreeName, setNewTreeName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [gedcomTreeId, setGedcomTreeId] = useState<string | null>(null);
  const [reportTreeId, setReportTreeId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchTrees()
      .then(({ owned, shared }) => {
        setOwned(owned);
        setShared(shared);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function handleOpen(treeId: string) {
    navigate(`/tree/${treeId}`);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newTreeName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const tree = await createTree(newTreeName.trim());
      setCreating(false);
      setNewTreeName("");
      navigate(`/tree/${tree.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1>{t("home.title")}</h1>
        <div className="home-header-actions">
          {user && <span className="home-user-name">{user.name ?? user.email}</span>}
          <LanguageSwitcher />
          <button type="button" onClick={() => logout()}>
            {t("auth.logout")}
          </button>
        </div>
      </header>

      {error && <p className="status status-error">{error}</p>}
      {loading ? (
        <p className="status">{t("common.loading")}</p>
      ) : (
        <div className="home-tree-lists">
          <section>
            <h2>{t("home.ownedHeading")}</h2>
            {owned.length === 0 ? (
              <p className="field-hint">{t("home.ownedEmpty")}</p>
            ) : (
              <ul className="home-tree-list">
                {owned.map((tree) => (
                  <TreeRow
                    key={tree.id}
                    tree={tree}
                    onOpen={handleOpen}
                    onGedcom={setGedcomTreeId}
                    onReport={setReportTreeId}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>{t("home.sharedHeading")}</h2>
            {shared.length === 0 ? (
              <p className="field-hint">{t("home.sharedEmpty")}</p>
            ) : (
              <ul className="home-tree-list">
                {shared.map((tree) => (
                  <TreeRow
                    key={tree.id}
                    tree={tree}
                    onOpen={handleOpen}
                    onGedcom={setGedcomTreeId}
                    onReport={setReportTreeId}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {creating ? (
        <form className="home-create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder={t("home.createTreePlaceholder")}
            value={newTreeName}
            onChange={(e) => setNewTreeName(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={submitting}>
            {t("home.createTreeSubmit")}
          </button>
          <button type="button" onClick={() => setCreating(false)} disabled={submitting}>
            {t("home.createTreeCancel")}
          </button>
        </form>
      ) : (
        <button type="button" className="home-create-button" onClick={() => setCreating(true)}>
          {t("home.createTree")}
        </button>
      )}

      {gedcomTreeId && (
        <GedcomView treeId={gedcomTreeId} onImported={() => {}} onClose={() => setGedcomTreeId(null)} />
      )}
      {reportTreeId && <TreeReportModal treeId={reportTreeId} onClose={() => setReportTreeId(null)} />}
    </div>
  );
}
