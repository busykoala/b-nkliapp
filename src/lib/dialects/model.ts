import type { Language } from "@/i18n/config";

export type DialectMatchKind = "locality" | "municipality" | "linguistic-polygon" | "language-area" | "free-text" | "unknown";

export type DialectResolution = {
  areaId: string | null;
  areaIds: string[];
  areaLabel: string | null;
  voiceId: string | null;
  matchKind: DialectMatchKind;
  dataVersion: string;
  geographySourceVersion: string | null;
};

export type DialectSpatialResolution = {
  insideSwitzerland: boolean;
  areaIds: string[];
  languageArea: Language | null;
  sourceVersion: string;
};

export type DialectPresentation = {
  appLanguageTag: string;
  resolution: DialectResolution;
  voice: {
    id: string;
    label: string;
    language: Language;
    languageTag: string;
    formatLocale: string;
    version: string;
    first: string;
    second: string;
  };
  messages: Record<string, unknown>;
};

export type DialectBenchPlace = {
  id: string;
  latitude: number;
  longitude: number;
  locationName: string | null;
  locationCanton: string | null;
  sunnyNow?: boolean | null;
  shadeCause?: "frei" | "nacht" | "überdacht" | "gebäude" | "vegetation" | "gelände" | "unbekannt";
  dayPhase?: "dawn" | "day" | "dusk" | "night";
  knowledge?: {
    geography: {
      municipalityName: string | null;
      municipalityId: string | null;
      cantonName: string | null;
      districtName: string | null;
      localityName: string | null;
      confidence: string;
      sourceVersion: string;
    } | null;
  };
};
