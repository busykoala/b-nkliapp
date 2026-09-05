import { useId, type CSSProperties, type ReactNode } from "react";
import type { BenchDetail } from "@/lib/types";
import { benchSceneArt, benchSpriteArt, seasonOverlayArt } from "@/lib/bench-scene-art";
import { benchPlacement } from "@/lib/bench-placement";

function knownProperty(bench: BenchDetail, label: string) {
  return bench.properties.find((item) => item.label === label)?.value ?? "Unbekannt";
}

/** The environment supplies perspective and grounding; only light, weather,
 * season and the actual bench construction are layered onto the painting. */
export function BenchLandscape({ bench, children }: { bench: BenchDetail; children?: ReactNode }) {
  const instance = useId().replaceAll(":", "");
  const id = `scene-${instance}`;
  const hasWater = Boolean(bench.waterfront) || bench.viewLabels.some((label) => /see|wasser/i.test(label));
  const snowCover = bench.weather?.snowCoverPercent ?? (bench.weather?.precipitationType === "snow" ? 18 : 0);
  const scene = benchSceneArt({ landContext: bench.landContext, buildingCount100m: bench.buildingCount100m, buildingObstructionPercent: bench.buildingObstructionPercent, hasWater, snowCoverPercent: snowCover, elevationMeters: bench.elevationMeters });
  const sceneKind = scene.match(/scene-(\w+)[.-]/)?.[1] ?? "country";
  const backrest = knownProperty(bench, "Rückenlehne") !== "Nein";
  const armrests = knownProperty(bench, "Armlehnen") === "Ja";
  const covered = knownProperty(bench, "Überdacht") === "Ja";
  const asset = benchSpriteArt({ material: knownProperty(bench, "Material"), backrest, armrests });
  const seats = Number.parseInt(knownProperty(bench, "Sitzplätze"), 10);
  const placement = benchPlacement(sceneKind, asset, seats);
  const weather = bench.weather;
  const cloudCover = weather?.cloudCover ?? 0;
  const precipitation = weather?.precipitationType ?? "none";
  const raining = precipitation === "rain" || precipitation === "mixed";
  const snowing = precipitation === "snow" || precipitation === "mixed";
  const night = bench.dayPhase === "night";
  // Native SVG filters also work on external SVG <image> content in WebKit;
  // CSS filter chains on the enclosing group can leave the raw sprite visible.
  const pigment = night ? { saturation: .5, slope: .624, red: .09, green: .096, blue: .103 }
    : bench.sunnyNow ? { saturation: .7, slope: .806, red: .14, green: .127, blue: .112 }
      : { saturation: .66, slope: .73, red: .126, green: .115, blue: .102 };
  const sunVisible = bench.sunAltitudeDegrees > 0 && cloudCover < .7;
  const moonVisible = bench.moonVisible && cloudCover < .7;
  const illumination = Math.max(0, Math.min(1, bench.moonIllumination));
  const moonRadius = 22;
  const terminatorRadius = Math.max(.01, Math.abs(2 * illumination - 1) * moonRadius);
  // Mask low celestial discs out before the roof/tree line.
  const altitude = sunVisible ? bench.sunAltitudeDegrees : bench.moonAltitudeDegrees;
  const azimuth = sunVisible ? bench.sunAzimuthDegrees : bench.moonAzimuthDegrees;
  const skyX = 70 + Math.max(0, Math.min(1, azimuth / 360)) * 500;
  const skyY = Math.max(36, Math.min(128, 135 - altitude * 1.3));
  const aria = [night ? "Nacht" : bench.sunnyNow === null ? "Lichtlage noch offen" : bench.sunnyNow ? "Die Bank liegt in der Sonne" : "Die Bank liegt im Schatten",
    raining && snowing ? "Schneeregen" : raining ? "Regen" : snowing ? "Schneefall" : null,
    hasWater ? "am Wasser" : null, bench.inForest ? "im Wald" : null,
    backrest ? "mit Rückenlehne" : "ohne Rückenlehne"].filter(Boolean).join(", ");
  const style = { "--scene-sun-x": `${skyX / 6.4}%` } as CSSProperties;

  return <figure className={`bench-landscape painted-scene scene-${sceneKind} phase-${bench.dayPhase} season-${bench.season} ${bench.sunnyNow ? "light-sunny" : "light-shade"} ${raining ? "is-raining" : ""} ${snowCover > 15 ? "has-snow" : ""}`} style={style} aria-label={aria}>
    <svg viewBox="0 0 640 480" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1"><stop offset="0" stopColor="white" /><stop offset=".62" stopColor="white" /><stop offset="1" stopColor="black" /></linearGradient>
        <mask id={`${id}-sky-mask`}>
          {sceneKind === "harbour" ? <>
            <rect width="640" height="40" fill={`url(#${id}-sky)`} />
            <rect x="150" width="340" height="150" fill={`url(#${id}-sky)`} />
          </> : <rect width="640" height={sceneKind === "forest" || sceneKind === "city" ? 70 : 140} fill={`url(#${id}-sky)`} />}
        </mask>
        <linearGradient id={`${id}-snow`} x2="0" y2="1"><stop offset=".6" stopColor="black" /><stop offset="1" stopColor="white" /></linearGradient>
        <mask id={`${id}-snow-mask`}><rect width="640" height="480" fill={`url(#${id}-snow)`} /></mask>
        <radialGradient id={`${id}-light`}><stop stopColor={night ? "#a8bfd0" : "#fff0b6"} stopOpacity=".32" /><stop offset="1" stopColor="#fff0b6" stopOpacity="0" /></radialGradient>
        <filter id={`${id}-ground`} x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id={`${id}-contact`} x="-50%" y="-150%" width="200%" height="400%"><feGaussianBlur stdDeviation="1.2" /></filter>
        <filter id={`${id}-bench-pigment`} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="-140" y="-93" width="280" height="192" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values={String(pigment.saturation)} />
          <feComponentTransfer>
            <feFuncR type="linear" slope={pigment.slope} intercept={pigment.red} />
            <feFuncG type="linear" slope={pigment.slope} intercept={pigment.green} />
            <feFuncB type="linear" slope={pigment.slope} intercept={pigment.blue} />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
        <clipPath id={`${id}-moon-phase`}><path transform={`translate(${skyX} ${skyY}) scale(${bench.moonPhase <= .5 ? 1 : -1} 1)`} d={`M0 -${moonRadius}A${moonRadius} ${moonRadius} 0 0 1 0 ${moonRadius}A${terminatorRadius} ${moonRadius} 0 0 ${illumination >= .5 ? 1 : 0} 0 -${moonRadius}Z`} /></clipPath>
      </defs>
      <rect className="painting-paper" width="640" height="480" />
      <image className="painting-environment" href={scene} width="640" height="480" preserveAspectRatio="xMidYMid slice" />
      {(sunVisible || moonVisible) && <g mask={`url(#${id}-sky-mask)`} className="painting-sky-light">
        <ellipse cx={skyX} cy={skyY} rx="90" ry="70" fill={`url(#${id}-light)`} />
        <image clipPath={sunVisible ? undefined : `url(#${id}-moon-phase)`} href={`/ui-art/v1/celestial-${sunVisible ? "sun" : "moon"}-v1.webp`} x={skyX - 25} y={skyY - 25} width="50" height="50" />
      </g>}
      {cloudCover > .25 && <image className="painting-clouds" href="/ui-art/v1/weather-cloud-v1.webp" x="40" y="-20" width="560" height="160" opacity={Math.min(.4, cloudCover * .42)} />}
      {(bench.season === "autumn" || bench.season === "spring") && <image className="painting-season" href={seasonOverlayArt(bench.season)} x="0" y="200" width="640" height="280" preserveAspectRatio="none" />}
      {snowCover > 5 && snowCover < 25 && <image className="painting-snow-ground" mask={`url(#${id}-snow-mask)`} href={seasonOverlayArt("winter")} width="640" height="480" opacity={Math.min(.3, snowCover / 120)} preserveAspectRatio="none" />}
      <rect className="painting-atmosphere" width="640" height="480" />
      {bench.sunnyNow && <ellipse cx={skyX} cy="350" rx="280" ry="220" fill={`url(#${id}-light)`} />}
      <g transform={placement.transform} className="painting-grounding" aria-hidden="true">
        <ellipse className="painting-contact-shadow" cx={placement.centre.x} cy={placement.centre.y} rx="98" ry="17" transform={`rotate(10 ${placement.centre.x} ${placement.centre.y})`} filter={`url(#${id}-ground)`} />
        {placement.contacts.map((point, index) => <ellipse key={index} className="painting-foot-shadow" cx={point.x} cy={point.y} rx={placement.contactRadius} ry="2.2" filter={`url(#${id}-contact)`} />)}
      </g>
      {covered && <svg className="painting-shelter" x="110" y="170" width="420" height="280" viewBox="0 0 1536 1024">
        <defs><clipPath id={`${id}-shelter`}>
          {/* The generator supplied an opaque atlas. Trace the timber silhouette
              in its native coordinates so none of its background is displayed. */}
          <path d="M81 370 231 131 250 88 273 89 1229 173 1240 190 1299 218 1310 236 1372 272 1384 295 1467 354 1440 389 1274 377 1269 411 1092 412 1036 485 998 508 995 786 950 786 950 510 906 472 884 417 640 417 595 490 575 512 576 797 534 797 532 513 501 467 475 415 423 411 423 923 343 925 337 422 281 394 191 389 135 380 125 395Z" />
          <path d="M1222 383 1294 377 1305 872 1269 878 1227 867Z" />
        </clipPath></defs>
        <image href="/ui-art/v2/bench-shelter.webp" width="1536" height="1024" clipPath={`url(#${id}-shelter)`} />
      </svg>}
      <g className="painting-bench" transform={placement.transform}>
        <image filter={`url(#${id}-bench-pigment)`} href={asset} x="-132" y="-85" width="264" height="176" preserveAspectRatio="xMidYMid meet" />
      </g>
      {raining && <g className="painting-rain">{Array.from({ length: 26 }, (_, i) => <path key={i} d={`M${28 + (i * 79) % 590} ${70 + (i * 43) % 340}l-4 ${9 + i % 7}`} />)}</g>}
      {snowing && <g className="painting-snowfall">{Array.from({ length: 32 }, (_, i) => <circle key={i} cx={20 + (i * 113) % 600} cy={20 + (i * 73) % 420} r={.7 + (i % 3) * .45} />)}</g>}
    </svg>
    {weather && <span className="sr-only">{Math.round(weather.temperatureC)} Grad Celsius, {raining ? "Regen" : snowing ? "Schnee" : "trocken"}, MeteoSchweiz</span>}
    {night && <span className="sr-only">Mond {Math.round(bench.moonIllumination * 100)} Prozent beleuchtet</span>}
    {children}
  </figure>;
}
