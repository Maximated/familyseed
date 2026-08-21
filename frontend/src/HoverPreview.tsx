import { createPortal } from "react-dom";
import type { InfoPanelData } from "./InfoPanel";

type Props = {
  data: InfoPanelData;
  x: number;
  y: number;
  flip: boolean;
};

// A lightweight, read-only peek at a person's extended info shown after
// hovering their card for a second (see the timer in wireCardAndUnionClicks)
// — distinct from InfoPanel (the full editable record opened by the card's
// own expand button), which has tabs, edit controls, and a close button
// this one deliberately skips. It disappears the moment the pointer leaves
// the card, so it never needs any of that.
//
// Portaled to document.body (position: fixed, x/y already in viewport
// coordinates — see wireCardAndUnionClicks in TreeView.tsx) instead of
// rendering inline inside the tree canvas: family-chart's own pan/zoom
// transform promotes the canvas to its own GPU compositing layer, and
// backdrop-filter can't blur across that layer boundary in Chromium-based
// browsers with stricter compositing (confirmed in Brave — the exact same
// CSS blurs correctly the moment the element is moved outside that
// subtree). The export popover never showed this bug only because it never
// sits over the canvas in the first place.
export default function HoverPreview({ data, x, y, flip }: Props) {
  return createPortal(
    <div
      className={`hover-preview${flip ? " hover-preview-below" : ""}`}
      style={{ left: x, top: y }}
    >
      <div className="info-panel-header">
        {data.photoUrl ? (
          <img className="info-panel-photo" src={data.photoUrl} alt="" />
        ) : (
          <div className={`info-panel-icon${data.iconClassName ? ` ${data.iconClassName}` : ""}`}>{data.icon}</div>
        )}
        <div className="info-panel-heading">
          <h3 className="info-panel-title name-text">{data.title}</h3>
          {data.subtitle && <p className="info-panel-subtitle name-text">{data.subtitle}</p>}
        </div>
      </div>
      <div className="info-panel-sections">
        {data.sections.map((section) => (
          <div className="info-panel-section" key={section.heading}>
            <h4 className="info-panel-section-heading">{section.heading}</h4>
            <ul className="info-panel-bullets">
              {section.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
