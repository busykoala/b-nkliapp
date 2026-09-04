export type Confidence = "hoch" | "mittel" | "niedrig";
export type LandContext = "forest" | "forest_edge" | "park" | "open" | "urban" | "mixed" | "unknown";
export type CanopyContext = "none" | "partial" | "dense" | "unknown";
export type PrecipitationType = "none" | "rain" | "snow" | "mixed" | "unknown";

export type SkyTrackPoint = {
  minute: number;
  altitudeDegrees: number;
};

export type LikelyTrait = {
  kind: "land" | "canopy" | "lake" | "mountain" | "open" | "limited" | "buildings" | "roadRail";
  label: string;
  probability: number;
  confidence: "high" | "medium" | "low";
  evidenceCount: number;
  updatedAt: string;
};

export type LikelyEnvironment = {
  confidence: "high" | "medium" | "low";
  evidenceGroupCount: number;
  updatedAt: string;
  modelVersion: string | null;
  traits: LikelyTrait[];
  evidence: Array<{ provider: string; captureGroup: string; distanceMeters: number; sourceUrl: string; license: string | null; capturedAt: string | null; directView: boolean }>;
};

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
  viewType?: "mountain" | "hill" | "lake" | "open" | "limited";
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
  verificationStatus: "verified" | "unverified";
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
  key: "backrest" | "armrest" | "covered" | "wheelchair" | "material" | "seats";
  label: string;
  value: string;
  source: "OpenStreetMap" | "Bänkli App";
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
  name: string | null;
  dedication: string | null;
  locationName: string | null;
  locationPostcode: string | null;
  locationCanton: string | null;
  verificationStatus: "verified" | "unverified";
  confirmationCount: number;
  verificationThreshold: number;
  removalConfirmationCount: number;
  description: string | null;
  properties: BenchProperty[];
  elevationMeters: number | null;
  elevationSource: string | null;
  analysisCoverage: "near-field" | "terrain";
  viewScore: number | null;
  viewComponents: {
    openness: number | null;
    relief: number | null;
    water: number | null;
    naturalness: number | null;
    remoteness: number | null;
  };
  nearOpenness: number | null;
  viewConfidence: Confidence;
  viewExplanation: string[];
  sunrise: string;
  sunset: string;
  directSunrise: string;
  directSunset: string;
  sunMinutesToday: number;
  shadeMinutesToday: number;
  daylightMinutesToday: number;
  sunWindows: Array<{ start: string; end: string }>;
  shadeWindows: Array<{ start: string; end: string }>;
  shadeCause: "frei" | "nacht" | "überdacht" | "gebäude" | "vegetation" | "gelände" | "unbekannt";
  sunnyNow: boolean | null;
  sunConfidence: Confidence;
  sunAltitudeDegrees: number;
  sunAzimuthDegrees: number;
  daylightProgress: number;
  localMinutesNow: number;
  dayPhase: "dawn" | "day" | "dusk" | "night";
  season: "spring" | "summer" | "autumn" | "winter";
  moonAltitudeDegrees: number;
  moonAzimuthDegrees: number;
  moonIllumination: number;
  moonPhase: number;
  moonVisible: boolean;
  moonrise: string;
  moonset: string;
  skyTrack: { sun: SkyTrackPoint[]; moon: SkyTrackPoint[] };
  weather: {
    temperatureC: number;
    precipitationMm10: number | null;
    precipitationRateMmH: number | null;
    precipitationType: PrecipitationType;
    sunshineMinutes10: number | null;
    windKmh: number | null;
    humidityPercent: number | null;
    globalRadiationWm2: number | null;
    cloudCover: number;
    cloudLow: number | null;
    cloudMid: number | null;
    cloudHigh: number | null;
    snowCoverPercent: number | null;
    snowDepthCm: number | null;
    snowfallLimitMeters: number | null;
    location: string;
    observedAt: string;
    source: "MeteoSchweiz";
  } | null;
  sunMinutesSummer: number | null;
  sunMinutesWinter: number | null;
  sunMinutesSpring: number | null;
  sunMinutesAutumn: number | null;
  inForest: boolean | null;
  landContext: LandContext | null;
  waterfront: boolean | null;
  canopyContext: CanopyContext | null;
  canopyPercent: number | null;
  canopyShare3m: number | null;
  canopyShare10m: number | null;
  canopyShare25m: number | null;
  vegetationMedianHeight: number | null;
  vegetationMaxHeight: number | null;
  distanceWaterMeters: number | null;
  distancePathMeters: number | null;
  directionDegrees: number | null;
  buildingObstructionPercent: number | null;
  vegetationObstructionPercent: number | null;
  distanceBuildingMeters: number | null;
  buildingCount100m: number | null;
  viewLabels: string[];
  likelyEnvironment: LikelyEnvironment | null;
  ratingAverage: number | null;
  ratingCount: number;
  ratingBreakdown: { overall: number; view: number; comfort: number; quiet: number } | null;
  myRating: { overall: number; view: number; comfort: number; quiet: number; note: string | null } | null;
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
  kind: "bench" | "place";
  benchId?: string;
};
