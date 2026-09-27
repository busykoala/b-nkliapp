export const PANORAMA_MIN_ALTITUDE = -32;
export const PANORAMA_ARTIFACT_MAX_ALTITUDE = 58;
export const PANORAMA_SKY_MAX_ALTITUDE = 88;
export const PANORAMA_SKY_SPAN = PANORAMA_SKY_MAX_ALTITUDE - PANORAMA_MIN_ALTITUDE;

type CatalogStar = {
  id: string;
  rightAscensionHours: number;
  declinationDegrees: number;
  magnitude: number;
  tone: number;
  important: boolean;
};

export type ProjectedStar = CatalogStar & {
  azimuthDegrees: number;
  altitudeDegrees: number;
  leftPercent: number;
  topPercent: number;
  sizePixels: number;
  opacity: number;
};

// J2000 positions for the recognisable guide stars. The denser, unnamed field
// below is painterly context; these anchors make the sky turn with real local
// sidereal time and keep the familiar seasonal constellations in place.
const GUIDE_STARS: CatalogStar[] = [
  ["sirius", 6.7525, -16.716, -1.46, .42], ["canopus", 6.3992, -52.696, -.74, .68],
  ["arcturus", 14.261, 19.182, -.05, .72], ["vega", 18.6156, 38.784, .03, .28],
  ["capella", 5.2782, 45.998, .08, .62], ["rigel", 5.2423, -8.202, .13, .22],
  ["procyon", 7.655, 5.225, .34, .48], ["betelgeuse", 5.9195, 7.407, .42, .9],
  ["achernar", 1.6286, -57.237, .46, .34], ["hadar", 14.0637, -60.373, .61, .3],
  ["altair", 19.8464, 8.868, .77, .4], ["acrux", 12.4433, -63.099, .76, .3],
  ["aldebaran", 4.5987, 16.509, .86, .94], ["spica", 13.4199, -11.161, .98, .25],
  ["antares", 16.4901, -26.432, .91, 1], ["pollux", 7.7553, 28.026, 1.14, .86],
  ["fomalhaut", 22.9608, -29.622, 1.16, .5], ["deneb", 20.6905, 45.28, 1.25, .2],
  ["regulus", 10.1395, 11.967, 1.35, .36], ["castor", 7.5767, 31.888, 1.58, .48],
  ["bellatrix", 5.4189, 6.35, 1.64, .24], ["elnath", 5.4382, 28.608, 1.65, .3],
  ["alnilam", 5.6036, -1.202, 1.69, .32], ["alioth", 12.9005, 55.96, 1.76, .38],
  ["dubhe", 11.0622, 61.751, 1.79, .78], ["mirfak", 3.4054, 49.861, 1.79, .5],
  ["wezen", 7.1399, -26.393, 1.83, .68], ["alkaid", 13.7923, 49.313, 1.86, .24],
  ["sargas", 17.6219, -42.998, 1.86, .58], ["avior", 8.3752, -59.51, 1.86, .78],
  ["menkalinan", 5.9921, 44.948, 1.9, .32], ["atria", 16.8111, -69.028, 1.91, .82],
  ["alhena", 6.6285, 16.399, 1.93, .42], ["peacock", 20.4275, -56.735, 1.94, .3],
  ["mirzam", 6.3783, -17.956, 1.98, .24], ["alphard", 9.4598, -8.659, 1.98, .9],
  ["hamal", 2.1196, 23.463, 2, .88], ["polaris", 2.5303, 89.264, 1.98, .48],
  ["diphda", .7265, -17.987, 2.02, .82], ["nunki", 18.9211, -26.297, 2.05, .32],
  ["mirach", 1.1622, 35.621, 2.05, .88], ["kochab", 14.8451, 74.155, 2.08, .72],
  ["saiph", 5.7959, -9.67, 2.07, .28], ["algol", 3.1361, 40.956, 2.12, .38],
].map(([id, rightAscensionHours, declinationDegrees, magnitude, tone]) => ({
  id: String(id), rightAscensionHours: Number(rightAscensionHours), declinationDegrees: Number(declinationDegrees),
  magnitude: Number(magnitude), tone: Number(tone), important: true,
}));

function fieldStars(count: number): CatalogStar[] {
  let state = 0x6d2b79f5;
  const random = () => {
    state = Math.imul(state ^ state >>> 15, 1 | state);
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
    return ((state ^ state >>> 14) >>> 0) / 4_294_967_296;
  };
  return Array.from({ length: count }, (_, index) => ({
    id: `field-${index}`,
    rightAscensionHours: random() * 24,
    // Uniform on a sphere rather than clustering the decorative field at the poles.
    declinationDegrees: Math.asin(random() * 2 - 1) * 180 / Math.PI,
    magnitude: 3.2 + Math.pow(random(), .58) * 3,
    tone: random(),
    important: false,
  }));
}

export const NIGHT_SKY_CATALOG = [...GUIDE_STARS, ...fieldStars(676)];

function normalizeDegrees(value: number) { return ((value % 360) + 360) % 360; }
function radians(value: number) { return value * Math.PI / 180; }
function degrees(value: number) { return value * 180 / Math.PI; }

export function panoramaSkyTop(altitudeDegrees: number) {
  return Math.max(0, Math.min(100,
    (PANORAMA_SKY_MAX_ALTITUDE - altitudeDegrees) / PANORAMA_SKY_SPAN * 100));
}

export function horizontalStarPosition(star: Pick<CatalogStar, "rightAscensionHours" | "declinationDegrees">, date: Date, latitude: number, longitude: number) {
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
  const centuries = (julianDate - 2_451_545) / 36_525;
  const sidereal = normalizeDegrees(280.46061837 + 360.98564736629 * (julianDate - 2_451_545)
    + .000387933 * centuries * centuries - centuries * centuries * centuries / 38_710_000 + longitude);
  const hourAngle = radians(normalizeDegrees(sidereal - star.rightAscensionHours * 15));
  const declination = radians(star.declinationDegrees);
  const observer = radians(latitude);
  const altitude = Math.asin(Math.sin(declination) * Math.sin(observer)
    + Math.cos(declination) * Math.cos(observer) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(observer)
    - Math.tan(declination) * Math.cos(observer)) + Math.PI;
  return { azimuthDegrees: normalizeDegrees(degrees(azimuth)), altitudeDegrees: degrees(altitude) };
}

export function projectNightSky(date: Date, latitude: number, longitude: number): ProjectedStar[] {
  return NIGHT_SKY_CATALOG.flatMap((star) => {
    const position = horizontalStarPosition(star, date, latitude, longitude);
    if (position.altitudeDegrees <= 0 || position.altitudeDegrees > PANORAMA_SKY_MAX_ALTITUDE) return [];
    const strength = Math.max(.06, Math.min(1, (6.35 - star.magnitude) / 6.2));
    return [{ ...star, ...position, leftPercent: position.azimuthDegrees / 3.6,
      topPercent: panoramaSkyTop(position.altitudeDegrees),
      sizePixels: .85 + Math.pow(strength, 1.7) * 2.35,
      opacity: .24 + Math.pow(strength, 1.22) * .72 }];
  });
}
