export type LocalWeather = {
  temperatureC: number;
  precipitationMm10: number | null;
  sunshineMinutes10: number | null;
  windKmh: number | null;
  location: string;
  observedAt: string;
  source: "MeteoSchweiz";
};

type ForecastPoint = { id: string; name: string; latitude: number; longitude: number };

let weatherCache: { expiresAt: number; value: Promise<ForecastPoint[]> } | null = null;

function csvRows(input: string) {
  const [header, ...rows] = input.trim().split(/\r?\n/);
  const fields = header.split(";");
  return rows.map((line) => Object.fromEntries(line.split(";").map((value, index) => [fields[index], value])));
}

async function fetchCsv(url: string, revalidate: number, timeout: number) {
  const response = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`MeteoSchweiz antwortet mit ${response.status}`);
  return new TextDecoder("iso-8859-1").decode(await response.arrayBuffer());
}

async function loadForecast() {
  const stationCsv = await fetchCsv("https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv", 86_400, 6_000);
  return csvRows(stationCsv).map((row) => ({ id: row.station_abbr, name: row.station_name, latitude: Number(row.station_coordinates_wgs84_lat), longitude: Number(row.station_coordinates_wgs84_lon) }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

export async function getLocalWeather(latitude: number, longitude: number): Promise<LocalWeather | null> {
  try {
    if (!weatherCache || weatherCache.expiresAt < Date.now()) weatherCache = { expiresAt: Date.now() + 30 * 60 * 1000, value: loadForecast() };
    const points = await weatherCache.value;
    const nearest = points.reduce<ForecastPoint | null>((best, point) => !best || Math.hypot((point.latitude - latitude) * 111, (point.longitude - longitude) * 75) < Math.hypot((best.latitude - latitude) * 111, (best.longitude - longitude) * 75) ? point : best, null);
    if (!nearest) return null;
    const station = nearest.id.toLocaleLowerCase("en-US");
    const measurements = await fetchCsv(`https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${station}/ogd-smn_${station}_t_now.csv`, 600, 5_000);
    const latest = csvRows(measurements).at(-1);
    const temperatureC = Number(latest?.tre200s0);
    const optionalNumber = (value: string | undefined) => value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
    return Number.isFinite(temperatureC) ? {
      temperatureC,
      precipitationMm10: optionalNumber(latest?.rre150z0),
      sunshineMinutes10: optionalNumber(latest?.sre000z0),
      windKmh: optionalNumber(latest?.fu3010z0),
      observedAt: latest?.reference_timestamp ?? "",
      location: nearest.name,
      source: "MeteoSchweiz",
    } : null;
  } catch { return null; }
}
