import type { Language } from "@/i18n/config";
import type { BenchDetail } from "./types";

export type DialectRegion =
  | "basel" | "bern" | "northwest" | "zurich" | "northeast" | "central" | "wallis" | "graubuenden"
  | "frVaud" | "frGeneva" | "frValais" | "frFribourg" | "frNeuchatel" | "frJura"
  | "itSopraceneri" | "itSottoceneri" | "itGraubuenden"
  | "rmSursilvan" | "rmSutsilvan" | "rmSurmiran" | "rmPuter" | "rmVallader" | "rmJauer";

export type LocalBenchProfile = {
  region: DialectRegion;
  regionLabel: string;
  languageTag: string;
  uiLanguage: Language;
};

export type LocalBenchVoice = LocalBenchProfile & { first: string; second: string };

type BenchPlace = Pick<BenchDetail, "id" | "latitude" | "longitude" | "locationName" | "locationCanton" | "sunnyNow" | "shadeCause" | "inForest" | "waterfront" | "viewLabels"> & {
  knowledge?: Pick<NonNullable<BenchDetail["knowledge"]>, "geography">;
};

const germanFribourg = /\b(murten|morat|dudingen|tafers|plaffeien|sense|kerzers|wunnewil|flamatt)\b/i;
const frenchBern = /\b(biel|bienne|moutier|tavannes|saint[- ]imier|tramelan|courtelary|la neuveville|reconvilier)\b/i;
const italianGraubuenden = /\b(poschiavo|brusio|bregaglia|bondo|castasegna|soglio|mesocco|roveredo|calanca|soazza|lostallo|bivio|beiva)\b/i;
const ticinoSouth = /\b(lugano|mendrisio|chiasso|massagno|paradiso|melide|morcote|agno|bioggio|collina d'oro|capriasca|malcantone|stabio|balerna)\b/i;
const jauerPlaces = /\b(val mustair|mustair|tscherv|fuldera|lu|santa maria val mustair|valchava)\b/i;
const valladerPlaces = /\b(scuol|zernez|guarda|ardez|ftan|sent|tarasp|valsot|susch|lavin)\b/i;
const puterPlaces = /\b(st\.? moritz|san murezzan|celerina|schlarigna|samedan|samaden|pontresina|puntraschigna|zuoz|bever|la punt|madulain|s-chanf|silvaplana|silvaplauna|sils|segl)\b/i;
const surmiranPlaces = /\b(surses|savognin|tiefencastel|cunter|tinizong|riom|parsonz|mulegns|sur|lantsch|lenz|bravuogn|bergun|alvra|albula)\b/i;
const sutsilvanPlaces = /\b(andeer|zillis|reichenau|reischen|donat|mathon|lohn|cami|schams|schons|domleschg|tumleastga|tomils|paspels|pratval|furstenau)\b/i;
const sursilvanPlaces = /\b(disentis|muster|ilanz|glion|falera|laax|lumnezia|vella|vrin|trun|breil|brigels|sumvitg|tujetsch|sedrun|medel|schluein|sagogn|ruschein)\b/i;

function normalized(value: string | null | undefined) {
  return value?.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de-CH") ?? "";
}

function romanshRegion(place: string, latitude: number, longitude: number): DialectRegion | null {
  if (jauerPlaces.test(place)) return "rmJauer";
  if (valladerPlaces.test(place)) return "rmVallader";
  if (puterPlaces.test(place)) return "rmPuter";
  if (surmiranPlaces.test(place)) return "rmSurmiran";
  if (sutsilvanPlaces.test(place)) return "rmSutsilvan";
  if (sursilvanPlaces.test(place)) return "rmSursilvan";
  // Coordinate fallbacks are deliberately conservative and only used inside GR.
  if (longitude > 10.25 && latitude < 46.75) return "rmJauer";
  if (longitude > 10 && latitude < 46.95) return "rmVallader";
  if (longitude > 9.6 && latitude < 46.72) return "rmPuter";
  if (longitude > 9.35 && latitude < 46.75) return "rmSurmiran";
  if (longitude < 9.2 && latitude > 46.65) return "rmSursilvan";
  return null;
}

/**
 * Resolve a useful local written variety from official geography first. The
 * result is still an approximation: dialect borders do not follow cantons and
 * several Swiss language regions are continua down to individual villages.
 */
export function dialectRegionForBench(bench: BenchPlace): DialectRegion {
  const geography = bench.knowledge?.geography;
  const place = normalized([geography?.municipalityName, geography?.localityName, bench.locationName].filter(Boolean).join(" "));
  const canton = normalized(geography?.cantonName ?? bench.locationCanton);

  if (canton.includes("graubunden") || canton.includes("grisons") || canton.includes("grigioni")) {
    if (italianGraubuenden.test(place) || (bench.latitude < 46.45 && bench.longitude > 9.35)) return "itGraubuenden";
    return romanshRegion(place, bench.latitude, bench.longitude) ?? "graubuenden";
  }
  if (canton.includes("ticino")) return ticinoSouth.test(place) || bench.latitude < 46.28 ? "itSottoceneri" : "itSopraceneri";
  if (canton.includes("vaud")) return "frVaud";
  if (canton.includes("geneve")) return "frGeneva";
  if (canton.includes("neuchatel")) return "frNeuchatel";
  if (canton === "jura") return "frJura";
  if (canton === "fribourg" || canton === "freiburg") return germanFribourg.test(place) ? "bern" : "frFribourg";
  if (canton === "valais" || canton === "wallis") return bench.longitude < 7.35 ? "frValais" : "wallis";
  if (canton === "bern") return frenchBern.test(place) ? "frJura" : "bern";
  if (canton.includes("basel-stadt")) return "basel";
  if (canton.includes("basel-landschaft") || canton === "aargau" || canton === "solothurn") return "northwest";
  if (canton === "zurich" || canton === "schaffhausen") return "zurich";
  if (/^(st\. gallen|thurgau|appenzell ausserrhoden|appenzell innerrhoden)$/.test(canton)) return "northeast";
  if (/^(luzern|uri|schwyz|obwalden|nidwalden|zug|glarus)$/.test(canton)) return "central";

  // Coarse language-geographic fallback for imported records without a canton.
  if (bench.latitude < 46.55 && bench.longitude > 8.45 && bench.longitude < 9.35) return bench.latitude >= 46.28 ? "itSopraceneri" : "itSottoceneri";
  if (bench.latitude > 47.2 && bench.longitude < 7.45) return "frJura";
  if (bench.latitude < 46.4 && bench.longitude < 6.45) return "frGeneva";
  if (bench.longitude < 7.05) return "frVaud";
  if (bench.latitude < 46.65 && bench.longitude < 7.35) return "frValais";
  if (bench.longitude > 9.25 && bench.latitude < 47.2) return romanshRegion(place, bench.latitude, bench.longitude) ?? "graubuenden";
  if (bench.longitude > 8.85) return "northeast";
  if (bench.longitude > 8.25 && bench.latitude > 47.15) return "zurich";
  if (bench.longitude > 8) return "central";
  if (bench.latitude > 47.42 && bench.longitude < 7.8) return "basel";
  if (bench.longitude < 7.55) return "bern";
  return "northwest";
}

const regionMeta: Record<DialectRegion, LocalBenchProfile & { phrases: string[] }> = {
  basel: { region: "basel", regionLabel: "Baseldytsch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Do kasch di grad e bitzli härehogge.", "S Bänggli meint: Mach emol Pause."] },
  bern: { region: "bern", regionLabel: "Bärndütsch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Da chasch di häreha, für es bitzli z verschnuufe.", "Nume nid jufle: Ds Bänkli louft der nid dervo."] },
  northwest: { region: "northwest", regionLabel: "Nordwestschwiizerisch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Do chasch di grad ane setze und chli verschnuufe.", "S Bänkli het Zyt – und du hoffentlich au."] },
  zurich: { region: "zurich", regionLabel: "Züridütsch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Da chasch di grad anesetze, zum es bitzli verschnuufe.", "Züri isch busy. S Bänkli demonstriert dezue konsequents Nütmache."] },
  northeast: { region: "northeast", regionLabel: "Ostschwiizerisch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Do chasch di anesetze, zum es bitzli verschnuufe.", "Do isch Pause kei Bug, sondern es Feature."] },
  central: { region: "central", regionLabel: "Zentralschwiizerisch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Da chasch di grad häresitze und chli verschnuufe.", "Hock ab. D Wält cha die zwei Minute sälber wiiterdräie."] },
  wallis: { region: "wallis", regionLabel: "Wallisertiitsch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Da chasch di es Bizji häreheie und verschnuufu.", "Ds Bänki steit da, als hetti suscht niid z tüe."] },
  graubuenden: { region: "graubuenden", regionLabel: "Bündnerdütsch", languageTag: "gsw-CH", uiLanguage: "de", phrases: ["Do chasch di grad anesitza und a Wili verschnuufa.", "Do obe isch sogar s Nütmacha landschaftlich wertvoll."] },

  frVaud: { region: "frVaud", regionLabel: "Français vaudois", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Ici, tu peux te poser un moment et souffler.", "Le banc te garde une place, tout tranquillement."] },
  frGeneva: { region: "frGeneva", regionLabel: "Français genevois", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Ici, tu peux faire une vraie pause, même à Genève.", "Le banc dit que le prochain rendez-vous peut attendre."] },
  frValais: { region: "frValais", regionLabel: "Français valaisan · francoprovençal", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Pose-toi un moment; les montagnes ne vont pas bouger.", "Ici, même le banc prend le temps de respirer."] },
  frFribourg: { region: "frFribourg", regionLabel: "Français fribourgeois · francoprovençal", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Assieds-toi un moment; le banc a déjà ralenti.", "Par ici, la pause mérite aussi sa place."] },
  frNeuchatel: { region: "frNeuchatel", regionLabel: "Français neuchâtelois", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Le banc te garde une place pour souffler.", "Ici, le paysage sait très bien ne rien presser."] },
  frJura: { region: "frJura", regionLabel: "Français jurassien · patois d’oïl", languageTag: "fr-CH", uiLanguage: "fr", phrases: ["Côli vait? Le banc, lui, va très bien.", "Pose-toi: dans le Jura, même la pause a plusieurs accents."] },

  itSopraceneri: { region: "itSopraceneri", regionLabel: "Italiano ticinese · Sopraceneri", languageTag: "it-CH", uiLanguage: "it", phrases: ["Qui puoi sederti un momento e tirare il fiato.", "La panchina dice: resta ancora un po’."] },
  itSottoceneri: { region: "itSottoceneri", regionLabel: "Italiano ticinese · Sottoceneri", languageTag: "it-CH", uiLanguage: "it", phrases: ["Fermati un momento: il posto non ha nessuna fretta.", "Questa panchina oggi si sente un salotto panoramico."] },
  itGraubuenden: { region: "itGraubuenden", regionLabel: "Italiano dei Grigioni", languageTag: "it-CH", uiLanguage: "it", phrases: ["Qui puoi riposarti un momento e respirare.", "La panchina sa che la valle non scappa."] },

  rmSursilvan: { region: "rmSursilvan", regionLabel: "Sursilvan · Surselva", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Cheu sas ti seser in mument e trer flad.", "Il baun di: resta aunc in tec."] },
  rmSutsilvan: { region: "rmSutsilvan", regionLabel: "Sutsilvan · Sutselva", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Qua pos ti seser en mument e trer flad.", "Igl banc gi: resta ànc egn mumaint."] },
  rmSurmiran: { region: "rmSurmiran", regionLabel: "Surmiran · Surmeir", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Cò post te seser en mument e trer flad.", "Igl banc dei: resta anc en po."] },
  rmPuter: { region: "rmPuter", regionLabel: "Puter · Engiadin’Ota", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Cò poust tü tschanter ün mumaint e trer il flà.", "La banca disch: resta auncha ün pô."] },
  rmVallader: { region: "rmVallader", regionLabel: "Vallader · Engiadina Bassa", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Qua poust tü tschantar ün mumaint e trar il flà.", "La banca disch: resta amo ün pa."] },
  rmJauer: { region: "rmJauer", regionLabel: "Jauer · Val Müstair", languageTag: "rm-CH", uiLanguage: "rm", phrases: ["Qua poust tü tschantar ün mumaint e trar il flà.", "La banca disch: resta amo ün pa illa Val Müstair."] },
};

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function localLightLine(bench: BenchPlace, language: Language) {
  const lines = bench.sunnyNow === true
    ? { de: "D Sunne isch grad direkt am Platz.", fr: "Le soleil arrive directement sur la place.", it: "Il sole arriva direttamente sulla panchina.", rm: "Il sulegl arriva directamain sin il plaz." }
    : bench.sunnyNow === false
      ? { de: "Am Platz isch grad Schatte.", fr: "La place est à l’ombre en ce moment.", it: "La panchina è all’ombra in questo momento.", rm: "Il plaz è ussa en la sumbriva." }
      : { de: "S Liecht isch no chli es Rätsel.", fr: "La lumière garde encore son mystère.", it: "La luce resta ancora un piccolo mistero.", rm: "La glisch resta anc in pitschen misteri." };
  return lines[language];
}

export function localBenchProfile(bench: BenchPlace): LocalBenchProfile {
  const meta = regionMeta[dialectRegionForBench(bench)];
  return { region: meta.region, regionLabel: meta.regionLabel, languageTag: meta.languageTag, uiLanguage: meta.uiLanguage };
}

export function localLanguageForBench(bench: BenchPlace): Language {
  return regionMeta[dialectRegionForBench(bench)].uiLanguage;
}

export function localBenchVoice(bench: BenchPlace): LocalBenchVoice {
  const region = dialectRegionForBench(bench);
  const meta = regionMeta[region];
  return {
    region,
    regionLabel: meta.regionLabel,
    languageTag: meta.languageTag,
    uiLanguage: meta.uiLanguage,
    first: meta.phrases[hash(`${bench.id}:${region}`) % meta.phrases.length],
    second: localLightLine(bench, meta.uiLanguage),
  };
}
