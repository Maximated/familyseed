import { useLayoutEffect, useRef, useState } from "react";
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
  const elRef = useRef<HTMLDivElement>(null);
  // `flip` from the caller is only a cheap pre-render guess (card distance
  // from the *container's* top, not this popup's own real height — see
  // wireCardAndUnionClicks) — good enough to avoid a visible flip on the
  // common case, but a popup with a lot of content (many relations, a long
  // bio) can be taller than that guess accounted for and still clip off the
  // top of the actual viewport. Measuring the real rendered box after
  // mount and correcting once, before paint, catches that regardless of
  // content length — the guess is just what the very first layout starts
  // from.
  const [below, setBelow] = useState(flip);
  // Guards against ever correcting more than once per mount — without it,
  // a popup tall enough to clip in *both* directions (taller than the
  // viewport itself) would flip back and forth forever instead of just
  // picking a side and settling.
  const correctedRef = useRef(false);
  useLayoutEffect(() => {
    setBelow(flip);
    correctedRef.current = false;
  }, [flip, data]);
  useLayoutEffect(() => {
    if (correctedRef.current) return;
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    if (!below && rect.top < margin) {
      correctedRef.current = true;
      setBelow(true);
    } else if (below && rect.bottom > window.innerHeight - margin) {
      correctedRef.current = true;
      setBelow(false);
    }
  }, [below]);

  return createPortal(
    <div
      ref={elRef}
      className={`hover-preview${below ? " hover-preview-below" : ""}`}
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
