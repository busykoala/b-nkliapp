import { sqlite } from "@/db/client";
import { wgs84ToLv95 } from "@/lib/elevation";

export type WeatherGrid = {
  valid_at: string;
  origin_easting: number;
  origin_northing: number;
  resolution_meters: number;
  width: number;
  height: number;
  values_blob: Buffer;
  nodata_value: number | null;
};

type WeatherSampleRow = {
  valid_at: string;
  value_blob: Buffer | null;
  column_index: number;
  row_index: number;
  width: number;
  height: number;
  nodata_value: number | null;
};

export function readWeatherSample(parameter: string, easting: number, northing: number) {
  const row = sqlite.prepare(`
    WITH latest AS (
      SELECT valid_at,origin_easting,origin_northing,resolution_meters,width,height,values_blob,nodata_value
      FROM weather_snapshots WHERE parameter=? ORDER BY valid_at DESC LIMIT 1
    ), point AS (
      SELECT *,
        CAST(round((? - origin_easting) / resolution_meters) AS INTEGER) column_index,
        CAST(round((? - origin_northing) / resolution_meters) AS INTEGER) row_index
      FROM latest
    )
    SELECT valid_at,width,height,nodata_value,column_index,row_index,
      CASE WHEN column_index BETWEEN 0 AND width - 1 AND row_index BETWEEN 0 AND height - 1
        THEN substr(values_blob, ((row_index * width + column_index) * 4) + 1, 4)
        ELSE NULL END value_blob
    FROM point
  `).get(parameter, easting, northing) as WeatherSampleRow | undefined;
  if (!row?.value_blob || row.value_blob.length !== 4) return null;
  const value = row.value_blob.readFloatLE(0);
  return !Number.isFinite(value) || (row.nodata_value !== null && Math.abs(value - row.nodata_value) < 1e-5)
    ? null
    : { value, validAt: row.valid_at };
}

// Route analysis samples one loaded grid many times. Keep the bulk reader for
// that job; bench detail reads use readWeatherSample so one point never copies
// a national raster into memory.
export function loadWeatherGrid(parameter: string): WeatherGrid | null {
  return sqlite.prepare(`
    SELECT valid_at,origin_easting,origin_northing,resolution_meters,width,height,values_blob,nodata_value
    FROM weather_snapshots WHERE parameter=? ORDER BY valid_at DESC LIMIT 1
  `).get(parameter) as WeatherGrid | undefined ?? null;
}

export function sampleWeatherGrid(row: WeatherGrid, latitude: number, longitude: number): number | null {
  const point = wgs84ToLv95(latitude, longitude);
  const column = Math.round((point.easting - row.origin_easting) / row.resolution_meters);
  const line = Math.round((point.northing - row.origin_northing) / row.resolution_meters);
  if (column < 0 || line < 0 || column >= row.width || line >= row.height) return null;
  const offset = (line * row.width + column) * 4;
  if (offset + 4 > row.values_blob.length) return null;
  const value = row.values_blob.readFloatLE(offset);
  return !Number.isFinite(value) || (row.nodata_value !== null && Math.abs(value - row.nodata_value) < 1e-5) ? null : value;
}
