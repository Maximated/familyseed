import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { createTree, fetchTrees, importCsv, importGedcom, type TreeSummary } from "./api";
import { useAuth } from "./AuthContext";
import LanguageSwitcher from "./LanguageSwitcher";
import GedcomView from "./GedcomView";
import RelationshipWizard from "./RelationshipWizard";
import TreeReportModal from "./TreeReportModal";
import ShareTreeModal from "./ShareTreeModal";
import DeleteTreeModal from "./DeleteTreeModal";
import { ArrowUpDownIcon, FileTextIcon, ShareIcon, Trash2Icon } from "./Icons";

function TreeRow({
  tree,
  onOpen,
  onGedcom,
  onReport,
  onShare,
  onDelete,
}: {
  tree: TreeSummary;
  onOpen: (id: string) => void;
  onGedcom: (id: string) => void;
  onReport: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
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
        {tree.role === "OWNER" && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("app.share")}
            title={t("app.share")}
            onClick={(e) => {
              e.stopPropagation();
              onShare(tree.id);
            }}
          >
            <ShareIcon />
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [owned, setOwned] = useState<TreeSummary[]>([]);
  const [shared, setShared] = useState<TreeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTreeName, setNewTreeName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [wizard, setWizard] = useState<{ treeId: string; personIds: string[] } | null>(null);
  const [gedcomTreeId, setGedcomTreeId] = useState<string | null>(null);
  const [reportTreeId, setReportTreeId] = useState<string | null>(null);
  const [shareTreeId, setShareTreeId] = useState<string | null>(null);
  const [deleteTreeId, setDeleteTreeId] = useState<string | null>(null);

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

  function handleImportClick() {
    if (!newTreeName.trim()) return;
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
      setError(t("gedcom.importErrorType"));
      return;
    }

    setImporting(true);
    setError(null);
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
      setError((err as Error).message);
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
                    onShare={setShareTreeId}
                    onDelete={setDeleteTreeId}
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
                    onDelete={setDeleteTreeId}
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
          <button type="submit" disabled={submitting || importing}>
            {t("home.createTreeSubmit")}
          </button>
          <button type="button" onClick={handleImportClick} disabled={submitting || importing}>
            {importing ? t("home.importingTree") : t("home.createTreeImport")}
          </button>
          <button type="button" onClick={() => setCreating(false)} disabled={submitting || importing}>
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
