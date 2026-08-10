import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PersonMediaTab from "./PersonMedia";
import RelationsTab from "./RelationsTab";
import UnionNotesEditor from "./UnionNotesEditor";

export type InfoPanelSection = {
  heading: string;
  items: string[];
};

export type InfoPanelData = {
  icon: ReactNode;
  iconClassName?: string;
  title: string;
  subtitle?: string;
  sections: InfoPanelSection[];
  // Only set for a person (not a union) — enables the Relaciones/Fotos/Documentos tabs.
  personId?: string;
  // Only set for a union (not a person) — enables the inline notes editor.
  familyId?: string;
  notes?: string | null;
};

type Props = {
  data: InfoPanelData;
  onClose: () => void;
  onNavigateToPerson: (personId: string) => void;
};

type Tab = "ficha" | "relaciones" | "fotos" | "documentos";

export default function InfoPanel({ data, onClose, onNavigateToPerson }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("ficha");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel info-panel" onClick={(e) => e.stopPropagation()}>
        <div className="info-panel-header">
          <div className={`info-panel-icon${data.iconClassName ? ` ${data.iconClassName}` : ""}`}>{data.icon}</div>
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
            {data.sections.map((section) => (
              <div className="info-panel-section" key={section.heading}>
                <h3 className="info-panel-section-heading">{section.heading}</h3>
                <ul className="info-panel-bullets">
                  {section.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            {data.familyId && <UnionNotesEditor familyId={data.familyId} initialNotes={data.notes ?? ""} />}
          </div>
        )}
        {tab === "relaciones" && data.personId && <RelationsTab personId={data.personId} onNavigate={onNavigateToPerson} />}
        {tab === "fotos" && data.personId && <PersonMediaTab personId={data.personId} type="PHOTO" />}
        {tab === "documentos" && data.personId && <PersonMediaTab personId={data.personId} type="DOCUMENT" />}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
