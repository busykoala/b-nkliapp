export const HORIZON_DISTANCES_METERS = [10, 25, 50, 75, 100, 150, ...Array.from({ length: 100 }, (_, index) => (index + 1) * 200)];
/**
 * Official swisstopo approximation from WGS84 coordinates to LV95.
 * It is accurate enough to address the point-height service's terrain grid.
 */
export function wgs84ToLv95(latitude: number, longitude: number) {
  const latitudeAux = (latitude * 3600 - 169_028.66) / 10_000;
  const longitudeAux = (longitude * 3600 - 26_782.5) / 10_000;
  const easting = 2_600_072.37
    + 211_455.93 * longitudeAux
    - 10_938.51 * longitudeAux * latitudeAux
    - 0.36 * longitudeAux * latitudeAux ** 2
    - 44.54 * longitudeAux ** 3;
  const northing = 1_200_147.07
    + 308_807.95 * latitudeAux
    + 3_745.25 * longitudeAux ** 2
    + 76.63 * latitudeAux ** 2
    - 194.56 * longitudeAux ** 2 * latitudeAux
    + 119.79 * latitudeAux ** 3;
  return { easting, northing };
}
