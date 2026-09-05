import { DATA_PROVIDERS } from "@/data/runtime.generated";

function csvRows(input: string) {
  const [header, ...rows] = input.trim().split(/\r?\n/);
  const fields = header.split(";");
  return rows.map((line) => Object.fromEntries(line.split(";").map((value, index) => [fields[index], value])));
}

async function fetchCsv(url: string, revalidate: number, timeout: number) {
  const response = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`MeteoSchweiz antwortet mit ${response.status}`);
  return csvRows(new TextDecoder("iso-8859-1").decode(await response.arrayBuffer()));
}

export function loadWeatherStationRows() {
  return fetchCsv(DATA_PROVIDERS.meteoStationMetadataUrl, 86_400, 6_000);
}

export async function loadLatestStationMeasurement(station: string) {
  const url = DATA_PROVIDERS.meteoStationCurrentTemplate.replaceAll("{station}", encodeURIComponent(station));
  return (await fetchCsv(url, 600, 5_000)).at(-1);
}
