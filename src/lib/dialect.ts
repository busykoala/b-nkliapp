import type { Language } from "@/i18n/config";
import { DIALECT_PACK_MANIFEST } from "@/i18n/dialects/registry.generated";
import type { BenchDetail } from "./types";
import type { DialectBenchPlace } from "./dialects/model";
import { dialectPack, resolveDialect } from "./dialects/resolve";

export type DialectRegion = string;

export type LocalBenchProfile = {
  region: DialectRegion;
  regionLabel: string;
  voiceId: string;
  languageTag: string;
  formatLocale: string;
  uiLanguage: Language;
};

export type LocalBenchVoice = LocalBenchProfile & { first: string; second: string };

type BenchPlace = DialectBenchPlace & { dialectPresentation?: BenchDetail["dialectPresentation"] };
const packs = new Map<string, (typeof DIALECT_PACK_MANIFEST)[number]>(DIALECT_PACK_MANIFEST.map((pack) => [pack.id, pack]));

function profileFrom(bench: BenchPlace, language: Language): LocalBenchProfile | null {
  if (bench.dialectPresentation) {
    const { resolution, voice } = bench.dialectPresentation;
    return {
      region: resolution.areaId ?? voice.id,
      regionLabel: voice.label,
      voiceId: voice.id,
      languageTag: voice.languageTag,
      formatLocale: voice.formatLocale,
      uiLanguage: voice.language,
    };
  }
  const resolution = resolveDialect(bench, language);
  const pack = resolution.voiceId ? dialectPack(resolution.voiceId) : null;
  if (!resolution.areaId || !pack) return null;
  return {
    region: resolution.areaId,
    regionLabel: pack.label,
    voiceId: pack.id,
    languageTag: pack.languageTag,
    formatLocale: pack.formatLocale,
    uiLanguage: pack.language,
  };
}

export function dialectRegionForBench(bench: BenchPlace): DialectRegion {
  return bench.dialectPresentation?.resolution.areaId ?? resolveDialect(bench, "de").areaId ?? "unknown";
}

export function localBenchProfile(bench: BenchPlace, language: Language = "de"): LocalBenchProfile | null {
  return profileFrom(bench, language);
}

export function localLanguageForBench(bench: BenchPlace, language: Language = "de"): Language {
  return profileFrom(bench, language)?.uiLanguage ?? language;
}

export function localBenchVoice(bench: BenchPlace, language: Language = "de"): LocalBenchVoice | null {
  if (bench.dialectPresentation) {
    const profile = profileFrom(bench, language);
    return profile ? { ...profile, first: bench.dialectPresentation.voice.first, second: bench.dialectPresentation.voice.second } : null;
  }
  const profile = profileFrom(bench, language);
  const pack = profile ? packs.get(profile.voiceId) : null;
  if (!profile || !pack) return null;
  const first = pack.invitations[0].text;
  const light = bench.dayPhase === "night" || bench.shadeCause === "nacht" ? "night"
    : bench.sunnyNow === true ? "potentialSun" : bench.sunnyNow === false ? "shade" : "unknown";
  return { ...profile, first, second: pack.light[light] };
}
