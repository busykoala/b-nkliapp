export type Confidence = "hoch" | "mittel" | "niedrig";

export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type MapFilters = {
  sunnyNow?: boolean;
  minViewScore?: number;
  backrest?: boolean;
  armrest?: boolean;
  covered?: boolean;
  wheelchair?: boolean;
  environment?: "forest" | "open";
  material?: string;
  minCommunityRating?: number;
  viewType?: "mountain" | "lake" | "open" | "limited";
};

export type MapQuery = {
  bounds: Bounds;
  zoom: number;
  filters?: MapFilters;
};

export type BenchMapFeature = {
  kind: "bench";
  id: string;
  latitude: number;
  longitude: number;
  viewScore: number | null;
  sunnyNow: boolean | null;
  rating: number | null;
  viewType: MapFilters["viewType"] | null;
};

export type ClusterMapFeature = {
  kind: "cluster";
  id: string;
  latitude: number;
  longitude: number;
  count: number;
};

export type MapFeature = BenchMapFeature | ClusterMapFeature;

export type BenchProperty = {
  label: string;
  value: string;
  source: "OpenStreetMap" | "Benchly";
};

export type BenchMedia = {
  id: number;
  relation: "exact" | "nearby";
  provider: string;
  sourceUrl: string;
  thumbnailUrl: string;
  author: string | null;
  license: string | null;
  distanceMeters: number | null;
  title: string | null;
};

export type CommunityRating = {
  id: number;
  overall: number;
  view: number;
  comfort: number;
  quiet: number;
  note: string | null;
  createdAt: string;
};

export type CommunityCorrection = {
  id: number;
  field: string;
  proposedValue: string;
  note: string | null;
  createdAt: string;
};

export type BenchDetail = {
  id: string;
  osmType: string;
  osmId: number;
  latitude: number;
  longitude: number;
  title: string;
  description: string | null;
  properties: BenchProperty[];
  elevationMeters: number | null;
  elevationSource: string | null;
  analysisCoverage: "near-field" | "terrain";
  viewScore: number | null;
  viewConfidence: Confidence;
  viewExplanation: string[];
  sunrise: string;
  sunset: string;
  directSunrise: string;
  directSunset: string;
  sunMinutesToday: number;
  sunWindows: Array<{ start: string; end: string }>;
  shadeCause: "frei" | "nacht" | "überdacht" | "gebäude" | "vegetation" | "gelände" | "unbekannt";
  sunnyNow: boolean | null;
  sunConfidence: Confidence;
  sunMinutesSummer: number | null;
  sunMinutesWinter: number | null;
  sunMinutesSpring: number | null;
  sunMinutesAutumn: number | null;
  inForest: boolean | null;
  canopyPercent: number | null;
  distanceWaterMeters: number | null;
  distancePathMeters: number | null;
  directionDegrees: number | null;
  buildingObstructionPercent: number | null;
  vegetationObstructionPercent: number | null;
  distanceBuildingMeters: number | null;
  buildingCount100m: number | null;
  viewLabels: string[];
  ratingAverage: number | null;
  ratingCount: number;
  ratingBreakdown: { overall: number; view: number; comfort: number; quiet: number } | null;
  recentRatings: CommunityRating[];
  corrections: CommunityCorrection[];
  media: BenchMedia[];
  sourceUpdatedAt: string;
  pipelineVersion: string | null;
};

export type ActionResult = { ok: true; message: string } | { ok: false; message: string; errors?: Record<string, string[]> };

export type PlaceResult = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};
