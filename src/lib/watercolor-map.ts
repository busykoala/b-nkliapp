import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import { DATA_RUNTIME } from "@/data/runtime.generated";
import type { DayPhase } from "./sun";

export const MAP_STYLE_URL = DATA_RUNTIME.mapStyleUrl;
export const MAP_STYLE_TIMEOUT_MS = 3_000;
export const INITIAL_ART_BUDGET_BYTES = 400 * 1024;
export const FULL_ART_BUDGET_BYTES = 800 * 1024;
export const TRANSIT_ZOOM = { major: 12, local: 14.5, labels: 16 } as const;

export const WATERCOLOR_LAYER_ORDER = [
  "paper", "relief", "vegetation", "water", "buildings", "routes", "labels", "transit", "benches",
] as const;

export const MINIMAL_MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8efdc" } }],
} satisfies StyleSpecification;

export const FALLBACK_MAP_STYLE = {
  version: 8,
  sources: {
    swisstopo: {
      type: "raster",
      tiles: [DATA_RUNTIME.mapRasterTileUrl],
      tileSize: 256,
      attribution: "© swisstopo",
      maxzoom: 18,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f4e7cf" } },
    { id: "swisstopo", type: "raster", source: "swisstopo", paint: { "raster-opacity": .76, "raster-saturation": .08, "raster-contrast": -.06, "raster-hue-rotate": 2 } },
  ],
} satisfies StyleSpecification;

type MutableLayer = {
  id: string;
  type: string;
  "source-layer"?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

export type BasemapKind = "vector" | "fallback";
export type LoadedMapStyle = { style: StyleSpecification; basemap: BasemapKind };

export type MapArtImage = {
  name: string;
  url: string;
  pixelRatio: number;
};

const TEXTURE_ART_ROOT = "/map-art/textures";
const MARKER_ART_ROOT = "/map-art/markers";
const WASH_ART_ROOT = "/map-art/washes";
const TRANSIT_ART_ROOT = "/map-art/transit";

export const CORE_MAP_ART: MapArtImage[] = [
  { name: "benchly-bench", url: `${MARKER_ART_ROOT}/bench.webp`, pixelRatio: 2 },
  { name: "benchly-wash-sunny", url: `${WASH_ART_ROOT}/sunny.png`, pixelRatio: 2 },
  { name: "benchly-wash-shade", url: `${WASH_ART_ROOT}/shade.png`, pixelRatio: 2 },
  { name: "benchly-wash-neutral", url: `${WASH_ART_ROOT}/neutral.png`, pixelRatio: 2 },
  { name: "benchly-wash-unverified", url: `${WASH_ART_ROOT}/unverified.png`, pixelRatio: 2 },
  { name: "benchly-wash-cluster", url: `${MARKER_ART_ROOT}/cluster.webp`, pixelRatio: 2 },
  { name: "benchly-wash-selected", url: `${WASH_ART_ROOT}/selected.png`, pixelRatio: 2 },
];

export const BUILDING_PATTERN_ART: MapArtImage[] = [
  { name: "benchly-building-roof-terracotta", url: `${TEXTURE_ART_ROOT}/building-roof-terracotta.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-ochre", url: `${TEXTURE_ART_ROOT}/building-roof-ochre.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-rose", url: `${TEXTURE_ART_ROOT}/building-roof-rose.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-umber", url: `${TEXTURE_ART_ROOT}/building-roof-umber.png`, pixelRatio: 1 },
];

export const DECORATIVE_MAP_ART: MapArtImage[] = [
  { name: "benchly-palette-wash", url: `${TEXTURE_ART_ROOT}/palette-wash.webp`, pixelRatio: .5 },
  { name: "benchly-land-wash", url: `${TEXTURE_ART_ROOT}/land.webp`, pixelRatio: 1 },
  { name: "benchly-field-wash", url: `${TEXTURE_ART_ROOT}/field.webp`, pixelRatio: 1 },
  { name: "benchly-mountain-wash", url: `${TEXTURE_ART_ROOT}/mountain.webp`, pixelRatio: 1 },
  { name: "benchly-water-wash", url: `${TEXTURE_ART_ROOT}/water.webp`, pixelRatio: 1 },
  { name: "benchly-snow-wash", url: `${TEXTURE_ART_ROOT}/snow.webp`, pixelRatio: 1 },
  ...BUILDING_PATTERN_ART,
  { name: "benchly-forest-relief", url: `${TEXTURE_ART_ROOT}/forest-interior.webp`, pixelRatio: 1 },
  { name: "benchly-forest-stamp", url: `${TEXTURE_ART_ROOT}/forest-stamp.webp`, pixelRatio: 1 },
  { name: "benchly-road-brush", url: `${TEXTURE_ART_ROOT}/road-brush.png`, pixelRatio: 1 },
  { name: "benchly-bridge-deck-pattern", url: `${TEXTURE_ART_ROOT}/bridge-deck.png`, pixelRatio: 1 },
  { name: "benchly-airport-airplane", url: `${TRANSIT_ART_ROOT}/airport-airplane.png`, pixelRatio: 2 },
];

export const TRANSIT_MAP_ART: MapArtImage[] = [
  { name: "benchly-transit-bus", url: `${TRANSIT_ART_ROOT}/bus.png`, pixelRatio: 2 },
  { name: "benchly-transit-rail", url: `${TRANSIT_ART_ROOT}/rail.png`, pixelRatio: 2 },
  { name: "benchly-transit-tram", url: `${TRANSIT_ART_ROOT}/tram.png`, pixelRatio: 2 },
  { name: "benchly-transit-metro", url: `${TRANSIT_ART_ROOT}/metro.png`, pixelRatio: 2 },
  { name: "benchly-transit-funicular", url: `${TRANSIT_ART_ROOT}/funicular.png`, pixelRatio: 2 },
  { name: "benchly-transit-cable-car", url: `${TRANSIT_ART_ROOT}/cable-car.png`, pixelRatio: 2 },
  { name: "benchly-transit-ferry", url: `${TRANSIT_ART_ROOT}/ferry.png`, pixelRatio: 2 },
  { name: "benchly-wash-transit", url: `${WASH_ART_ROOT}/transit.png`, pixelRatio: 2 },
];

export const FOREST_FILTER: FilterSpecification = ["any",
  ["match", ["get", "class"], ["forest", "wood"], true, false],
  ["match", ["get", "subclass"], ["forest", "loose_forest", "woody_plant", "wood"], true, false],
];

export const GLACIER_FILTER: FilterSpecification = ["any",
  ["match", ["get", "class"], ["ice", "glacier"], true, false],
  ["==", ["get", "subclass"], "glacier"],
];

export const OPEN_LAND_FILTER: FilterSpecification = ["all", ["!", FOREST_FILTER], ["!", GLACIER_FILTER]];

export const BRIDGE_FILTER: FilterSpecification = ["any",
  ["==", ["get", "brunnel"], "bridge"],
  ["==", ["get", "structure"], "bridge"],
  ["match", ["get", "class"], ["bridge", "covered_bridge"], true, false],
  [">", ["coalesce", ["to-number", ["get", "layer"]], 0], 0],
];

export const PAINTERLY_ROAD_FILTER: FilterSpecification = ["all",
  ["match", ["get", "class"], ["rail", "transit", "cable_car", "chair_lift", "gondola", "drag_lift", "path", "footway", "trail", "via_ferrata"], false, true],
  ["==", ["geometry-type"], "LineString"],
];

export const MAJOR_TRANSIT_FILTER: FilterSpecification = ["==", ["get", "subclass"], "railway_station"];
// swisstopo's POI classes for passenger-boat landings, not generic marinas.
const FERRY_SUBCLASSES = ["ferry", "car_ferry", "ferry_terminal"];
export const LOCAL_TRANSIT_FILTER: FilterSpecification = ["match", ["get", "subclass"], [
  "halt", "bus_stop", "tram_stop", "subway_entrance", "subway_stop", "funicular", "funicular_stop",
  "aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station",
  ...FERRY_SUBCLASSES,
], true, false];

function availableIcon(name: string, available?: ReadonlySet<string>) {
  return !available || available.has(name) ? name : "";
}

export function benchWashIconExpression(available?: ReadonlySet<string>): ExpressionSpecification {
  return ["case",
    ["==", ["get", "verificationStatus"], "unverified"], availableIcon("benchly-wash-unverified", available),
    ["==", ["get", "sunnyNow"], true], availableIcon("benchly-wash-sunny", available),
    ["==", ["get", "sunnyNow"], false], availableIcon("benchly-wash-shade", available),
    availableIcon("benchly-wash-neutral", available),
  ];
}

export function transitIconForSubclass(subclass: string) {
  if (FERRY_SUBCLASSES.includes(subclass)) return "benchly-transit-ferry";
  if (["railway_station", "halt"].includes(subclass)) return "benchly-transit-rail";
  if (subclass === "bus_stop") return "benchly-transit-bus";
  if (subclass === "tram_stop") return "benchly-transit-tram";
  if (["subway_entrance", "subway_stop"].includes(subclass)) return "benchly-transit-metro";
  if (["funicular", "funicular_stop"].includes(subclass)) return "benchly-transit-funicular";
  if (["aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station"].includes(subclass)) return "benchly-transit-cable-car";
  return "";
}

export function transitIconExpression(available?: ReadonlySet<string>): ExpressionSpecification {
  return ["match", ["get", "subclass"],
    FERRY_SUBCLASSES, availableIcon("benchly-transit-ferry", available),
    ["railway_station", "halt"], availableIcon("benchly-transit-rail", available),
    "bus_stop", availableIcon("benchly-transit-bus", available),
    "tram_stop", availableIcon("benchly-transit-tram", available),
    ["subway_entrance", "subway_stop"], availableIcon("benchly-transit-metro", available),
    ["funicular", "funicular_stop"], availableIcon("benchly-transit-funicular", available),
    ["aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station"], availableIcon("benchly-transit-cable-car", available),
    "",
  ];
}

export function transitIconScaleForSubclass(subclass: string) {
  if (FERRY_SUBCLASSES.includes(subclass)) return 1.4;
  if (subclass === "bus_stop") return 1.22;
  if (["funicular", "funicular_stop"].includes(subclass)) return 1.5;
  if (["aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station"].includes(subclass)) return 1.45;
  return 1;
}

export function transitIconScaleExpression(): ExpressionSpecification {
  return ["match", ["get", "subclass"],
    FERRY_SUBCLASSES, 1.4,
    "bus_stop", 1.22,
    ["funicular", "funicular_stop"], 1.5,
    ["aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station"], 1.45,
    1,
  ];
}

export function buildingPatternExpression(available?: ReadonlySet<string>): ExpressionSpecification {
  const pattern = (index: number) => availableIcon(BUILDING_PATTERN_ART[index].name, available);
  const fallback = BUILDING_PATTERN_ART.map((_, index) => pattern(index)).find(Boolean) ?? "";
  const height: ExpressionSpecification = ["to-number", ["get", "render_height"], 5];
  return ["case",
    ["==", ["get", "class"], "place_of_worship"], pattern(2) || fallback,
    ["match", ["get", "class"], ["greenhouse", "construction", "storage_tank"], true, false], fallback,
    ["==", ["get", "class"], "roof"], pattern(0) || fallback,
    ["<=", height, 6], pattern(1) || fallback,
    ["<=", height, 10], pattern(0) || fallback,
    ["<=", height, 14], pattern(2) || fallback,
    pattern(3) || fallback,
  ];
}

export function watercolorLayerRank(layer: { type: string; "source-layer"?: string }) {
  const source = layer["source-layer"] ?? "";
  if (layer.type === "background") return 0;
  if (layer.type === "symbol") return 6;
  if (["hillshade", "contour_line", "scree", "hachure"].includes(source)) return 1;
  if (["landcover", "landuse", "park"].includes(source)) return 2;
  if (["water", "waterway"].includes(source)) return 3;
  if (["building", "building_ln"].includes(source)) return 4;
  if (source === "transportation" || layer.type === "line") return 5;
  return 2;
}

export function mapDayPalette(phase: DayPhase) {
  return {
    background: phase === "night" ? "#d5d2c7" : phase === "dusk" ? "#ead5c4" : phase === "dawn" ? "#f2dfc7" : "#f8efdc",
    cluster: phase === "night" ? "#755343" : phase === "dusk" ? "#83513f" : "#8a5940",
    markerStroke: phase === "night" ? "#f2dca7" : "#fff4d8",
  } as const;
}

export function mapSunLighting(altitudeRadians: number, azimuthRadians: number) {
  const altitudeDegrees = altitudeRadians * 180 / Math.PI;
  const directionDegrees = (azimuthRadians * 180 / Math.PI + 180 + 360) % 360;
  const daylightStrength = Math.max(0, Math.min(1, (altitudeDegrees + 6) / 50));
  const offset = .35 + (1 - daylightStrength) * .75;
  const directionRadians = directionDegrees * Math.PI / 180;
  return {
    directionDegrees,
    polarDegrees: Math.max(18, Math.min(86, 90 - altitudeDegrees)),
    shadowOpacity: .13 + (1 - daylightStrength) * .08,
    highlightOpacity: .05 + daylightStrength * .065,
    shadowTranslate: [
      Number((Math.sin(directionRadians) * offset).toFixed(2)),
      Number((-Math.cos(directionRadians) * offset).toFixed(2)),
    ] as [number, number],
  };
}

export function transformWatercolorStyle(input: StyleSpecification): StyleSpecification {
  const style = JSON.parse(JSON.stringify(input)) as StyleSpecification & { layers: MutableLayer[] };
  for (const layer of style.layers) {
    const source = layer["source-layer"] ?? "";
    const id = layer.id;
    const paint = layer.paint ??= {};
    const layout = layer.layout ??= {};

    if (layer.type === "background") paint["background-color"] = "#f8efdc";
    if (source === "hillshade") {
      paint["fill-color"] = id.includes("yellow")
        ? "#efb541"
        : ["interpolate", ["linear"], ["to-number", ["get", "luminosity"]], -15, "#3e7181", -9, "#6f6884", -3, "#a38b9f", 0, "#ddd0b9"];
      paint["fill-opacity"] = id.includes("yellow") ? .075 : ["interpolate", ["linear"], ["zoom"], 5, .11, 11, .17, 16, .2, 19, .22];
      paint["fill-antialias"] = true;
    }
    if (source === "landcover") {
      if (id === "pattern_landcover") layout.visibility = "none";
      if (layer.type === "fill") {
        paint["fill-color"] = ["case",
          ["match", ["get", "class"], ["forest", "wood"], true, false], "#4f9874",
          ["match", ["get", "subclass"], ["forest", "loose_forest", "woody_plant", "wood"], true, false], "#4f9874",
          ["match", ["get", "class"], ["ice", "glacier"], true, false], "#dcebed",
          ["==", ["get", "class"], "sand"], "#f0c75d",
          "#b8cf78",
        ];
        paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"],
          6, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .14, .14],
          12, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .18, .16],
          16, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .2, .17],
          19, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .22, .17],
        ];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#678474";
        paint["line-opacity"] = .025;
        paint["line-blur"] = 3;
        paint["line-dasharray"] = [1.2, 1.8];
      }
    }
    if (source === "landuse") {
      if (layer.type === "fill") {
        paint["fill-color"] = ["match", ["get", "class"],
          ["forest", "wood", "park", "garden", "recreation_ground"], "#69a979",
          ["grass", "meadow"], "#b9d36c",
          ["farmland", "orchard", "vineyard"], "#e4cf61",
          ["residential", "village_green"], "#e9b9ad",
          ["commercial", "retail"], "#db8d9f",
          "industrial", "#bd9bb9",
          ["parking", "garages"], "#c8bba9",
          "#d9ce84",
        ];
        paint["fill-opacity"] = id.includes("parking") ? .16 : ["interpolate", ["linear"], ["zoom"], 7, .18, 13, .22, 18, .17];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#7e8c70";
        paint["line-opacity"] = .28;
      }
    }
    if (source === "water") {
      if (layer.type === "fill") {
        paint["fill-color"] = "#299aad";
        paint["fill-opacity"] = .6;
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#176f82";
        paint["line-opacity"] = .34;
        paint["line-blur"] = 1.1;
      }
    }
    if (source === "waterway" && layer.type === "line") {
      paint["line-color"] = "#238da2";
      paint["line-opacity"] = .76;
      paint["line-blur"] = .8;
    }
    if (source === "contour_line") {
      paint["line-color"] = id.includes("blue") ? "#517f87" : "#8f744f";
      paint["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 6, .22, 12, .3, 16, .38, 19, .44];
      paint["line-blur"] = .4;
      paint["line-dasharray"] = [1.5, .75];
    }
    if (["scree", "hachure"].includes(source)) {
      paint["fill-color"] = "#8e7b61";
      paint["fill-opacity"] = source === "hachure" ? .08 : .1;
    }
    if (source === "building" || source === "building_ln") {
      if (layer.type === "fill") {
        paint["fill-color"] = ["interpolate", ["linear"], ["zoom"], 13, "#e59a72", 17, "#cf5e68"];
        paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, .15, 15, .25, 18, .3];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#6a4a38";
        paint["line-opacity"] = .42;
        paint["line-blur"] = .75;
      }
    }
    if (source === "construct") {
      if (layer.type === "fill") {
        paint["fill-color"] = ["match", ["get", "class"],
          "barrier", "#8f826b",
          "dam", "#8a7a67",
          "weir", "#788b86",
          "#9b8d77",
        ];
        paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, .1, 15, .2, 19, .27];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#756954";
        paint["line-opacity"] = .24;
        paint["line-blur"] = .7;
      }
    }
    if (source === "aeroway") {
      if (layer.type === "fill") {
        paint["fill-color"] = ["match", ["get", "class"],
          "runway_grass", "#aebc98",
          "runway", "#b7aa91",
          "taxiway", "#c8b995",
          "apron", "#c2b295",
          "#c6b89d",
        ];
        paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 11, .18, 14, .29, 18, .34];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#806f5e";
        paint["line-opacity"] = .09;
        paint["line-width"] = ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 4, 18, 6];
        paint["line-blur"] = 2.6;
      }
    }
    if (source === "transportation") {
      const isTransit = id.includes("public_transport");
      const isPath = id.includes("path") || id.includes("pedestrian") || id.includes("trail");
      const isCasing = id.includes("casing") || id.includes("outline") || id.includes("border");
      const isTunnel = id.includes("tunnel");
      layout["line-cap"] = "round";
      layout["line-join"] = "round";
      paint["line-color"] = isTransit ? "#745874" : isCasing ? "#806e5d" : isPath ? "#8a674b" : "#fbefd3";
      paint["line-opacity"] = isTunnel ? .14 : isTransit ? .62 : isCasing ? .012 : isPath ? .39 : .3;
      paint["line-blur"] = isTransit ? .65 : isCasing ? 4 : isPath ? .8 : 1.45;
      if (isPath) paint["line-dasharray"] = [1.4, 1.05];
    }
    if (source === "boundary") {
      paint["line-color"] = "#995d4d";
      paint["line-opacity"] = .36;
      paint["line-blur"] = .65;
    }
    if (source === "park" && layer.type === "line") {
      paint["line-color"] = "#547a5d";
      paint["line-opacity"] = .55;
    }
    if (layer.type === "symbol") {
      paint["text-color"] = source.includes("water") ? "#376d76" : source === "mountain_peak" ? "#58463a" : "#35453b";
      paint["text-halo-color"] = "#f6ead1";
      paint["text-halo-width"] = 1.4;
      paint["text-halo-blur"] = .5;
      if (source === "poi" || source === "address" || source === "spot_elevation") layout.visibility = "none";
      else {
        paint["text-opacity"] = source.includes("place") || source.includes("water") || source.includes("mountain") ? .75 : .48;
        layout["text-size"] = source.includes("place")
          ? ["interpolate", ["linear"], ["zoom"], 6, 11, 13, 15, 18, 18]
          : ["interpolate", ["linear"], ["zoom"], 6, 9, 13, 12, 18, 15];
      }
      if (id === "road_number") layout.visibility = "none";
      if (source === "aerodrome_label") {
        layout["icon-image"] = "";
        paint["icon-opacity"] = 0;
        paint["text-color"] = "#5f5549";
        paint["text-opacity"] = .72;
        paint["text-halo-color"] = "#f2e6c9";
      }
    }
  }
  style.layers = style.layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => watercolorLayerRank(left.layer) - watercolorLayerRank(right.layer) || left.index - right.index)
    .map(({ layer }) => layer);
  return style;
}

export async function loadWatercolorMapStyle(
  fetcher: typeof fetch = fetch,
  timeoutMs = MAP_STYLE_TIMEOUT_MS,
): Promise<LoadedMapStyle> {
  const controller = new AbortController();
  const fallback = { style: FALLBACK_MAP_STYLE, basemap: "fallback" } satisfies LoadedMapStyle;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const remoteStyle = (async (): Promise<LoadedMapStyle> => {
    try {
      const response = await fetcher(MAP_STYLE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`swisstopo style ${response.status}`);
      const style = JSON.parse(await response.text(), (key, value) => key === "text-font" ? ["Frutiger Neue Regular"] : value) as StyleSpecification;
      return { style: transformWatercolorStyle(style), basemap: "vector" };
    } catch {
      return fallback;
    }
  })();
  const deadline = new Promise<LoadedMapStyle>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  const result = await Promise.race([remoteStyle, deadline]);
  if (timeout) clearTimeout(timeout);
  return result;
}
