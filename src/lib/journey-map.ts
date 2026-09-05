import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { JourneyOption } from "./journey";

const layers = ["journey-bleed", "journey-transit", "journey-walk", "journey-stops"];
export function clearJourneyMap(map: MapLibreMap) {
  for (const id of [...layers].reverse()) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ["journey-route", "journey-points"]) if (map.getSource(id)) map.removeSource(id);
}
export function paintJourney(map: MapLibreMap, options: JourneyOption[], selected: string, activeLeg: string | null) {
  if (!map.isStyleLoaded()) return false;
  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: options.flatMap((option) => option.legs.filter((leg) => leg.geometry.length >= 2).map((leg): GeoJSON.Feature => ({ type: "Feature", properties: { id: leg.id, selected: option.id === selected, active: leg.id === activeLeg, mode: leg.mode, color: leg.mode === "walk" ? "#627d62" : leg.mode === "ferry" ? "#317e88" : "#825a78" }, geometry: { type: "LineString", coordinates: leg.geometry } }))) };
  const stops: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: (options.find((o) => o.id === selected)?.legs ?? []).map((leg): GeoJSON.Feature => ({ type: "Feature", properties: { id: leg.id }, geometry: { type: "Point", coordinates: [leg.to.longitude, leg.to.latitude] } })) };
  if (map.getSource("journey-route")) {
    (map.getSource("journey-route") as GeoJSONSource).setData(data);
    (map.getSource("journey-points") as GeoJSONSource).setData(stops); return true;
  }
  map.addSource("journey-route", { type: "geojson", data }); map.addSource("journey-points", { type: "geojson", data: stops });
  const before = map.getLayer("clusters") ? "clusters" : undefined;
  map.addLayer({ id: "journey-bleed", type: "line", source: "journey-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "active"], 17, 10], "line-blur": 5, "line-opacity": ["case", ["get", "selected"], .3, .05] } }, before);
  map.addLayer({ id: "journey-transit", type: "line", source: "journey-route", filter: ["!=", ["get", "mode"], "walk"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-dasharray": [3, 1], "line-opacity": ["case", ["get", "selected"], .8, .13] } }, before);
  map.addLayer({ id: "journey-walk", type: "line", source: "journey-route", filter: ["==", ["get", "mode"], "walk"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4b704f", "line-width": 3.5, "line-dasharray": [1, 1.5], "line-opacity": ["case", ["get", "selected"], .9, .15] } }, before);
  map.addLayer({ id: "journey-stops", type: "circle", source: "journey-points", paint: { "circle-radius": 5, "circle-color": "#f7edda", "circle-stroke-color": "#825a78", "circle-stroke-width": 1.5 } }, before);
  return true;
}
