import { writeFile } from "node:fs/promises";

const base = "https://www.pxweb.bfs.admin.ch/api/v1/de";
const numericCantons = Array.from({ length: 26 }, (_, index) => String(index + 1));
const cantonAbbreviations = ["ZH", "BE", "LU", "UR", "SZ", "OW", "NW", "GL", "ZG", "FR", "SO", "BS", "BL", "SH", "AR", "AI", "SG", "GR", "AG", "TG", "TI", "VD", "VS", "NE", "GE", "JU"];

type Selection = { code: string; selection: { filter: "item" | "all"; values: string[] } };
type JsonStat = {
  label: string;
  dimension: Record<string, { category: { index: Record<string, number>; label: Record<string, string> } }>;
  value: Array<number | null>;
};
type Series = { label: string; year: number; source: string; byCanton: Record<string, number | null> };

const endpoint = (cube: string) => `${base}/${cube}/${cube}.px`;

async function query(cube: string, selections: Selection[]): Promise<JsonStat> {
  const response = await fetch(endpoint(cube), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: selections, response: { format: "json-stat2" } }),
  });
  if (!response.ok) throw new Error(`${cube} request failed: ${response.status} ${await response.text()}`);
  return await response.json() as JsonStat;
}

async function cantonSeries(options: {
  cube: string;
  geography: string;
  geographyValues: string[];
  cantonCode: (value: string) => string;
  selections: Selection[];
  label: string;
  year: number;
}): Promise<Series> {
  const data = await query(options.cube, options.selections);
  const geography = data.dimension[options.geography];
  const byCanton = Object.fromEntries(options.geographyValues.map((value) => {
    const position = geography.category.index[value];
    return [options.cantonCode(value), data.value[position] ?? null];
  }));
  if (Object.values(byCanton).filter((value) => typeof value === "number").length < 20) {
    throw new Error(`${options.label} returned too few canton values`);
  }
  return { label: options.label, year: options.year, source: options.cube, byCanton };
}

const numericCode = (value: string) => value;
const abbreviationCode = (value: string) => String(cantonAbbreviations.indexOf(value) + 1);
const projectionCode = (value: string) => String(Number(value) + 1);
const item = (code: string, values: string[]): Selection => ({ code, selection: { filter: "item", values } });

async function motorcycleSeries(): Promise<Series> {
  const cube = "px-x-1103020100_111";
  const fuelCodes = ["100", "200", "300", "310", "400", "410", "500", "550", "600", "9900"];
  const data = await query(cube, [
    { code: "Gemeinde", selection: { filter: "all", values: ["*"] } }, item("Fahrzeuggruppe", ["6"]), item("Treibstoff", fuelCodes), item("Jahr", ["2024"]),
  ]);
  const municipalityIndex = data.dimension.Gemeinde.category.index;
  const municipalities = Object.keys(municipalityIndex).filter((value) => /^\d+$/.test(value));
  const fuelCount = Object.keys(data.dimension.Treibstoff.category.index).length;
  const byCanton = Object.fromEntries(numericCantons.map((code) => [code, 0])) as Record<string, number>;
  for (const municipality of municipalities) {
    const id = Number(municipality);
    const canton = id <= 299 ? 1 : id <= 999 ? 2 : id <= 1199 ? 3 : id <= 1299 ? 4 : id <= 1399 ? 5
      : id <= 1499 ? 6 : id <= 1599 ? 7 : id <= 1699 ? 8 : id <= 1799 ? 9 : id <= 2399 ? 10
        : id <= 2699 ? 11 : id <= 2759 ? 12 : id <= 2899 ? 13 : id <= 2999 ? 14 : id <= 3099 ? 15
          : id <= 3199 ? 16 : id <= 3499 ? 17 : id <= 3999 ? 18 : id <= 4399 ? 19 : id <= 4999 ? 20
            : id <= 5399 ? 21 : id <= 5999 ? 22 : id <= 6399 ? 23 : id <= 6599 ? 24 : id <= 6699 ? 25 : 26;
    const start = municipalityIndex[municipality] * fuelCount;
    byCanton[String(canton)] += data.value.slice(start, start + fuelCount).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return { label: "Motorräder", year: 2024, source: cube, byCanton };
}

const seriesEntries = await Promise.all([
  cantonSeries({
    cube: "px-x-0102010000_101", geography: "Kanton (-) / Bezirk (>>) / Gemeinde (......)", geographyValues: cantonAbbreviations,
    cantonCode: abbreviationCode, label: "Hundertjährige", year: 2025,
    selections: [item("Jahr", ["2025"]), item("Kanton (-) / Bezirk (>>) / Gemeinde (......)", cantonAbbreviations), item("Bevölkerungstyp", ["1"]), item("Staatsangehörigkeit (Kategorie)", ["-99999"]), item("Geschlecht", ["-99999"]), item("Alter", ["100"])],
  }),
  cantonSeries({
    cube: "px-x-0702000000_108", geography: "Kanton", geographyValues: numericCantons, cantonCode: numericCode,
    label: "Alpakas", year: 2025,
    selections: [item("Beobachtungseinheit", ["29"]), item("Kanton", numericCantons), item("Landwirtschaftliche Produktionszone", ["0"]), item("Betriebssystem", ["0"]), item("Betriebsform", ["0"]), item("Jahr", ["0"])],
  }),
  cantonSeries({
    cube: "px-x-1003020000_102", geography: "Kanton", geographyValues: numericCantons, cantonCode: numericCode,
    label: "Logiernächte deutscher Gäste", year: 2025,
    selections: [item("Jahr", ["2025"]), item("Monat", ["YYYY"]), item("Kanton", numericCantons), item("Herkunftsland", ["11"]), item("Indikator", ["2"])],
  }),
  cantonSeries({
    cube: "px-x-1602010000_101", geography: "Kanton (-) / Gemeinde (......)", geographyValues: cantonAbbreviations, cantonCode: abbreviationCode,
    label: "Kinositzplätze", year: 2025,
    selections: [item("Kanton (-) / Gemeinde (......)", cantonAbbreviations), item("Jahr", ["56"]), item("Kinotyp", ["8"]), item("Infrastruktur", ["2"])],
  }),
  motorcycleSeries(),
  cantonSeries({
    cube: "px-x-1702020000_104", geography: "Kanton", geographyValues: cantonAbbreviations, cantonCode: abbreviationCode,
    label: "Wählerstärke der Grünen", year: 2023,
    selections: [item("Kanton", cantonAbbreviations), item("Jahr", ["2023"]), item("Partei", ["13"]), item("Ergebnisse", ["3"])],
  }),
  cantonSeries({
    cube: "px-x-1903020100_101", geography: "Kanton", geographyValues: numericCantons, cantonCode: numericCode,
    label: "registrierte Straftaten", year: 2025,
    selections: [item("Straftat", ["311.00.T0"]), item("Kanton", numericCantons), item("Ausführungsgrad", ["0"]), item("Aufklärungsgrad", ["0"]), item("Jahr", ["2025"])],
  }),
  cantonSeries({
    cube: "px-x-1404010100_101", geography: "Grossregion (<<) / Kanton (-)", geographyValues: numericCantons, cantonCode: numericCode,
    label: "MRI-Geräte", year: 2024,
    selections: [item("Infrastruktur", ["MRI"]), item("Geräte und Untersuchungen", ["Anzahl_Infra"]), item("Grossregion (<<) / Kanton (-)", numericCantons), item("Jahr", ["2024"])],
  }),
  cantonSeries({
    cube: "px-x-0104020000_107", geography: "Kanton", geographyValues: Array.from({ length: 26 }, (_, index) => String(index)), cantonCode: projectionCode,
    label: "prognostiziertes Bevölkerungswachstum", year: 2055,
    selections: [item("Kanton", Array.from({ length: 26 }, (_, index) => String(index))), item("Szenario-Variante", ["0"]), item("Jahr", ["31"]), item("Beobachtungseinheit", ["0"])],
  }),
  cantonSeries({
    cube: "px-x-1404010100_301", geography: "Grossregion (<<) / Kanton (-)", geographyValues: cantonAbbreviations, cantonCode: abbreviationCode,
    label: "Plätze in sozialmedizinischen Institutionen", year: 2024,
    selections: [item("Beobachtungseinheit", ["Anzahl_Plaetze"]), item("Grossregion (<<) / Kanton (-)", cantonAbbreviations), item("Beherbergungstyp", ["0"]), item("Rechtlich-wirtschaftlicher Status", ["0"]), item("Jahr", ["2024"])],
  }),
  cantonSeries({
    cube: "px-x-1106010100_101", geography: "Kanton", geographyValues: numericCantons, cantonCode: numericCode,
    label: "innerörtliche Nebenstrassenunfälle mit Leichtverletzten", year: 2025,
    selections: [item("Unfallschwere", ["31500"]), item("Kanton", numericCantons), item("Strassenart", ["433"]), item("Unfallort", ["410"]), item("Jahr", ["33"])],
  }),
  cantonSeries({
    cube: "px-x-0703010000_102", geography: "Kantone", geographyValues: numericCantons, cantonCode: numericCode,
    label: "Holzernte", year: 2025,
    selections: [item("Jahr", ["2025"]), item("Forstzone", ["0"]), item("Kantone", numericCantons), item("Eigentümertyp", ["0"]), item("Holzartengruppe", ["0"]), item("Beobachtungseinheit", ["_0"])],
  }),
]);

const keys = ["centenarians", "alpacas", "hotelNights", "cinemaSeats", "motorcycles", "greenVotes", "crimes", "mri", "populationGrowth", "carePlaces", "roadAccidents", "woodHarvest"];
const series = Object.fromEntries(keys.map((key, index) => [key, seriesEntries[index]]));
const sources = Object.fromEntries([...new Set(seriesEntries.map((entry) => entry.source))].map((cube) => [cube, { url: `https://www.pxweb.bfs.admin.ch/pxweb/de/${cube}/${cube}/${cube}.px/` }]));

await writeFile(new URL("../src/features/statistics/external-by-canton.json", import.meta.url), `${JSON.stringify({ sources, series }, null, 2)}\n`);
console.log(`Wrote ${keys.length} external canton series from ${Object.keys(sources).length} BFS cubes.`);
