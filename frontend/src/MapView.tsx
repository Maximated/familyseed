import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchTreeMap, type MapEvent, type MapEventKind } from "./api";
import LocatePlacesView from "./LocatePlacesView";

type Props = {
  treeId: string;
  onNavigateToPerson: (personId: string) => void;
  onClose: () => void;
};

const KIND_COLOR: Record<MapEventKind, string> = {
  BIRTH: "#2d6a4f",
  DEATH: "#6b7280",
  UNION: "#e07a29",
};
const MIXED_COLOR = "#1b4332";
const KIND_SYMBOL: Record<MapEventKind, string> = { BIRTH: "★", DEATH: "✝", UNION: "⚭" };
const KINDS: MapEventKind[] = ["BIRTH", "DEATH", "UNION"];

type Location = { key: string; lat: number; lng: number; place: string; events: MapEvent[] };

// Events at (practically) the same point share one marker — a family tree
// piles dozens of people onto the same village, and stacked markers there
// would hide all but the top one.
function groupByLocation(events: MapEvent[]): Location[] {
  const byKey = new Map<string, Location>();
  for (const event of events) {
    const key = `${event.lat.toFixed(4)},${event.lng.toFixed(4)}`;
    const existing = byKey.get(key);
    if (existing) existing.events.push(event);
    else byKey.set(key, { key, lat: event.lat, lng: event.lng, place: event.place, events: [event] });
  }
  return [...byKey.values()];
}

export default function MapView({ treeId, onNavigateToPerson, onClose }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [unlocated, setUnlocated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleKinds, setVisibleKinds] = useState<Set<MapEventKind>>(new Set(KINDS));
  const [showPaths, setShowPaths] = useState(false);
  const [showLocate, setShowLocate] = useState(false);

  function loadEvents() {
    return fetchTreeMap(treeId)
      .then((data) => {
        setEvents(data.events);
        setUnlocated(data.unlocated);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    loadEvents().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView([40, -3.7], 3);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const visibleEvents = useMemo(() => events.filter((e) => visibleKinds.has(e.kind)), [events, visibleKinds]);

  // Re-fit only when the data first arrives, not on every filter toggle —
  // toggling a filter shouldn't throw away wherever the user had zoomed to.
  const fittedRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (showPaths) {
      // A faint birth → death line per person: where each life started and
      // ended, which is what makes family migrations visible at a glance.
      const births = new Map(events.filter((e) => e.kind === "BIRTH").map((e) => [e.individualId, e]));
      for (const death of events.filter((e) => e.kind === "DEATH")) {
        const birth = births.get(death.individualId);
        if (!birth || (birth.lat === death.lat && birth.lng === death.lng)) continue;
        L.polyline(
          [
            [birth.lat, birth.lng],
            [death.lat, death.lng],
          ],
          { color: MIXED_COLOR, weight: 1.5, opacity: 0.45, dashArray: "4 4", interactive: false },
        ).addTo(layer);
      }
    }

    const locations = groupByLocation(visibleEvents);
    for (const location of locations) {
      const kinds = new Set(location.events.map((e) => e.kind));
      const color = kinds.size === 1 ? KIND_COLOR[location.events[0].kind] : MIXED_COLOR;
      const marker = L.circleMarker([location.lat, location.lng], {
        radius: 6 + Math.min(location.events.length, 20) * 0.6,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      });
      marker.bindTooltip(`${location.place} · ${location.events.length}`);
      marker.bindPopup(() => buildPopup(location), { maxWidth: 280 });
      marker.addTo(layer);
    }

    if (!fittedRef.current && locations.length > 0) {
      fittedRef.current = true;
      const bounds = L.latLngBounds(locations.map((l) => [l.lat, l.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
    // buildPopup only reads stable props/t — no need to re-run on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, visibleEvents, showPaths]);

  // Built as real DOM nodes (not an HTML string) so names/places from the
  // tree never get interpreted as markup, and each row can carry its own
  // click handler.
  function buildPopup(location: Location): HTMLElement {
    const root = document.createElement("div");
    root.className = "map-popup";
    const title = document.createElement("strong");
    title.textContent = location.place;
    root.appendChild(title);
    const list = document.createElement("ul");
    const sorted = [...location.events].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
    for (const event of sorted) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${KIND_SYMBOL[event.kind]} ${event.label}${event.dateText ? ` (${event.dateText})` : ""}`;
      button.title = t(`map.kind.${event.kind}`);
      button.addEventListener("click", () => {
        onNavigateToPerson(event.individualId);
        onClose();
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    root.appendChild(list);
    return root;
  }

  function toggleKind(kind: MapEventKind) {
    setVisibleKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel map-view-panel" onClick={(e) => e.stopPropagation()}>
        <div className="map-view-header">
          <h2>{t("map.title")}</h2>
          <div className="map-view-filters">
            {KINDS.map((kind) => (
              <label key={kind} className="map-view-filter">
                <input type="checkbox" checked={visibleKinds.has(kind)} onChange={() => toggleKind(kind)} />
                <span className="map-view-swatch" style={{ background: KIND_COLOR[kind] }} />
                {t(`map.kind.${kind}`)}
              </label>
            ))}
            <label className="map-view-filter">
              <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} />
              {t("map.paths")}
            </label>
          </div>
        </div>

        <div className="map-view-canvas-wrap">
          <div ref={containerRef} className="map-view-canvas" />
          {!loading && !error && events.length === 0 && <p className="map-view-empty">{t("map.empty")}</p>}
        </div>

        {loading && <p className="status">{t("common.loading")}</p>}
        {error && <p className="status status-error">{error}</p>}
        {unlocated > 0 && (
          <p className="field-hint">
            {t("map.unlocated", { count: unlocated })}{" "}
            <button type="button" className="union-notes-edit-link" onClick={() => setShowLocate(true)}>
              {t("map.locateLink")}
            </button>
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
      {showLocate && <LocatePlacesView treeId={treeId} onLocated={loadEvents} onClose={() => setShowLocate(false)} />}
    </div>
  );
}
