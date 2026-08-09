export type InfoPanelData = {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string }[];
};

type Props = {
  data: InfoPanelData;
  onClose: () => void;
};

export default function InfoPanel({ data, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel info-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="info-panel-title name-text">{data.title}</h2>
        {data.subtitle && <p className="info-panel-subtitle name-text">{data.subtitle}</p>}
        <dl className="info-panel-rows">
          {data.rows.map((row) => (
            <div className="info-panel-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
