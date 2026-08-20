import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PersonMediaTab from "./PersonMedia";
import RelationsTab from "./RelationsTab";
import UnionNotesEditor from "./UnionNotesEditor";
import UnionDetailsEditor from "./UnionDetailsEditor";
import UnionChildrenEditor, { type UnionChild } from "./UnionChildrenEditor";
import CopyPersonModal from "./CopyPersonModal";
import PhotoLightbox from "./PhotoLightbox";
import { deleteFamily, type UnionStatus, type UnionType } from "./api";

export type InfoPanelSection = {
  heading: string;
  items: string[];
};

export type InfoPanelData = {
  icon: ReactNode;
  iconClassName?: string;
  // Only set for a person with an uploaded avatar — shown instead of
  // `icon` when present, and click-to-enlarges.
  photoUrl?: string;
  title: string;
  subtitle?: string;
  sections: InfoPanelSection[];
  // Only set for a person (not a union) — enables the Relaciones/Fotos/Documentos tabs.
  personId?: string;
  // Only set for a union (not a person) — enables the inline notes editor
  // and the type/status/date/place editor below.
  familyId?: string;
  notes?: string | null;
  union?: {
    unionType: UnionType;
    unionStatus: UnionStatus;
    unionDateText: string | null;
    unionPlace: string | null;
    partner1Id: string;
    partner2Id: string;
    children: UnionChild[];
  };
};

type Props = {
  treeId: string;
  data: InfoPanelData;
  onClose: () => void;
  onNavigateToPerson: (personId: string) => void;
  onDataChanged: () => void;
};

type Tab = "ficha" | "relaciones" | "fotos" | "documentos";

export default function InfoPanel({ treeId, data, onClose, onNavigateToPerson, onDataChanged }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("ficha");
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showPhotoLightbox, setShowPhotoLightbox] = useState(false);
  const [confirmingDeleteUnion, setConfirmingDeleteUnion] = useState(false);
  const [deletingUnion, setDeletingUnion] = useState(false);
  const [deleteUnionError, setDeleteUnionError] = useState<string | null>(null);

  async function handleDeleteUnion() {
    if (!data.familyId) return;
    setDeletingUnion(true);
    setDeleteUnionError(null);
    try {
      await deleteFamily(treeId, data.familyId);
      onDataChanged();
      onClose();
    } catch (err) {
      setDeleteUnionError((err as Error).message);
      setDeletingUnion(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel info-panel" onClick={(e) => e.stopPropagation()}>
        <div className="info-panel-header">
          {data.photoUrl ? (
            <img
              className="info-panel-photo"
              src={data.photoUrl}
              alt=""
              onClick={() => setShowPhotoLightbox(true)}
            />
          ) : (
            <div className={`info-panel-icon${data.iconClassName ? ` ${data.iconClassName}` : ""}`}>{data.icon}</div>
          )}
          <div className="info-panel-heading">
            <h2 className="info-panel-title name-text">{data.title}</h2>
            {data.subtitle && <p className="info-panel-subtitle name-text">{data.subtitle}</p>}
          </div>
        </div>

        {data.personId && (
          <div className="info-panel-tabs">
            {(["ficha", "relaciones", "fotos", "documentos"] as Tab[]).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                className={`info-panel-tab${tab === tabKey ? " info-panel-tab-active" : ""}`}
                onClick={() => setTab(tabKey)}
              >
                {t(`infoPanel.tab${tabKey.charAt(0).toUpperCase()}${tabKey.slice(1)}`)}
              </button>
            ))}
          </div>
        )}

        {tab === "ficha" && (
          <div className="info-panel-sections">
            {/* A union's own equivalent of this same read-only content also
                lives in `data.sections` (see buildUnionInfoPanel) — that
                copy is for the hover-preview, which never renders these
                editors at all. Showing both here would just repeat every
                bullet twice, so the editors below take over entirely once
                there's a familyId. */}
            {!data.familyId &&
              data.sections.map((section) => (
                <div className="info-panel-section" key={section.heading}>
                  <h3 className="info-panel-section-heading">{section.heading}</h3>
                  <ul className="info-panel-bullets">
                    {section.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            {data.familyId && data.union && (
              <UnionDetailsEditor treeId={treeId} familyId={data.familyId} initial={data.union} onSaved={onDataChanged} />
            )}
            {data.familyId && data.union && (
              <UnionChildrenEditor
                treeId={treeId}
                familyId={data.familyId}
                partner1Id={data.union.partner1Id}
                partner2Id={data.union.partner2Id}
                initialChildren={data.union.children}
                onSaved={onDataChanged}
              />
            )}
            {data.familyId && (
              <UnionNotesEditor
                treeId={treeId}
                familyId={data.familyId}
                initialNotes={data.notes ?? ""}
                onSaved={onDataChanged}
              />
            )}
            {data.familyId && (
              <div className="danger-zone">
                {!confirmingDeleteUnion ? (
                  <button type="button" className="delete-button" onClick={() => setConfirmingDeleteUnion(true)}>
                    {t("infoPanel.deleteUnion")}
                  </button>
                ) : (
                  <div className="delete-confirm">
                    <p>{t("infoPanel.deleteUnionWarning")}</p>
                    {deleteUnionError && <p className="status status-error">{deleteUnionError}</p>}
                    <div className="modal-actions">
                      <button type="button" onClick={() => setConfirmingDeleteUnion(false)} disabled={deletingUnion}>
                        {t("common.cancel")}
                      </button>
                      <button type="button" className="delete-button" onClick={handleDeleteUnion} disabled={deletingUnion}>
                        {deletingUnion ? t("infoPanel.deletingUnion") : t("infoPanel.confirmDeleteUnion")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "relaciones" && data.personId && (
          <RelationsTab treeId={treeId} personId={data.personId} onNavigate={onNavigateToPerson} />
        )}
        {tab === "fotos" && data.personId && <PersonMediaTab treeId={treeId} personId={data.personId} type="PHOTO" />}
        {tab === "documentos" && data.personId && (
          <PersonMediaTab treeId={treeId} personId={data.personId} type="DOCUMENT" />
        )}

        <div className="modal-actions">
          {data.personId && (
            <button type="button" className="info-panel-copy-button" onClick={() => setShowCopyModal(true)}>
              {t("copyPerson.action")}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
      {showCopyModal && data.personId && (
        <CopyPersonModal
          treeId={treeId}
          personId={data.personId}
          personName={data.title}
          onClose={() => setShowCopyModal(false)}
        />
      )}
      {showPhotoLightbox && data.photoUrl && (
        <PhotoLightbox src={data.photoUrl} shape="circle" onClose={() => setShowPhotoLightbox(false)} />
      )}
    </div>
  );
}
