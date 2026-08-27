import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createTree, fetchTrees, importCsv, importGedcom, mediaUrl, updateTreeName, type TreeSummary } from "./api";
import { useAuth } from "./AuthContext";
import GedcomView from "./GedcomView";
import RelationshipWizard from "./RelationshipWizard";
import TreeReportModal from "./TreeReportModal";
import ShareTreeModal from "./ShareTreeModal";
import DeleteTreeModal from "./DeleteTreeModal";
import TreeStatsView from "./TreeStatsView";
import { ArrowUpDownIcon, BarChartIcon, FileTextIcon, PencilIcon, ShareIcon, Trash2Icon, UserIcon } from "./Icons";
import { APP_COMMIT, checkForUpdate } from "./version";

function TreeRow({
  tree,
  onOpen,
  onGedcom,
  onReport,
  onShare,
  onStats,
  onDelete,
  onRenamed,
}: {
  tree: TreeSummary;
  onOpen: (id: string) => void;
  onGedcom: (id: string) => void;
  onReport: (id: string) => void;
  onShare: (id: string) => void;
  onStats: (id: string) => void;
  onDelete: (id: string) => void;
  onRenamed: (id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tree.name);
  const [renameError, setRenameError] = useState<string | null>(null);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(tree.name);
    setRenameError(null);
    setEditing(true);
  }

  async function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === tree.name) return;
    try {
      await updateTreeName(tree.id, trimmed);
      onRenamed(tree.id, trimmed);
    } catch (err) {
      setRenameError((err as Error).message);
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") setEditing(false);
  }

  return (
    <li className="home-tree-row">
      <div className="home-tree-main" onClick={() => !editing && onOpen(tree.id)}>
        {editing ? (
          <input
            className="home-tree-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleTitleKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="home-tree-name">{tree.name}</span>
        )}
        <span className="home-tree-role">{t(`roles.${tree.role}`)}</span>
        {renameError && <span className="status status-error home-tree-rename-error">{renameError}</span>}
      </div>
      <div className="home-tree-actions">
        {tree.role !== "VIEWER" && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("app.renameTree")}
            title={t("app.renameTree")}
            onClick={startEditing}
          >
            <PencilIcon />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("app.gedcom")}
          title={t("app.gedcom")}
          onClick={(e) => {
            e.stopPropagation();
            onGedcom(tree.id);
          }}
        >
          <ArrowUpDownIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("app.report")}
          title={t("app.report")}
          onClick={(e) => {
            e.stopPropagation();
            onReport(tree.id);
          }}
        >
          <FileTextIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("treeStats.openLabel")}
          title={t("treeStats.openLabel")}
          onClick={(e) => {
            e.stopPropagation();
            onStats(tree.id);
          }}
        >
          <BarChartIcon />
        </button>
        {tree.role === "OWNER" && (
          <button
            type="button"
            className="icon-button icon-button-badged"
            aria-label={tree.memberCount > 1 ? t("app.manageGuests", { count: tree.memberCount - 1 }) : t("app.share")}
            title={tree.memberCount > 1 ? t("app.manageGuests", { count: tree.memberCount - 1 }) : t("app.share")}
            onClick={(e) => {
              e.stopPropagation();
              onShare(tree.id);
            }}
          >
            <ShareIcon />
            {tree.memberCount > 1 && <span className="icon-button-badge">{tree.memberCount - 1}</span>}
          </button>
        )}
        {tree.role === "OWNER" && (
          <button
            type="button"
            className="icon-button icon-button-danger"
            aria-label={t("app.deleteTree")}
            title={t("app.deleteTree")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tree.id);
            }}
          >
            <Trash2Icon />
          </button>
        )}
      </div>
    </li>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [owned, setOwned] = useState<TreeSummary[]>([]);
  const [shared, setShared] = useState<TreeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTreeName, setNewTreeName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [wizard, setWizard] = useState<{ treeId: string; personIds: string[] } | null>(null);
  const [gedcomTreeId, setGedcomTreeId] = useState<string | null>(null);
  const [reportTreeId, setReportTreeId] = useState<string | null>(null);
  const [shareTreeId, setShareTreeId] = useState<string | null>(null);
  const [statsTreeId, setStatsTreeId] = useState<string | null>(null);
  const [deleteTreeId, setDeleteTreeId] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    checkForUpdate().then(({ hasUpdate }) => setUpdateAvailable(hasUpdate));
  }, []);

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

  function handleRenamed(treeId: string, name: string) {
    const rename = (list: TreeSummary[]) => list.map((t) => (t.id === treeId ? { ...t, name } : t));
    setOwned(rename);
    setShared(rename);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newTreeName.trim()) {
      setCreateError(t("home.createTreeNameRequired"));
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const tree = await createTree(newTreeName.trim());
      setCreating(false);
      setNewTreeName("");
      navigate(`/tree/${tree.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleImportClick() {
    if (!newTreeName.trim()) {
      setCreateError(t("home.createTreeNameRequired"));
      return;
    }
    setCreateError(null);
    importFileRef.current?.click();
  }

  // Creates the tree and imports the chosen file into it in one step,
  // rather than creating an empty tree first and offering import as a
  // separate follow-up screen.
  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    const isGed = name.endsWith(".ged");
    if (!isCsv && !isGed) {
      setCreateError(t("gedcom.importErrorType"));
      return;
    }

    setImporting(true);
    setCreateError(null);
    try {
      const tree = await createTree(newTreeName.trim());
      const imported = isCsv ? await importCsv(tree.id, file) : await importGedcom(tree.id, file);
      setCreating(false);
      setNewTreeName("");
      if (imported.individualIds.length > 0) {
        setWizard({ treeId: tree.id, personIds: imported.individualIds });
      } else {
        navigate(`/tree/${tree.id}`);
      }
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">
          <img src="/images/familyseed-icon.png" alt="" className="home-brand-logo" />
          <div>
            <p className="home-brand-name">FamilySeed</p>
            <h1>{t("home.title")}</h1>
          </div>
        </div>
        <div className="home-header-actions">
          {user && (
            <button
              type="button"
              className="home-avatar-button"
              onClick={() => navigate("/settings")}
              aria-label={t("settings.title")}
              title={user.name ?? user.email ?? t("settings.title")}
            >
              {user.avatarUrl ? (
                <img src={mediaUrl(user.avatarUrl)} alt="" className="home-avatar-img" />
              ) : (
                <span className="home-avatar-img home-avatar-placeholder">
                  <UserIcon size={20} />
                </span>
              )}
            </button>
          )}
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
                    onShare={setShareTreeId}
                    onStats={setStatsTreeId}
                    onDelete={setDeleteTreeId}
                    onRenamed={handleRenamed}
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
                    onShare={setShareTreeId}
                    onStats={setStatsTreeId}
                    onDelete={setDeleteTreeId}
                    onRenamed={handleRenamed}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {creating ? (
        <div className="home-create-block">
          <form className="home-create-form" onSubmit={handleCreate}>
            <input
              type="text"
              placeholder={t("home.createTreePlaceholder")}
              value={newTreeName}
              onChange={(e) => {
                setNewTreeName(e.target.value);
                if (createError) setCreateError(null);
              }}
              autoFocus
            />
            <button type="submit" disabled={submitting || importing}>
              {t("home.createTreeSubmit")}
            </button>
            <button type="button" className="btn-outline" onClick={handleImportClick} disabled={submitting || importing}>
              {importing ? t("home.importingTree") : t("home.createTreeImport")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setCreateError(null);
              }}
              disabled={submitting || importing}
            >
              {t("home.createTreeCancel")}
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".ged,.csv"
              onChange={handleImportFile}
              style={{ display: "none" }}
            />
          </form>
          {createError && <p className="status status-error">{createError}</p>}
        </div>
      ) : (
        <button type="button" className="home-create-button" onClick={() => setCreating(true)}>
          {t("home.createTree")}
        </button>
      )}

      <p className="home-footer-credit">
        {t("home.artCredit")}{" "}
        <a
          href="https://www.vectorstock.com/royalty-free-vector/green-tree-outline-vector-32071593"
          target="_blank"
          rel="noreferrer"
        >
          VectorStock / topor
        </a>
      </p>
      <p className="home-footer-version">
        {t("home.version", { commit: APP_COMMIT })}
        {updateAvailable && <span className="home-update-badge">{t("home.updateAvailable")}</span>}
      </p>

      {gedcomTreeId && (
        <GedcomView treeId={gedcomTreeId} onImported={() => {}} onClose={() => setGedcomTreeId(null)} />
      )}
      {wizard && (
        <RelationshipWizard
          treeId={wizard.treeId}
          personIds={wizard.personIds}
          onFinished={() => {}}
          onClose={() => navigate(`/tree/${wizard.treeId}`)}
        />
      )}
      {reportTreeId && <TreeReportModal treeId={reportTreeId} onClose={() => setReportTreeId(null)} />}
      {shareTreeId && <ShareTreeModal treeId={shareTreeId} onClose={() => setShareTreeId(null)} />}
      {statsTreeId &&
        (() => {
          const tree = [...owned, ...shared].find((t) => t.id === statsTreeId);
          if (!tree) return null;
          return (
            <TreeStatsView treeId={tree.id} treeName={tree.name} onClose={() => setStatsTreeId(null)} />
          );
        })()}
      {deleteTreeId &&
        (() => {
          const tree = owned.find((t) => t.id === deleteTreeId);
          if (!tree) return null;
          return (
            <DeleteTreeModal
              treeId={tree.id}
              treeName={tree.name}
              onDeleted={() => {
                setDeleteTreeId(null);
                load();
              }}
              onClose={() => setDeleteTreeId(null)}
            />
          );
        })()}
    </div>
  );
}
