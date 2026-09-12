import type { BenchDetail } from "./types";

export type DialectMode = "off" | "regional" | "playful";
export type DialectRegion = "basel" | "bern" | "northwest" | "zurich" | "northeast" | "central" | "wallis" | "graubuenden" | "romansh" | "romandy" | "ticino";

export type LocalBenchVoice = {
  region: DialectRegion;
  regionLabel: string;
  languageTag: string;
  first: string;
  second: string;
};

type BenchPlace = Pick<BenchDetail, "id" | "latitude" | "longitude" | "locationName" | "locationCanton" | "sunnyNow" | "shadeCause" | "inForest" | "waterfront" | "viewLabels"> & {
  knowledge?: Pick<NonNullable<BenchDetail["knowledge"]>, "geography">;
};

const germanFribourg = /\b(murten|morat|düdingen|tafers|plaffeien|sense|kerzers)\b/i;
const romanshPlaces = /\b(scuol|zernez|samedan|samaden|pontresina|puntraschigna|disentis|mustér|ilanz|glion|savognin|surses|val müstair|müstair|falera|laax|flims)\b/i;
const italianGraubuenden = /\b(poschiavo|brusio|bregaglia|mesocco|roveredo|calanca|soazza)\b/i;

function normalized(value: string | null | undefined) {
  return value?.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de-CH") ?? "";
}

/**
 * This is intentionally a broad regional approximation. Swiss German is a
 * continuum, not a set of canton-shaped language boxes. Named geography wins;
 * coordinates only provide a useful fallback for benches without place data.
 */
export function dialectRegionForBench(bench: BenchPlace): DialectRegion {
  const geography = bench.knowledge?.geography;
  const place = [geography?.municipalityName, geography?.localityName, bench.locationName].filter(Boolean).join(" ");
  const canton = normalized(geography?.cantonName ?? bench.locationCanton);

  if (canton.includes("graubunden") || canton.includes("grisons")) {
    if (italianGraubuenden.test(place)) return "ticino";
    if (romanshPlaces.test(place)) return "romansh";
    return "graubuenden";
  }
  if (canton.includes("ticino")) return "ticino";
  if (/^(vaud|geneve|neuchatel|jura)$/.test(canton)) return "romandy";
  if (canton === "fribourg" || canton === "freiburg") return germanFribourg.test(place) ? "bern" : "romandy";
  if (canton === "valais" || canton === "wallis") return bench.longitude < 7.35 ? "romandy" : "wallis";
  if (canton.includes("basel-stadt")) return "basel";
  if (canton.includes("basel-landschaft") || canton === "aargau" || canton === "solothurn") return "northwest";
  if (canton === "bern") return "bern";
  if (canton === "zurich" || canton === "schaffhausen") return "zurich";
  if (/^(st\. gallen|thurgau|appenzell ausserrhoden|appenzell innerrhoden)$/.test(canton)) return "northeast";
  if (/^(luzern|uri|schwyz|obwalden|nidwalden|zug|glarus)$/.test(canton)) return "central";

  // Coarse language-geographic fallback for records whose OSM address has no canton.
  if (bench.latitude < 46.55 && bench.longitude > 8.45 && bench.longitude < 9.35) return "ticino";
  if (bench.longitude < 7.05) return "romandy";
  if (bench.latitude < 46.45 && bench.longitude < 7.5) return "romandy";
  if (bench.latitude < 46.65 && bench.longitude >= 7.35 && bench.longitude < 8.55) return "wallis";
  if (bench.longitude > 9.25 && bench.latitude < 47.2) return "graubuenden";
  if (bench.longitude > 8.85) return "northeast";
  if (bench.longitude > 8.25 && bench.latitude > 47.15) return "zurich";
  if (bench.longitude > 8.0) return "central";
  if (bench.latitude > 47.42 && bench.longitude < 7.8) return "basel";
  if (bench.longitude < 7.55) return "bern";
  return "northwest";
}

const regionMeta: Record<DialectRegion, { label: string; languageTag: string; regional: string[]; playful: string[] }> = {
  basel: {
    label: "Baseldytsch", languageTag: "gsw-CH",
    regional: ["Do kasch di grad e bitzli härehogge.", "S Bänggli meint: Mach emol Pause."],
    playful: ["Ganz ehrlig: Das Bänggli duet, als wär Pause Hochkultur.", "Basel chillt – und das Bänggli het dr beschti Platz reserviert."],
  },
  bern: {
    label: "Bärndütsch", languageTag: "gsw-CH",
    regional: ["Da chasch di häreha, für es bitzli z verschnuufe.", "Nume nid jufle: Ds Bänkli louft der nid dervo."],
    playful: ["Ds Bänkli macht hüt uf Premium-Lounge – nume nid jufle.", "Hock ab. S Tempo vo däm Bänkli is sowieso sehr bärnisch."],
  },
  northwest: {
    label: "Nordwestschwiizerisch", languageTag: "gsw-CH",
    regional: ["Do chasch di grad ane setze und chli verschnuufe.", "S Bänkli het Zyt – und du hoffentlich au."],
    playful: ["Das Bänkli isch grad offiziell im Fürobe-Modus.", "Hock ab: D Statistik seit zwar nüt, aber dr Platz fühlt sich guet aa."],
  },
  zurich: {
    label: "Züridütsch", languageTag: "gsw-CH",
    regional: ["Da chasch di grad anesetze, zum es bitzli verschnuufe.", "S Bänkli meint: Hock doch schnell ab."],
    playful: ["S Bänkli het grad Main-Character-Energy – aber ganz entspannt.", "Züri isch busy. Das Bänkli demonstriert dezue konsequents Nütmache."],
  },
  northeast: {
    label: "Ostschwiizerisch", languageTag: "gsw-CH",
    regional: ["Do chasch di anesetze, zum es bitzli verschnuufe.", "S Bänkli seit: Hock ab und lueg emol."],
    playful: ["Das Bänkli isch hüt verdächtig gmüetlich unterwegs.", "Do isch Pause kei Bug, sondern es Feature."],
  },
  central: {
    label: "Zentralschwiizerisch", languageTag: "gsw-CH",
    regional: ["Da chasch di grad häresitze und chli verschnuufe.", "S Bänkli wartet scho – hock doch ab."],
    playful: ["Das Bänkli liefert grad Aussicht mit integriertem Ruhemodus.", "Hock ab. D Wält cha die zwei Minute sälber wiiterdräie."],
  },
  wallis: {
    label: "Wallisertiitsch", languageTag: "gsw-CH",
    regional: ["Da chasch di es Bizji häreheie und verschnuufu.", "Ds Bänki steit da, als hetti suscht niid z tüe."],
    playful: ["Ds Bänki macht grad Wellness – ohni Reservation und Bademantu.", "Hock ab. Der Bärg geit der in dene zwei Minütu nid furt."],
  },
  graubuenden: {
    label: "Bündnerdütsch", languageTag: "gsw-CH",
    regional: ["Do chasch di grad anesitza und a Wili verschnuufa.", "S Bänkli meint: Hock ab und luag."],
    playful: ["Das Bänkli het offensichtlich Höhenluft und Selbstvertrauen.", "Do obe isch sogar s Nütmacha landschaftlich wertvoll."],
  },
  romansh: {
    label: "Rumantsch", languageTag: "rm-CH",
    regional: ["Qua pos ti seser in mument e trair flad.", "Il banc ta di: resta anc in pau."],
    playful: ["Quest banc ha oz energia da vacanzas.", "Sesa giu: las muntognas na curran betg davent."],
  },
  romandy: {
    label: "Suisse romande", languageTag: "fr-CH",
    regional: ["Ici, tu peux te poser un moment et souffler.", "Le banc te dit: reste encore un petit peu."],
    playful: ["Ce banc se prend clairement pour une terrasse cinq étoiles.", "Pose-toi: même le paysage a activé le mode tranquille."],
  },
  ticino: {
    label: "Svizzera italiana", languageTag: "it-CH",
    regional: ["Qui puoi sederti un momento e tirare il fiato.", "La panchina dice: resta ancora un po’."],
    playful: ["Questa panchina oggi si sente un salotto panoramico.", "Siediti: anche il paesaggio ha messo la modalità tranquilla."],
  },
};

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function localLightLine(bench: BenchPlace, region: DialectRegion, playful: boolean) {
  const sunny = bench.sunnyNow === true;
  const shaded = bench.sunnyNow === false;
  const lines: Record<"de" | "fr" | "it" | "rm", string> = sunny
    ? { de: playful ? "D Sunne git der Szene grad unnötig viel Drama." : "D Sunne isch grad direkt am Platz.", fr: "Le soleil arrive directement sur la place.", it: "Il sole arriva direttamente sulla panchina.", rm: "Il sulegl arriva directamain sin il plaz." }
    : shaded
      ? { de: playful ? "Dr Schatte macht uf exklusive VIP-Zone." : "Am Platz isch grad Schatte.", fr: "La place est à l’ombre en ce moment.", it: "La panchina è all’ombra in questo momento.", rm: "Il plaz è ussa en la sumbriva." }
      : { de: "S Liecht isch no chli es Rätsel.", fr: "La lumière garde encore son mystère.", it: "La luce resta ancora un piccolo mistero.", rm: "La glisch resta anc in pitschen misteri." };
  if (region === "romandy") return lines.fr;
  if (region === "ticino") return lines.it;
  if (region === "romansh") return lines.rm;
  return lines.de;
}

export function localBenchVoice(bench: BenchPlace, mode: Exclude<DialectMode, "off">): LocalBenchVoice {
  const region = dialectRegionForBench(bench);
  const meta = regionMeta[region];
  const phrases = meta[mode];
  const seed = hash(`${bench.id}:${region}:${mode}`);
  return {
    region,
    regionLabel: meta.label,
    languageTag: meta.languageTag,
    first: phrases[seed % phrases.length],
    second: localLightLine(bench, region, mode === "playful"),
  };
}
