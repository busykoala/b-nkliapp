import { sqlite } from "@/db/client";
import { wgs84ToLv95 } from "./elevation";

export type WeatherGrid = { valid_at: string; origin_easting: number; origin_northing: number; resolution_meters: number; width: number; height: number; values_blob: Buffer; nodata_value: number | null };
export function loadWeatherGrid(parameter: string): WeatherGrid | null {
  return sqlite.prepare("SELECT valid_at,origin_easting,origin_northing,resolution_meters,width,height,values_blob,nodata_value FROM weather_snapshots WHERE parameter=? ORDER BY valid_at DESC LIMIT 1").get(parameter) as WeatherGrid | undefined ?? null;
}
export function sampleWeatherGrid(row: WeatherGrid, latitude: number, longitude: number): number | null {
  const point = wgs84ToLv95(latitude, longitude);
  const column = Math.round((point.easting - row.origin_easting) / row.resolution_meters), line = Math.round((point.northing - row.origin_northing) / row.resolution_meters);
  if (column < 0 || line < 0 || column >= row.width || line >= row.height) return null;
  const offset = (line * row.width + column) * 4;
  if (offset + 4 > row.values_blob.length) return null;
  const value = row.values_blob.readFloatLE(offset);
  return !Number.isFinite(value) || (row.nodata_value !== null && Math.abs(value - row.nodata_value) < 1e-5) ? null : value;
}
