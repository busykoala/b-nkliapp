import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { DayPhase } from "./sun";

export const MAP_STYLE_URL = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json";
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
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f3e5c4" } }],
} satisfies StyleSpecification;

export const FALLBACK_MAP_STYLE = {
  version: 8,
  sources: {
    swisstopo: {
      type: "raster",
      tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-karte-farbe/default/current/3857/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© swisstopo",
      maxzoom: 18,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#ead9ad" } },
    { id: "swisstopo", type: "raster", source: "swisstopo", paint: { "raster-opacity": .72, "raster-saturation": -.42, "raster-contrast": -.2, "raster-hue-rotate": 9 } },
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

const ART_ROOT = "/map-art/v3";

export const CORE_MAP_ART: MapArtImage[] = [
  { name: "benchly-bench", url: `${ART_ROOT}/bench.png`, pixelRatio: 2 },
  { name: "benchly-wash-sunny", url: `${ART_ROOT}/wash-sunny.png`, pixelRatio: 2 },
  { name: "benchly-wash-shade", url: `${ART_ROOT}/wash-shade.png`, pixelRatio: 2 },
  { name: "benchly-wash-neutral", url: `${ART_ROOT}/wash-neutral.png`, pixelRatio: 2 },
  { name: "benchly-wash-unverified", url: `${ART_ROOT}/wash-unverified.png`, pixelRatio: 2 },
  { name: "benchly-wash-cluster", url: `${ART_ROOT}/wash-cluster.png`, pixelRatio: 2 },
  { name: "benchly-wash-selected", url: `${ART_ROOT}/wash-selected.png`, pixelRatio: 2 },
];

export const BUILDING_PATTERN_ART: MapArtImage[] = [
  { name: "benchly-building-roof-terracotta", url: `${ART_ROOT}/building-roof-terracotta.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-ochre", url: `${ART_ROOT}/building-roof-ochre.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-rose", url: `${ART_ROOT}/building-roof-rose.png`, pixelRatio: 1 },
  { name: "benchly-building-roof-umber", url: `${ART_ROOT}/building-roof-umber.png`, pixelRatio: 1 },
];

export const DECORATIVE_MAP_ART: MapArtImage[] = [
  { name: "benchly-land-wash", url: `${ART_ROOT}/land-wash-v2.webp`, pixelRatio: 1 },
  { name: "benchly-field-wash", url: `${ART_ROOT}/field-wash.webp`, pixelRatio: 1 },
  { name: "benchly-mountain-wash", url: `${ART_ROOT}/mountain-mottle-v2.webp`, pixelRatio: 1 },
  { name: "benchly-water-wash", url: `${ART_ROOT}/water-wash-v2.webp`, pixelRatio: 1 },
  { name: "benchly-snow-wash", url: `${ART_ROOT}/snow-wash-v2.webp`, pixelRatio: 1 },
  ...BUILDING_PATTERN_ART,
  { name: "benchly-forest-relief", url: `${ART_ROOT}/forest-interior-alpha-v3.webp`, pixelRatio: 1 },
  { name: "benchly-forest-stamp", url: `${ART_ROOT}/forest-stamp-v2.webp`, pixelRatio: 1 },
  { name: "benchly-road-brush", url: `${ART_ROOT}/road-brush-pattern.png`, pixelRatio: 1 },
  { name: "benchly-bridge-deck-pattern", url: `${ART_ROOT}/bridge-deck-pattern.png`, pixelRatio: 1 },
  { name: "benchly-airport-airplane", url: `${ART_ROOT}/airport-airplane-v1.png`, pixelRatio: 2 },
];

export const TRANSIT_MAP_ART: MapArtImage[] = [
  { name: "benchly-transit-bus", url: `${ART_ROOT}/transit-bus.png`, pixelRatio: 2 },
  { name: "benchly-transit-rail", url: `${ART_ROOT}/transit-rail.png`, pixelRatio: 2 },
  { name: "benchly-transit-tram", url: `${ART_ROOT}/transit-tram.png`, pixelRatio: 2 },
  { name: "benchly-transit-metro", url: `${ART_ROOT}/transit-metro.png`, pixelRatio: 2 },
  { name: "benchly-transit-funicular", url: `${ART_ROOT}/transit-funicular.png`, pixelRatio: 2 },
  { name: "benchly-transit-cable-car", url: `${ART_ROOT}/transit-cable-car.png`, pixelRatio: 2 },
  { name: "benchly-wash-transit", url: `${ART_ROOT}/wash-transit.png`, pixelRatio: 2 },
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
export const LOCAL_TRANSIT_FILTER: FilterSpecification = ["match", ["get", "subclass"], [
  "halt", "bus_stop", "tram_stop", "subway_entrance", "subway_stop", "funicular", "funicular_stop",
  "aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station",
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
  if (subclass === "bus_stop") return 1.22;
  if (["funicular", "funicular_stop"].includes(subclass)) return 1.5;
  if (["aerialway", "aerialway_station", "cable_car_station", "chair_lift_station", "gondola_station"].includes(subclass)) return 1.45;
  return 1;
}

export function transitIconScaleExpression(): ExpressionSpecification {
  return ["match", ["get", "subclass"],
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
    background: phase === "night" ? "#d8cfbd" : phase === "dusk" ? "#ead2b5" : phase === "dawn" ? "#f0ddbd" : "#f3e5c4",
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
    shadowOpacity: .095 + (1 - daylightStrength) * .07,
    highlightOpacity: .035 + daylightStrength * .055,
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

    if (layer.type === "background") paint["background-color"] = "#f3e5c4";
    if (source === "hillshade") {
      paint["fill-color"] = id.includes("yellow")
        ? "#e4b86d"
        : ["interpolate", ["linear"], ["to-number", ["get", "luminosity"]], -15, "#6c6870", -9, "#918783", -3, "#b8aa98", 0, "#ddd2b8"];
      paint["fill-opacity"] = id.includes("yellow") ? .045 : ["interpolate", ["linear"], ["zoom"], 5, .06, 11, .12, 16, .17, 19, .2];
      paint["fill-antialias"] = true;
    }
    if (source === "landcover") {
      if (id === "pattern_landcover") layout.visibility = "none";
      if (layer.type === "fill") {
        paint["fill-color"] = ["case",
          ["match", ["get", "class"], ["forest", "wood"], true, false], "#9eb486",
          ["match", ["get", "subclass"], ["forest", "loose_forest", "woody_plant", "wood"], true, false], "#9eb486",
          ["match", ["get", "class"], ["ice", "glacier"], true, false], "#dce9e5",
          ["==", ["get", "class"], "sand"], "#e8c98d",
          "#dfd5a8",
        ];
        paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"],
          6, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .09, .16],
          12, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .12, .16],
          16, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .16, .16],
          19, ["case", GLACIER_FILTER, .12, FOREST_FILTER, .18, .16],
        ];
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#87937a";
        paint["line-opacity"] = .025;
        paint["line-blur"] = 3;
        paint["line-dasharray"] = [1.2, 1.8];
      }
    }
    if (source === "landuse") {
      if (layer.type === "fill") {
        paint["fill-color"] = id.includes("parking") ? "#dbc79d" : "#dfcf9f";
        paint["fill-opacity"] = id.includes("parking") ? .23 : .18;
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#9f8e69";
        paint["line-opacity"] = .45;
      }
    }
    if (source === "water") {
      if (layer.type === "fill") {
        paint["fill-color"] = "#5f9ea5";
        paint["fill-opacity"] = .47;
        paint["fill-outline-color"] = "rgba(0,0,0,0)";
        paint["fill-antialias"] = true;
      } else {
        paint["line-color"] = "#356c72";
        paint["line-opacity"] = .4;
        paint["line-blur"] = 1.1;
      }
    }
    if (source === "waterway" && layer.type === "line") {
      paint["line-color"] = "#3f7f89";
      paint["line-opacity"] = .68;
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
        paint["fill-color"] = ["interpolate", ["linear"], ["zoom"], 13, "#d5a06e", 17, "#c67c5b"];
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
      paint["line-color"] = isTransit ? "#765a78" : isCasing ? "#8b684c" : isPath ? "#966f48" : "#f5dfb2";
      paint["line-opacity"] = isTunnel ? .13 : isTransit ? .66 : isCasing ? .012 : isPath ? .34 : .19;
      paint["line-blur"] = isTransit ? .65 : isCasing ? 5 : isPath ? 1.35 : 2.2;
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
      paint["text-halo-color"] = "#f3e7c8";
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
