import type { ReactNode } from "react";

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
};

type Props = {
  data: InfoPanelData;
  onClose: () => void;
};

export default function InfoPanel({ data, onClose }: Props) {
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
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
