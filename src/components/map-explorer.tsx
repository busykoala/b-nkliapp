"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getBenchDetail, getMapFeatures } from "@/app/actions/map";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail, MapFeature, MapFilters, PlaceResult } from "@/lib/types";
import { BenchSheet } from "./bench-sheet";
import { FilterPanel } from "./filter-panel";
import { SearchBox } from "./search-box";
import { AddBenchDialog } from "./add-bench-dialog";
import { AppMenu } from "./app-menu";
import { getDaylightState } from "@/lib/sun";
import {
  benchWashIconExpression,
  BRIDGE_FILTER,
  BUILDING_PATTERN_ART,
  buildingPatternExpression,
  CORE_MAP_ART,
  DECORATIVE_MAP_ART,
  FOREST_FILTER,
  GLACIER_FILTER,
  loadWatercolorMapStyle,
  LOCAL_TRANSIT_FILTER,
  MAJOR_TRANSIT_FILTER,
  mapDayPalette,
  mapSunLighting,
  MINIMAL_MAP_STYLE,
  OPEN_LAND_FILTER,
  PAINTERLY_ROAD_FILTER,
  type MapArtImage,
  TRANSIT_MAP_ART,
  TRANSIT_ZOOM,
  transitIconExpression,
  transitIconScaleExpression,
} from "@/lib/watercolor-map";

const JourneyPlanner = dynamic(() => import("./journey-planner").then((m) => m.JourneyPlanner), {
  ssr: false, loading: () => <aside className="journey-panel storybook-panel" role="status">Dein Reisejournal wird geöffnet …</aside>,
});

function circlePolygon(longitude: number, latitude: number, radiusMeters: number) {
  const points = 64;
  const coordinates = Array.from({ length: points + 1 }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    const latOffset = (radiusMeters / 111320) * Math.sin(angle);
    const lonOffset = (radiusMeters / (111320 * Math.cos(latitude * Math.PI / 180))) * Math.cos(angle);
    return [longitude + lonOffset, latitude + latOffset];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coordinates] } };
}

function featureCollection(features: MapFeature[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((feature) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [feature.longitude, feature.latitude] },
      properties: feature,
    })),
  };
}

function selectedBenchFeature(bench?: BenchDetail | null) {
  return {
    type: "FeatureCollection" as const,
    features: bench ? [{
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [bench.longitude, bench.latitude] },
      properties: {
        sunnyNow: bench.sunnyNow,
        verificationStatus: bench.verificationStatus,
      },
    }] : [],
  };
}

type UserPosition = { longitude: number; latitude: number; accuracy: number };

const countryWash = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[5.45, 45.55], [10.9, 45.55], [10.9, 48.05], [5.45, 48.05], [5.45, 45.55]]],
  },
};

function sourceForLayer(map: MapLibreMap, sourceLayer: string) {
  const layer = map.getStyle().layers.find((item) => "source-layer" in item && item["source-layer"] === sourceLayer && "source" in item);
  return layer && "source" in layer && typeof layer.source === "string" ? layer.source : null;
}

async function loadMapArt(map: MapLibreMap, assets: MapArtImage[]) {
  await Promise.allSettled(assets.map(async (asset) => {
    if (map.hasImage(asset.name)) return;
    const response = await map.loadImage(asset.url);
    if (!map.hasImage(asset.name)) map.addImage(asset.name, response.data, { pixelRatio: asset.pixelRatio });
  }));
}

function addDecorativeMapLayers(map: MapLibreMap) {
  const reliefSource = sourceForLayer(map, "hillshade");
  const landSource = sourceForLayer(map, "landcover");
  const landuseSource = sourceForLayer(map, "landuse");
  const waterSource = sourceForLayer(map, "water");
  const buildingSource = sourceForLayer(map, "building");
  const routeSource = sourceForLayer(map, "transportation");
  const aerodromeSource = sourceForLayer(map, "aerodrome_label");
  const available = new Set(DECORATIVE_MAP_ART.filter((asset) => map.hasImage(asset.name)).map((asset) => asset.name));
  const firstSymbol = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  const firstRelief = map.getStyle().layers.find((layer) => "source-layer" in layer && layer["source-layer"] === "hillshade")?.id;
  const firstGround = firstRelief ?? map.getStyle().layers.find((layer) => "source-layer" in layer && layer["source-layer"] === "landcover")?.id ?? firstSymbol;
  if (landSource && map.hasImage("benchly-field-wash") && !map.getSource("benchly-country-wash")) {
    map.addSource("benchly-country-wash", { type: "geojson", data: countryWash });
    map.addLayer({
      id: "benchly-country-wash", type: "fill", source: "benchly-country-wash", minzoom: 5,
      paint: { "fill-color": "#ead7a1", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, .07, 11, .08, 14, .05, 17, .025, 19, .015], "fill-pattern": "benchly-field-wash" },
    }, firstGround);
  }
  if (reliefSource && map.hasImage("benchly-mountain-wash") && !map.getLayer("benchly-mountain-wash")) map.addLayer({
    id: "benchly-mountain-wash", type: "fill", source: reliefSource, "source-layer": "hillshade", minzoom: 6,
    paint: { "fill-pattern": "benchly-mountain-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, .055, 10.5, .085, 13, .065, 16, .03, 19, .012] },
  }, map.getLayer("landcover") ? "landcover" : firstSymbol);
  if (landSource && map.hasImage("benchly-land-wash") && !map.getLayer("benchly-land-wash")) map.addLayer({
    id: "benchly-land-wash", type: "fill", source: landSource, "source-layer": "landcover", minzoom: 6,
    paint: { "fill-pattern": "benchly-land-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, .035, 12, .065, 15, .045, 18, .022] },
  }, map.getLayer("landcover_casing") ? "landcover_casing" : undefined);
  if (landSource && map.hasImage("benchly-field-wash") && !map.getLayer("benchly-field-wash")) map.addLayer({
    id: "benchly-field-wash", type: "fill", source: landSource, "source-layer": "landcover", minzoom: 6,
    filter: OPEN_LAND_FILTER,
    paint: { "fill-pattern": "benchly-field-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, .14, 12, .2, 15, .14, 18, .065] },
  }, map.getLayer("landcover_casing") ? "landcover_casing" : undefined);
  if (landuseSource && map.hasImage("benchly-field-wash") && !map.getLayer("benchly-meadow-wash")) map.addLayer({
    id: "benchly-meadow-wash", type: "fill", source: landuseSource, "source-layer": "landuse", minzoom: 8,
    paint: { "fill-pattern": "benchly-field-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, .07, 12, .12, 15, .085, 18, .04] },
  }, map.getLayer("landcover_casing") ? "landcover_casing" : undefined);
  if (landSource && map.hasImage("benchly-forest-relief") && !map.getLayer("benchly-forest-relief")) map.addLayer({
    id: "benchly-forest-relief", type: "fill", source: landSource, "source-layer": "landcover", minzoom: 6,
    filter: FOREST_FILTER,
    paint: { "fill-pattern": "benchly-forest-relief", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, .18, 10.5, .3, 13, .24, 16, .13, 19, .07] },
  }, map.getLayer("landcover_casing") ? "landcover_casing" : undefined);
  if (landSource && map.hasImage("benchly-forest-stamp") && !map.getLayer("benchly-forest-stamps")) map.addLayer({
    id: "benchly-forest-stamps", type: "fill", source: landSource, "source-layer": "landcover", minzoom: 9.5,
    filter: FOREST_FILTER, paint: { "fill-pattern": "benchly-forest-stamp", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, .07, 12.5, .13, 16, .06, 19, .025] },
  }, map.getLayer("landcover_casing") ? "landcover_casing" : undefined);
  if (landSource && map.hasImage("benchly-snow-wash") && !map.getLayer("benchly-snow-wash")) map.addLayer({
    id: "benchly-snow-wash", type: "fill", source: landSource, "source-layer": "landcover", minzoom: 6,
    filter: GLACIER_FILTER,
    paint: { "fill-pattern": "benchly-snow-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, .2, 12, .3, 18, .38] },
  }, map.getLayer("water") ? "water" : firstSymbol);
  if (waterSource && map.hasImage("benchly-water-wash") && !map.getLayer("benchly-water-wash")) map.addLayer({
    id: "benchly-water-wash", type: "fill", source: waterSource, "source-layer": "water", minzoom: 5,
    paint: { "fill-pattern": "benchly-water-wash", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, .18, 12, .27, 17, .34] },
  }, map.getLayer("water_outline") ? "water_outline" : undefined);
  if (buildingSource && BUILDING_PATTERN_ART.some((asset) => available.has(asset.name)) && !map.getLayer("benchly-building-wash")) map.addLayer({
    id: "benchly-building-wash", type: "fill", source: buildingSource, "source-layer": "building", minzoom: 13.5,
    paint: { "fill-pattern": buildingPatternExpression(available), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, .12, 16, .21, 19, .27] },
  }, map.getLayer("building_casing") ? "building_casing" : undefined);
  if (routeSource && map.hasImage("benchly-road-brush") && !map.getLayer("benchly-road-brush")) map.addLayer({
    id: "benchly-road-brush", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 10,
    filter: PAINTERLY_ROAD_FILTER,
    paint: {
      "line-pattern": "benchly-road-brush", "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, .18, 14, .32, 16, .27, 19, .18],
      "line-width": ["interpolate", ["linear"], ["zoom"],
        10, ["*", .32, ["match", ["get", "class"], ["motorway", "trunk"], 22, ["primary", "secondary"], 16, "tertiary", 12, ["residential", "service", "street"], 9, 7]],
        14, ["*", .65, ["match", ["get", "class"], ["motorway", "trunk"], 22, ["primary", "secondary"], 16, "tertiary", 12, ["residential", "service", "street"], 9, 7]],
        17, ["match", ["get", "class"], ["motorway", "trunk"], 22, ["primary", "secondary"], 16, "tertiary", 12, ["residential", "service", "street"], 9, 7],
        19, ["*", 1.3, ["match", ["get", "class"], ["motorway", "trunk"], 22, ["primary", "secondary"], 16, "tertiary", 12, ["residential", "service", "street"], 9, 7]],
      ],
    },
  }, firstSymbol);
  if (routeSource && map.hasImage("benchly-bridge-deck-pattern") && !map.getLayer("benchly-bridge-art")) map.addLayer({
    id: "benchly-bridge-art", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 12,
    filter: BRIDGE_FILTER,
    paint: {
      "line-pattern": "benchly-bridge-deck-pattern", "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, .42, 15, .72, 19, .88],
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 15, 7, 17, 12, 19, 18],
    },
  }, firstSymbol);
  if (aerodromeSource && map.hasImage("benchly-airport-airplane") && !map.getLayer("benchly-airport-airplane")) map.addLayer({
    id: "benchly-airport-airplane", type: "symbol", source: aerodromeSource, "source-layer": "aerodrome_label", minzoom: 11,
    filter: ["!=", ["get", "class"], "helipad"],
    layout: {
      "icon-image": "benchly-airport-airplane",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, .48, 14, .72, 18, .86],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-padding": 4,
    },
    paint: { "icon-opacity": .84 },
  }, map.getLayer("aerodrome_label") ? "aerodrome_label" : firstSymbol);
}

function addPainterlyVectorLayers(map: MapLibreMap) {
  const styleLayers = map.getStyle().layers;
  const firstSymbol = styleLayers.find((layer) => layer.type === "symbol")?.id;
  const firstRoute = styleLayers.find((layer) => "source-layer" in layer && layer["source-layer"] === "transportation")?.id;
  const landSource = sourceForLayer(map, "landcover");
  const waterSource = sourceForLayer(map, "water");
  const waterwaySource = sourceForLayer(map, "waterway");
  const buildingSource = sourceForLayer(map, "building");
  const routeSource = sourceForLayer(map, "transportation");

  if (landSource && !map.getLayer("benchly-land-soft-edge")) map.addLayer({
    id: "benchly-land-soft-edge", type: "line", source: landSource, "source-layer": "landcover", minzoom: 5,
    paint: {
      "line-color": ["case", GLACIER_FILTER as ExpressionSpecification, "#c8dcda", FOREST_FILTER as ExpressionSpecification, "#728b6f", "#d8bf88"],
      "line-opacity": ["case", GLACIER_FILTER as ExpressionSpecification, .13, FOREST_FILTER as ExpressionSpecification, 0, .07],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 7, 12, 17, 18, 31], "line-blur": 10,
    },
  }, map.getLayer("water") ? "water" : firstSymbol);
  if (landSource && !map.getLayer("benchly-glacier-feather")) map.addLayer({
    id: "benchly-glacier-feather", type: "line", source: landSource, "source-layer": "landcover", minzoom: 6,
    filter: GLACIER_FILTER,
    paint: { "line-color": "#c1d9dc", "line-opacity": .11, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 8, 12, 18, 17, 32], "line-blur": 10 },
  }, map.getLayer("water") ? "water" : firstSymbol);
  if (waterSource && !map.getLayer("benchly-water-shore-bleed")) map.addLayer({
    id: "benchly-water-shore-bleed", type: "line", source: waterSource, "source-layer": "water", minzoom: 5,
    paint: { "line-color": "#4f969a", "line-opacity": .13, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5, 12, 11, 18, 24], "line-blur": 7 },
  }, map.getLayer("building") ? "building" : firstSymbol);
  if (waterSource && !map.getLayer("benchly-water-ink")) map.addLayer({
    id: "benchly-water-ink", type: "line", source: waterSource, "source-layer": "water", minzoom: 7,
    paint: { "line-color": "#376f76", "line-opacity": .16, "line-width": ["interpolate", ["linear"], ["zoom"], 7, .45, 17, 1.15], "line-blur": .75, "line-dasharray": [2.4, .35, .7, .28] },
  }, map.getLayer("building") ? "building" : firstSymbol);
  if (waterwaySource && !map.getLayer("benchly-river-bleed")) map.addLayer({
    id: "benchly-river-bleed", type: "line", source: waterwaySource, "source-layer": "waterway", minzoom: 6,
    paint: { "line-color": "#3f8e95", "line-opacity": .2, "line-width": ["interpolate", ["linear"], ["zoom"], 6, .8, 12, 2.2, 18, 7], "line-blur": 2.2 },
  }, map.getLayer("building") ? "building" : firstSymbol);
  if (buildingSource && !map.getLayer("benchly-building-shadow")) map.addLayer({
    id: "benchly-building-shadow", type: "fill", source: buildingSource, "source-layer": "building", minzoom: 13,
    paint: { "fill-color": "#694c42", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, .025, 17, .09], "fill-translate": [1.4, 1.8], "fill-translate-anchor": "map", "fill-antialias": true },
  }, map.getLayer("building") ? "building" : firstSymbol);
  if (buildingSource && !map.getLayer("benchly-building-sketch")) map.addLayer({
    id: "benchly-building-sketch", type: "line", source: buildingSource, "source-layer": "building", minzoom: 14,
    paint: { "line-color": "#684c40", "line-opacity": .24, "line-width": ["interpolate", ["linear"], ["zoom"], 14, .4, 18, 1.05], "line-blur": .65, "line-dasharray": [1.1, .4] },
  }, map.getLayer("building_casing") ? "building_casing" : firstSymbol);
  if (routeSource && !map.getLayer("benchly-road-bleed")) map.addLayer({
    id: "benchly-road-bleed", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 6,
    filter: PAINTERLY_ROAD_FILTER,
    paint: { "line-color": "#b78057", "line-opacity": .045, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 12, 5, 16, 10, 19, 17], "line-blur": 6 },
  }, firstRoute);
  if (routeSource && !map.getLayer("benchly-path-ink")) map.addLayer({
    id: "benchly-path-ink", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 11,
    filter: ["match", ["get", "class"], ["path", "path_construction", "footway", "footway_construction", "trail", "via_ferrata"], true, false],
    paint: { "line-color": "#765b43", "line-opacity": .38, "line-width": ["interpolate", ["linear"], ["zoom"], 11, .45, 18, 1.25], "line-blur": .4, "line-dasharray": [1.1, 1.45] },
  }, firstSymbol);
  if (routeSource && !map.getLayer("benchly-bridge-shadow")) map.addLayer({
    id: "benchly-bridge-shadow", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 10,
    filter: BRIDGE_FILTER,
    paint: { "line-color": "#5f4741", "line-opacity": .21, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 9, 19, 15], "line-blur": 3, "line-translate": [2, 2], "line-translate-anchor": "map" },
  }, firstSymbol);
  if (routeSource && !map.getLayer("benchly-bridge-deck")) map.addLayer({
    id: "benchly-bridge-deck", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 10,
    filter: BRIDGE_FILTER,
    paint: { "line-color": "#edcf94", "line-opacity": .48, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 5.5, 19, 9.5], "line-blur": 1.2 },
  }, firstSymbol);
  if (routeSource && !map.getLayer("benchly-bridge-ink")) map.addLayer({
    id: "benchly-bridge-ink", type: "line", source: routeSource, "source-layer": "transportation", minzoom: 11,
    filter: BRIDGE_FILTER,
    paint: { "line-color": "#6b4c42", "line-opacity": .54, "line-width": ["interpolate", ["linear"], ["zoom"], 11, .55, 18, 1.15], "line-blur": .25, "line-dasharray": [1.2, .65] },
  }, firstSymbol);
}

function addTransitLayers(map: MapLibreMap) {
  const poiSource = sourceForLayer(map, "poi");
  const available = new Set(TRANSIT_MAP_ART.filter((asset) => map.hasImage(asset.name)).map((asset) => asset.name));
  const hasVehicle = TRANSIT_MAP_ART.some((asset) => asset.name !== "benchly-wash-transit" && available.has(asset.name));
  if (!poiSource || !hasVehicle) return;
  const before = map.getLayer("clusters") ? "clusters" : undefined;
  const textField: ExpressionSpecification = ["case", ["has", "name:latin"], ["get", "name:latin"], ""];
  if (available.has("benchly-wash-transit") && !map.getLayer("benchly-major-transit-wash")) map.addLayer({
    id: "benchly-major-transit-wash", type: "symbol", source: poiSource, "source-layer": "poi", minzoom: TRANSIT_ZOOM.major,
    filter: MAJOR_TRANSIT_FILTER,
    layout: { "icon-image": "benchly-wash-transit", "icon-size": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.major, .44, 18, .58], "icon-allow-overlap": false },
    paint: { "icon-opacity": .7 },
  }, before);
  if (available.has("benchly-wash-transit") && !map.getLayer("benchly-local-transit-wash")) map.addLayer({
    id: "benchly-local-transit-wash", type: "symbol", source: poiSource, "source-layer": "poi", minzoom: TRANSIT_ZOOM.local,
    filter: LOCAL_TRANSIT_FILTER,
    layout: { "icon-image": "benchly-wash-transit", "icon-size": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.local, ["*", .38, transitIconScaleExpression()], 18, ["*", .52, transitIconScaleExpression()]], "icon-allow-overlap": false },
    paint: { "icon-opacity": .64 },
  }, before);
  if (!map.getLayer("benchly-major-transit")) map.addLayer({
    id: "benchly-major-transit", type: "symbol", source: poiSource, "source-layer": "poi", minzoom: TRANSIT_ZOOM.major,
    filter: MAJOR_TRANSIT_FILTER,
    layout: {
      "icon-image": transitIconExpression(available), "icon-size": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.major, .36, 18, .56],
      "icon-allow-overlap": false, "icon-optional": false, "text-field": textField, "text-font": ["Frutiger Neue Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 13], "text-anchor": "bottom-left", "text-offset": [.6, .2], "text-optional": true,
    },
    paint: { "icon-opacity": .86, "text-color": "#5c4450", "text-opacity": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.labels, 0, 16.3, .75], "text-halo-color": "#f5e9cb", "text-halo-width": 1.4 },
  }, before);
  if (!map.getLayer("benchly-local-transit")) map.addLayer({
    id: "benchly-local-transit", type: "symbol", source: poiSource, "source-layer": "poi", minzoom: TRANSIT_ZOOM.local,
    filter: LOCAL_TRANSIT_FILTER,
    layout: {
      "icon-image": transitIconExpression(available), "icon-size": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.local, ["*", .31, transitIconScaleExpression()], 18, ["*", .5, transitIconScaleExpression()]],
      "icon-allow-overlap": false, "icon-optional": false, "text-field": textField, "text-font": ["Frutiger Neue Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 16, 9, 18, 12], "text-anchor": "bottom-left", "text-offset": [.55, .15], "text-optional": true,
    },
    paint: { "icon-opacity": .86, "text-color": "#5c4450", "text-opacity": ["interpolate", ["linear"], ["zoom"], TRANSIT_ZOOM.labels, 0, 16.3, .72], "text-halo-color": "#f5e9cb", "text-halo-width": 1.3 },
  }, before);
}

function addCoreArtLayers(map: MapLibreMap) {
  const available = new Set(CORE_MAP_ART.filter((asset) => map.hasImage(asset.name)).map((asset) => asset.name));
  if (available.has("benchly-wash-cluster") && !map.getLayer("benchly-cluster-art")) map.addLayer({
    id: "benchly-cluster-art", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "cluster"],
    layout: { "icon-image": "benchly-wash-cluster", "icon-size": ["interpolate", ["linear"], ["get", "count"], 2, .4, 50, .56, 500, .78], "icon-allow-overlap": true },
    paint: { "icon-opacity": .96 },
  }, "cluster-count");
  const hasBenchWash = ["benchly-wash-sunny", "benchly-wash-shade", "benchly-wash-neutral", "benchly-wash-unverified"]
    .some((name) => available.has(name));
  if (hasBenchWash && !map.getLayer("benchly-bench-washes")) map.addLayer({
    id: "benchly-bench-washes", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "bench"],
    layout: { "icon-image": benchWashIconExpression(available), "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .36, 13, .46, 18, .62], "icon-offset": [0, 4], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-opacity": .82 },
  });
  if (available.has("benchly-bench") && !map.getLayer("benchly-benches-art")) map.addLayer({
    id: "benchly-benches-art", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "bench"],
    layout: { "icon-image": "benchly-bench", "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .3, 13, .4, 18, .58], "icon-offset": [0, -2], "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-opacity": .94 },
  });
  if (available.has("benchly-wash-selected") && !map.getLayer("benchly-selected-wash")) map.addLayer({
    id: "benchly-selected-wash", type: "symbol", source: "selected-bench",
    layout: { "icon-image": "benchly-wash-selected", "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .48, 13, .62, 18, .82], "icon-offset": [0, 4], "icon-allow-overlap": true },
    paint: { "icon-opacity": .86 },
  });
  if (available.has("benchly-bench") && !map.getLayer("benchly-selected-bench")) map.addLayer({
    id: "benchly-selected-bench", type: "symbol", source: "selected-bench",
    layout: { "icon-image": "benchly-bench", "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .34, 13, .46, 18, .64], "icon-offset": [0, -2], "icon-allow-overlap": true },
  });
  if (available.has("benchly-wash-cluster")) map.setPaintProperty("clusters", "circle-opacity", .025);
  if (available.has("benchly-bench")) {
    map.setPaintProperty("benches", "circle-opacity", 0);
    map.setPaintProperty("selected-bench-core", "circle-opacity", 0);
  }
  if (available.has("benchly-wash-selected")) map.setPaintProperty("selected-bench-halo", "circle-opacity", 0);
}

function addCoreMapLayers(map: MapLibreMap, initialFeatures: MapFeature[] = []) {
  map.addSource("benchly", { type: "geojson", data: featureCollection(initialFeatures) });
  map.addLayer({ id: "clusters", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], paint: { "circle-color": "#80513f", "circle-opacity": .9, "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 15, 50, 21, 500, 28], "circle-stroke-width": 3, "circle-stroke-color": "#f4dfb6", "circle-blur": .08 } });
  map.addLayer({ id: "cluster-count", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], layout: { "text-field": ["to-string", ["get", "count"]], "text-font": ["Frutiger Neue Regular"], "text-size": 12 }, paint: { "text-color": "#fff4d7", "text-halo-color": "#684535", "text-halo-width": .4 } });
  map.addLayer({ id: "bench-hits", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-radius": 22, "circle-opacity": 0 } });
  map.addLayer({ id: "benches", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-color": ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", ["==", ["get", "sunnyNow"], false], "#3e7464", "#9b927d"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 9, 18, 14], "circle-stroke-width": 3, "circle-stroke-color": "#fff4d8", "circle-blur": .06 } });
  map.addSource("selected-bench", { type: "geojson", data: selectedBenchFeature() });
  map.addLayer({ id: "selected-bench-halo", type: "circle", source: "selected-bench", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 18, 18, 25], "circle-color": "#fff1c9", "circle-opacity": .62, "circle-stroke-width": 3, "circle-stroke-color": "#654d39", "circle-blur": .1 } });
  map.addLayer({ id: "selected-bench-core", type: "circle", source: "selected-bench", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 9, 18, 15], "circle-color": ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", ["==", ["get", "sunnyNow"], false], "#3e7464", "#9b927d"], "circle-stroke-width": 4, "circle-stroke-color": "#fff4d8" } });
  map.addSource("user-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("user-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("add-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "user-accuracy", type: "fill", source: "user-accuracy", paint: { "fill-color": "#2d79c7", "fill-opacity": .12 } });
  map.addLayer({ id: "user-position", type: "circle", source: "user-position", paint: { "circle-color": "#2878c8", "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
  map.addLayer({ id: "add-position", type: "circle", source: "add-position", paint: { "circle-color": "#d58a32", "circle-radius": 10, "circle-stroke-width": 3, "circle-stroke-color": "#fff4d8" } });
}

function applyMapAtmosphere(map: MapLibreMap) {
  const center = map.getCenter();
  const { phase, altitude, azimuth } = getDaylightState(new Date(), center.lat, center.lng);
  const palette = mapDayPalette(phase);
  const sunlight = mapSunLighting(altitude, azimuth);
  const reliefTranslate: [number, number] = [sunlight.shadowTranslate[0] * 3.5, sunlight.shadowTranslate[1] * 3.5];
  map.getContainer().dataset.phase = phase;
  map.getContainer().style.setProperty("--map-sun-angle", `${sunlight.directionDegrees.toFixed(1)}deg`);
  if (map.getLayer("background")) map.setPaintProperty("background", "background-color", palette.background);
  if (map.getLayer("hillshade_grey")) {
    const shadowOpacity = phase === "night" ? .085 : sunlight.shadowOpacity;
    map.setPaintProperty("hillshade_grey", "fill-opacity", ["interpolate", ["linear"], ["zoom"],
      5, shadowOpacity * .72, 11, shadowOpacity, 16, shadowOpacity * 1.28, 19, shadowOpacity * 1.45,
    ]);
    map.setPaintProperty("hillshade_grey", "fill-translate", sunlight.shadowTranslate);
    map.setPaintProperty("hillshade_grey", "fill-translate-anchor", "map");
  }
  if (map.getLayer("hillshade_yellow")) {
    const highlightOpacity = phase === "night" ? 0 : sunlight.highlightOpacity;
    map.setPaintProperty("hillshade_yellow", "fill-opacity", ["interpolate", ["linear"], ["zoom"],
      5, highlightOpacity * .75, 12, highlightOpacity, 17, highlightOpacity * 1.18,
    ]);
  }
  for (const layer of ["benchly-building-shadow", "benchly-bridge-shadow"]) {
    if (!map.getLayer(layer)) continue;
    map.setPaintProperty(layer, layer === "benchly-building-shadow" ? "fill-translate" : "line-translate", reliefTranslate);
    map.setPaintProperty(layer, layer === "benchly-building-shadow" ? "fill-translate-anchor" : "line-translate-anchor", "map");
  }
  map.setLight({
    anchor: "map",
    position: [1.25, sunlight.directionDegrees, sunlight.polarDegrees],
    color: phase === "dusk" ? "#efad76" : phase === "dawn" ? "#f0c58d" : "#fff0c2",
    intensity: phase === "night" ? .08 : .22,
  });
  if (map.getLayer("clusters")) map.setPaintProperty("clusters", "circle-color", palette.cluster);
  if (map.getLayer("benches")) {
    map.setPaintProperty("benches", "circle-stroke-color", palette.markerStroke);
    map.setPaintProperty("benches", "circle-color", ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", ["==", ["get", "sunnyNow"], false], "#3e7464", "#9b927d"]);
  }
  if (map.getLayer("selected-bench-core")) {
    map.setPaintProperty("selected-bench-core", "circle-color", ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", ["==", ["get", "sunnyNow"], false], "#3e7464", "#9b927d"]);
  }
}

function showUserPosition(map: MapLibreMap, position: UserPosition) {
  const positionSource = map.getSource("user-position") as GeoJSONSource | undefined;
  const accuracySource = map.getSource("user-accuracy") as GeoJSONSource | undefined;
  if (!positionSource || !accuracySource) return false;
  positionSource.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [position.longitude, position.latitude] } });
  accuracySource.setData(circlePolygon(position.longitude, position.latitude, position.accuracy));
  map.easeTo({ center: [position.longitude, position.latitude], zoom: Math.max(map.getZoom(), 15) });
  return true;
}

export function MapExplorer({ user }: { user: CurrentUser | null }) {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const detailSequence = useRef(0);
  const featuresRef = useRef<MapFeature[]>([]);
  const pendingPosition = useRef<UserPosition | null>(null);
  const openedFromUrl = useRef<string | null>(null);
  const filtersRef = useRef<MapFilters>({});
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchDetail | null>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const getJourneyMap = useCallback(() => mapRef.current, []);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCoordinates, setAddCoordinates] = useState({ latitude: 46.82, longitude: 8.25 });

  const loadVisible = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++querySequence.current;
    const bounds = map.getBounds();
    try {
      const result = await getMapFeatures({ bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zoom: map.getZoom(), filters: nextFilters });
      if (sequence === querySequence.current) {
        featuresRef.current = result;
        setFeatures(result);
        (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(result));
        setMessage(null);
      }
    } catch {
      if (sequence === querySequence.current) setMessage("Bänke konnten nicht geladen werden.");
    } finally { if (sequence === querySequence.current) setMapLoading(false); }
  }, []);

  const selectBench = useCallback(async (id: string, focusOnMap = false) => {
    setJourneyOpen(false);
    const sequence = ++detailSequence.current;
    setSelectedId(id); setDetailLoading(true); setDetailError(false); setBench(null);
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const detail = await getBenchDetail(id);
        if (!detail) throw new Error("Bench not found");
        if (sequence === detailSequence.current) {
          setBench(detail);
          (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail));
          if (focusOnMap) mapRef.current?.easeTo({ center: [detail.longitude, detail.latitude], zoom: Math.max(mapRef.current.getZoom(), 17), offset: [0, -100], duration: 650 });
        }
        break;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          continue;
        }
        if (sequence === detailSequence.current) setDetailError(true);
      }
    }
    if (sequence === detailSequence.current) setDetailLoading(false);
  }, []);

  const refreshSelectedBench = useCallback(async () => {
    if (!selectedId) return;
    const sequence = ++detailSequence.current;
    try {
      const detail = await getBenchDetail(selectedId);
      if (detail && sequence === detailSequence.current) {
        setBench(detail);
        (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail));
      }
    } catch {
      setMessage("Die neue Angabe ist gespeichert. Die Ansicht aktualisiert sich beim nächsten Öffnen.");
    }
  }, [selectedId]);

  const openAddAt = (latitude: number, longitude: number) => {
    if (!user) {
      setMessage("Zum Eintragen bitte zuerst im Menü anmelden.");
      return;
    }
    setAddCoordinates({ latitude, longitude });
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [longitude, latitude] } });
    setAddOpen(true);
  };

  const locate = (onFound?: (position: UserPosition) => void) => {
    if (!navigator.geolocation) { setMessage("Dein Browser unterstützt die Standortsuche nicht."); return; }
    setMessage("Standort wird gesucht …");
    navigator.geolocation.getCurrentPosition((position) => {
      const { longitude, latitude, accuracy } = position.coords;
      const nextPosition = { longitude, latitude, accuracy };
      const map = mapRef.current;
      if (!map || !showUserPosition(map, nextPosition)) pendingPosition.current = nextPosition;
      if (typeof onFound === "function") onFound(nextPosition);
      window.localStorage.setItem("benchly_location_enabled", "1");
      setMessage(`Standort auf etwa ${Math.round(accuracy)} m genau.`);
      window.setTimeout(() => setMessage(null), 3500);
    }, () => {
      window.localStorage.removeItem("benchly_location_enabled");
      setMessage("Standort nicht verfügbar. Du kannst die Karte weiterhin verwenden.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let moveTimeout: number | undefined;
    let ambientTimer: number | undefined;
    let decorationIdle: number | undefined;
    let decorationTimer: number | undefined;
    let initialFeaturesRequest: Promise<void> | undefined;
    const styleRequest = loadWatercolorMapStyle();
    void Promise.allSettled(CORE_MAP_ART.map(async (asset) => {
      const response = await fetch(asset.url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`map artwork ${response.status}`);
      await response.blob();
    }));

    import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        center: [8.25, 46.82],
        zoom: 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: false,
        style: MINIMAL_MAP_STYLE,
      });
      mapRef.current = map;

      map.getContainer().dataset.basemap = "loading";
      map.getContainer().dataset.mapReady = "false";

      const activateInteractiveLayers = () => {
        if (disposed) return;
        addPainterlyVectorLayers(map);
        addCoreMapLayers(map, featuresRef.current);
        applyMapAtmosphere(map);
        ambientTimer = window.setInterval(() => applyMapAtmosphere(map), 5 * 60 * 1000);
        if (pendingPosition.current && showUserPosition(map, pendingPosition.current)) pendingPosition.current = null;
        const click = (event: MapLayerMouseEvent) => {
          const item = event.features?.[0]?.properties as MapFeature | undefined;
          if (!item) return;
          if (item.kind === "cluster") {
            const nextZoom = Math.min(map.getZoom() + 2, map.getMaxZoom());
            map.easeTo({ center: [item.longitude, item.latitude], zoom: nextZoom, duration: 480 });
          }
          else {
            map.easeTo({ center: [item.longitude, item.latitude], offset: [0, -100], duration: 450 });
            selectBench(item.id);
          }
        };
        map.on("click", "clusters", click);
        map.on("click", "bench-hits", click);
        for (const layer of ["clusters", "cluster-count", "bench-hits"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        let pressTimer: number | undefined;
        let pressStart: { x: number; y: number } | null = null;
        const canvas = map.getCanvas();
        const cancelPress = () => { window.clearTimeout(pressTimer); pressStart = null; };
        const beginPress = (event: PointerEvent) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          pressStart = { x: event.offsetX, y: event.offsetY };
          pressTimer = window.setTimeout(() => {
            if (!pressStart) return;
            const point = map.unproject([pressStart.x, pressStart.y]);
            openAddAt(point.lat, point.lng);
            cancelPress();
          }, 550);
        };
        const movePress = (event: PointerEvent) => { if (pressStart && Math.hypot(event.offsetX - pressStart.x, event.offsetY - pressStart.y) > 12) cancelPress(); };
        canvas.addEventListener("pointerdown", beginPress);
        canvas.addEventListener("pointerup", cancelPress);
        canvas.addEventListener("pointercancel", cancelPress);
        canvas.addEventListener("pointermove", movePress);
        const preventContextMenu = (event: Event) => event.preventDefault();
        canvas.addEventListener("contextmenu", preventContextMenu);
        map.on("remove", () => {
          cancelPress();
          canvas.removeEventListener("pointerdown", beginPress);
          canvas.removeEventListener("pointerup", cancelPress);
          canvas.removeEventListener("pointercancel", cancelPress);
          canvas.removeEventListener("pointermove", movePress);
          canvas.removeEventListener("contextmenu", preventContextMenu);
        });

        initialFeaturesRequest ??= loadVisible(map, filtersRef.current);
        void initialFeaturesRequest;
        setMapReady(true);
        setMapLoading(false);
        map.getContainer().dataset.mapReady = "true";

        void loadMapArt(map, CORE_MAP_ART).then(() => {
          if (!disposed) addCoreArtLayers(map);
        });

        const loadDecorations = () => {
          if (disposed) return;
          void loadMapArt(map, DECORATIVE_MAP_ART).then(() => {
            if (!disposed) addDecorativeMapLayers(map);
          });
        };
        const browserWindow = window as Window & {
          requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
          cancelIdleCallback?: (handle: number) => void;
        };
        if (browserWindow.requestIdleCallback) {
          decorationIdle = browserWindow.requestIdleCallback(loadDecorations, { timeout: 1_500 });
        } else {
          decorationTimer = browserWindow.setTimeout(loadDecorations, 350);
        }

        let transitStarted = false;
        const ensureTransitArt = () => {
          if (disposed || transitStarted || map.getZoom() < 11) return;
          transitStarted = true;
          void loadMapArt(map, TRANSIT_MAP_ART).then(() => {
            if (!disposed) addTransitLayers(map);
          });
        };
        map.on("zoomend", ensureTransitArt);
        ensureTransitArt();
      };

      map.once("load", () => {
        if (disposed) return;
        setMapLoading(false);
        initialFeaturesRequest = loadVisible(map, filtersRef.current);
        void styleRequest.then(({ style, basemap }) => {
          if (disposed) return;
          map.getContainer().dataset.basemap = basemap;
          map.once("style.load", activateInteractiveLayers);
          map.setStyle(style);
        });
      });

      map.on("moveend", () => {
        if (!map.getSource("benchly")) return;
        window.clearTimeout(moveTimeout);
        moveTimeout = window.setTimeout(() => {
          void loadVisible(map, filtersRef.current);
          applyMapAtmosphere(map);
        }, 220);
      });
    });
    return () => {
      disposed = true;
      window.clearTimeout(moveTimeout);
      window.clearTimeout(decorationTimer);
      const browserWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
      if (decorationIdle !== undefined) browserWindow.cancelIdleCallback?.(decorationIdle);
      window.clearInterval(ambientTimer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // Initialization is intentionally one-shot; filter changes are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(features));
  }, [features]);

  useEffect(() => {
    const requestedBench = searchParams.get("bank");
    if (!mapReady || !requestedBench || openedFromUrl.current === requestedBench) return;
    openedFromUrl.current = requestedBench;
    void selectBench(requestedBench, true);
  }, [mapReady, searchParams, selectBench]);

  useEffect(() => {
    filtersRef.current = filters;
    const map = mapRef.current;
    if (map?.isStyleLoaded()) loadVisible(map, filters);
  }, [filters, loadVisible]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    if (window.localStorage.getItem("benchly_location_enabled") === "1") {
      const timer = window.setTimeout(() => locate(), 0);
      return () => window.clearTimeout(timer);
    }
    navigator.permissions?.query({ name: "geolocation" }).then((permission) => { if (permission.state === "granted") locate(); }).catch(() => undefined);
  }, []);

  const choosePlace = (place: PlaceResult) => {
    mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: place.kind === "bench" ? 17 : 14 });
    if (place.kind === "bench" && place.benchId) void selectBench(place.benchId);
  };
  const openAdd = () => {
    const center = mapRef.current?.getCenter();
    if (center) openAddAt(center.lat, center.lng);
  };
  const closeAdd = () => {
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
    setAddOpen(false);
  };
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== false && value !== "").length;
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200">
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label="Karte der Schweizer Sitzbänke" aria-busy={mapLoading} />
      <header className="map-topbar safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBox onSelect={choosePlace} onLocate={locate} />
          <AppMenu user={user} onAdd={openAdd} activeFilters={activeFilterCount} onFilter={() => setFilterOpen(true)} />
        </div>
      </header>
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2"><div className="storybook-panel flex min-h-10 items-center gap-2 rounded-full px-3 text-xs text-base-content/65"><span className="loading loading-ring loading-sm text-primary" /><span>Karte wird gemalt …</span></div></div>}
      {message && <div role="status" className="toast toast-center top-36 z-30"><div className="storybook-panel flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-sm"><Info size={18} className="text-primary" /><span>{message}</span></div></div>}
      {journeyOpen && bench && <JourneyPlanner key={bench.id} bench={bench} getMap={getJourneyMap} onClose={() => setJourneyOpen(false)} />}
      {selectedId && !journeyOpen && <BenchSheet bench={bench} loading={detailLoading} error={detailError} onRetry={() => void selectBench(selectedId)} onBenchChange={refreshSelectedBench} onJourney={() => setJourneyOpen(true)} user={user} onClose={() => { detailSequence.current += 1; (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature()); setSelectedId(null); setBench(null); setDetailError(false); }} />}
      <AddBenchDialog open={addOpen} coordinates={addCoordinates} onUseCurrentLocation={() => locate((position) => openAddAt(position.latitude, position.longitude))} onClose={closeAdd} />
    </main>
  );
}
