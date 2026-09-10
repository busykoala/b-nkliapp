import { writeFile } from "node:fs/promises";

const endpoint = "https://www.pxweb.bfs.admin.ch/api/v1/de/px-x-0102010000_101/px-x-0102010000_101.px";
const year = "2025";
const locationCode = "Kanton (-) / Bezirk (>>) / Gemeinde (......)";

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: [
      { code: "Jahr", selection: { filter: "item", values: [year] } },
      { code: locationCode, selection: { filter: "all", values: ["*"] } },
      { code: "Bevölkerungstyp", selection: { filter: "item", values: ["1"] } },
      { code: "Staatsangehörigkeit (Kategorie)", selection: { filter: "item", values: ["-99999"] } },
      { code: "Geschlecht", selection: { filter: "item", values: ["-99999"] } },
      { code: "Alter", selection: { filter: "item", values: ["-99999"] } },
    ],
    response: { format: "json-stat2" },
  }),
});

if (!response.ok) throw new Error(`BFS population request failed: ${response.status}`);
const data = await response.json() as {
  source?: string;
  updated?: string;
  value: Array<number | null>;
  dimension: Record<string, { category: { index: Record<string, number>; label: Record<string, string> } }>;
};
const locations = data.dimension[locationCode]?.category;
if (!locations || !Array.isArray(data.value)) throw new Error("BFS population response has an unexpected shape");

const population = Object.entries(locations.index).flatMap(([code, position]) => {
  const label = locations.label[code] ?? "";
  const value = data.value[position];
  if (!/^\d{4}$/.test(code) || !label.startsWith("......") || typeof value !== "number" || value <= 0) return [];
  return [[String(Number(code)), value] as const];
}).sort(([left], [right]) => Number(left) - Number(right));

if (population.length < 2_000) throw new Error(`Expected at least 2,000 municipalities, received ${population.length}`);

const output = {
  year: Number(year),
  updated: data.updated ?? null,
  source: data.source ?? "BFS – STATPOP",
  endpoint,
  population: Object.fromEntries(population),
};
await writeFile(new URL("../src/features/statistics/municipality-population.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${population.length} municipality populations for ${year}.`);
