import type { Language } from "@/i18n/config";
import { DIALECT_AREAS, DIALECT_DATA_VERSION, DIALECT_PACK_MANIFEST } from "@/i18n/dialects/registry.generated";
import type { DialectBenchPlace, DialectMatchKind, DialectResolution, DialectSpatialResolution } from "./model";

type Area = (typeof DIALECT_AREAS)[number];
type Pack = (typeof DIALECT_PACK_MANIFEST)[number];

const areasById = new Map<string, Area>(DIALECT_AREAS.map((area) => [area.id, area]));
const packsById = new Map<string, Pack>(DIALECT_PACK_MANIFEST.map((pack) => [pack.id, pack]));

function normalized(value: string | null | undefined) {
  return value?.normalize("NFKD").replaceAll(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de-CH")
    .replaceAll(/[’']/g, " ").replaceAll(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function anchorAliases(anchor: string) {
  const stripped = anchor.replaceAll(/\([^)]*\)/g, " ");
  return new Set([anchor, ...stripped.split("/"), stripped]
    .map(normalized).filter((alias) => alias.length >= 2));
}

const anchorAreas = new Map<string, string[]>();
for (const area of DIALECT_AREAS) {
  for (const anchor of area.anchors) {
    for (const alias of anchorAliases(anchor)) anchorAreas.set(alias, [...new Set([...(anchorAreas.get(alias) ?? []), area.id])]);
  }
}

const exactOverrides: Record<string, string[]> = Object.fromEntries(Object.entries({
  "dudingen": ["fr-sensler"], "tafers": ["fr-sensler"], "plaffeien": ["fr-sensler"],
  "murten": ["fr-seeland"], "morat": ["fr-seeland"], "kerzers": ["fr-seeland"],
  "jaun": ["fr-jaun"], "im fang": ["fr-jaun"], "gurmels": ["fr-gurmels-contact"], "kleingurmels": ["fr-gurmels-contact"],
  "biel": ["be-biel-contact"], "bienne": ["be-biel-contact"], "fribourg": ["fr-city-contact"], "freiburg": ["fr-city-contact"],
  "bosco gurin": ["ti-bosco-gurin"], "samnaun": ["gr-samnaun"], "juf": ["gr-avers"], "madris": ["gr-avers"],
  "vals": ["gr-vals"], "safien": ["gr-safien"], "obersaxen": ["gr-obersaxen"], "bivio": ["gr-bivio-contact"], "beiva": ["gr-bivio-contact"],
  "bergun": ["rm-bergun"], "bravuogn": ["rm-bergun"], "sils": ["rm-puter"], "segl": ["rm-puter"],
  "sils im domleschg": ["gr-rhine-rm-contact"], "moutier": ["fr-jura"],
}).map(([key, value]) => [normalized(key), value]));

const contactCandidates: Record<string, string[]> = {
  "fr-gurmels-contact": ["fr-gurmels-contact", "fr-fribourg"],
  "fr-city-contact": ["fr-city-contact", "fr-fribourg"],
  "be-biel-contact": ["be-biel-contact", "fr-jura"],
  "gr-bivio-contact": ["gr-bivio-contact", "gr-chur", "lmo-bregaglia"],
  "gr-rhine-rm-contact": ["gr-rhine-rm-contact", "gr-chur"],
  "ti-bosco-gurin": ["ti-bosco-gurin", "lmo-vallemaggia"],
};

function areaCandidates(value: string | null | undefined) {
  const key = normalized(value);
  if (!key) return [];
  const direct = exactOverrides[key] ?? anchorAreas.get(key) ?? [];
  return [...new Set(direct.flatMap((id) => contactCandidates[id] ?? [id]))].filter((id) => areasById.has(id));
}

function cantonKey(value: string | null | undefined) {
  const name = normalized(value);
  const entries: Array<[RegExp, string]> = [
    [/^(bs|basel stadt)$/, "BS"], [/^(bl|basel landschaft)$/, "BL"], [/^(so|solothurn)$/, "SO"], [/^(ag|aargau)$/, "AG"],
    [/^(be|bern|berne)$/, "BE"], [/^(fr|fribourg|freiburg)$/, "FR"], [/^(zh|zurich)$/, "ZH"], [/^(sh|schaffhausen)$/, "SH"],
    [/^(lu|luzern|lucerne)$/, "LU"], [/^(zg|zug)$/, "ZG"], [/^(sz|schwyz)$/, "SZ"], [/^(ow|obwalden)$/, "OW"],
    [/^(nw|nidwalden)$/, "NW"], [/^(ur|uri)$/, "UR"], [/^(gl|glarus)$/, "GL"], [/^(sg|st gallen)$/, "SG"],
    [/^(tg|thurgau|thurgovie)$/, "TG"], [/^(ai|appenzell innerrhoden)$/, "AI"], [/^(ar|appenzell ausserrhoden)$/, "AR"],
    [/^(vs|wallis|valais)$/, "VS"], [/^(gr|graubunden|grisons|grigioni)$/, "GR"], [/^(ti|ticino|tessin)$/, "TI"],
    [/^(vd|vaud|waadt)$/, "VD"], [/^(ge|geneve|genf)$/, "GE"], [/^(ne|neuchatel|neuenburg)$/, "NE"], [/^(ju|jura)$/, "JU"],
  ];
  return entries.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

function fallbackAreas(canton: string | null, language: Language): string[] {
  const fixed: Record<string, string> = {
    BS: "bs-city", BL: "bl-lower", SO: "so-core", AG: "ag-west", ZH: "zh-core", SH: "sh-city", LU: "lu-core", ZG: "zg-core",
    SZ: "sz-core", OW: "ow-sarnen-kerns", NW: "nw-core", UR: "ur-reuss", GL: "gl-central", SG: "sg-city", TG: "tg-transition",
    AI: "ai-core", AR: "ar-mittel", TI: "lmo-bellinzonese", VD: "fr-vaud", GE: "fr-geneva", NE: "fr-neuchatel", JU: "fr-jura",
  };
  if (!canton) return [];
  if (canton === "BE") return [language === "fr" ? "fr-jura" : "be-mittelland"];
  if (canton === "FR") return [language === "de" ? "fr-sensler" : "fr-fribourg"];
  if (canton === "VS") return [language === "de" ? "vs-brig" : "fr-valais"];
  if (canton === "GR") return [language === "rm" ? "rm-sursilvan" : language === "it" ? "lmo-mesolcina" : "gr-chur"];
  return fixed[canton] ? [fixed[canton]] : [];
}

const languageAreaFallback: Record<Language, string> = { de: "zh-core", fr: "fr-vaud", it: "lmo-bellinzonese", rm: "rm-sursilvan" };

function insideSwissEnvelope(bench: DialectBenchPlace) {
  return Number.isFinite(bench.latitude) && Number.isFinite(bench.longitude)
    && bench.latitude >= 45.7 && bench.latitude <= 47.9 && bench.longitude >= 5.9 && bench.longitude <= 10.6;
}

function chooseVoiceArea(areaIds: string[], language: Language) {
  return areaIds.find((id) => packsById.get(areasById.get(id)?.parentPackId ?? "")?.language === language) ?? areaIds[0] ?? null;
}

export function resolveDialect(bench: DialectBenchPlace, language: Language, spatial?: DialectSpatialResolution): DialectResolution {
  const geography = bench.knowledge?.geography;
  const sourceVersion = geography?.sourceVersion ?? spatial?.sourceVersion ?? null;
  if ((spatial && !spatial.insideSwitzerland) || (!spatial && !insideSwissEnvelope(bench) && !cantonKey(geography?.cantonName ?? bench.locationCanton))) {
    return { areaId: null, areaIds: [], areaLabel: null, voiceId: null, matchKind: "unknown", dataVersion: DIALECT_DATA_VERSION, geographySourceVersion: sourceVersion };
  }

  const stages: Array<[DialectMatchKind, string[]]> = [
    ["locality", areaCandidates(geography?.localityName)],
    ["municipality", areaCandidates(geography?.municipalityName)],
  ];
  stages.push(["linguistic-polygon", spatial?.areaIds.filter((id) => areasById.has(id)) ?? []]);
  if (!geography) stages.push(["free-text", areaCandidates(bench.locationName)]);
  if (spatial?.languageArea) stages.push(["language-area", [languageAreaFallback[spatial.languageArea]]]);
  stages.push(["language-area", fallbackAreas(cantonKey(geography?.cantonName ?? bench.locationCanton), language)]);

  for (const [matchKind, candidates] of stages) {
    if (!candidates.length) continue;
    const areaId = candidates[0] ?? null;
    const voiceAreaId = chooseVoiceArea(candidates, language);
    const area = areaId ? areasById.get(areaId) : null;
    return {
      areaId, areaIds: candidates, areaLabel: area?.label ?? null, voiceId: voiceAreaId ? areasById.get(voiceAreaId)?.parentPackId ?? null : null,
      matchKind, dataVersion: DIALECT_DATA_VERSION, geographySourceVersion: sourceVersion,
    };
  }
  return { areaId: null, areaIds: [], areaLabel: null, voiceId: null, matchKind: "unknown", dataVersion: DIALECT_DATA_VERSION, geographySourceVersion: sourceVersion };
}

export function dialectArea(areaId: string) { return areasById.get(areaId) ?? null; }
export function dialectPack(packId: string) { return packsById.get(packId) ?? null; }
