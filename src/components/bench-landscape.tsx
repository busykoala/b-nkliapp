import type { CSSProperties } from "react";
import type { BenchDetail } from "@/lib/types";

function knownProperty(bench: BenchDetail, label: string) {
  return bench.properties.find((item) => item.label === label)?.value ?? "Unbekannt";
}

function hasView(bench: BenchDetail, fragment: string) {
  return bench.viewLabels.some((label) => label.toLocaleLowerCase("de-CH").includes(fragment));
}

export function BenchLandscape({ bench }: { bench: BenchDetail }) {
  const progress = Math.max(.04, Math.min(.96, bench.daylightProgress));
  const celestialX = 58 + progress * 524;
  const celestialY = 176 - Math.sin(progress * Math.PI) * 118;
  const isNight = bench.dayPhase === "night";
  const moonVisible = isNight && bench.moonVisible;
  const moonMaskOffset = (1 - bench.moonIllumination) * 38 * (bench.moonPhase <= .5 ? 1 : -1);
  const hasWater = Boolean(bench.waterfront) || hasView(bench, "see") || hasView(bench, "wasser");
  const hasMountains = hasView(bench, "berg") || (bench.viewScore ?? 0) >= 3;
  const isUrban = bench.landContext === "urban" || (bench.buildingCount100m ?? 0) >= 5;
  const treeCount = bench.canopyContext === "dense" || bench.inForest ? 5 : bench.canopyContext === "partial" ? 3 : 1;
  const backrest = knownProperty(bench, "Rückenlehne") === "Ja";
  const armrests = knownProperty(bench, "Armlehnen") === "Ja";
  const covered = knownProperty(bench, "Überdacht") === "Ja";
  const material = knownProperty(bench, "Material").toLocaleLowerCase("de-CH");
  const seats = Number.parseInt(knownProperty(bench, "Sitzplätze"), 10);
  const benchScale = Number.isFinite(seats) ? seats <= 2 ? .84 : seats >= 6 ? 1.2 : 1 : 1;
  const benchColor = material.includes("stein") || material.includes("beton") ? "#7d8178" : material.includes("metall") ? "#3f5751" : "#a7693f";
  const shadowLength = Math.max(22, Math.min(132, 88 - bench.sunAltitudeDegrees * 1.2));
  const shadowDirection = bench.sunAzimuthDegrees > 180 ? -1 : 1;
  const raining = (bench.weather?.precipitationMm10 ?? 0) > 0;
  const windy = (bench.weather?.windKmh ?? 0) >= 15;
  const cloudCover = bench.weather?.cloudCover ?? 0;
  const cloudCount = raining || cloudCover >= .72 ? 3 : cloudCover >= .42 ? 2 : cloudCover >= .18 ? 1 : 0;
  const temperatureMood = bench.weather ? bench.weather.temperatureC <= 5 ? "cold" : bench.weather.temperatureC >= 27 ? "hot" : bench.weather.temperatureC >= 18 ? "warm" : "mild" : "mild";
  const rating = bench.ratingAverage === null ? null : Math.max(1, Math.min(5, Math.round(bench.ratingAverage)));
  const style = {
    "--sun-x": `${celestialX}px`,
    "--sun-y": `${isNight ? 70 : celestialY}px`,
    "--shadow-x": `${shadowDirection * shadowLength}px`,
    "--bench-color": benchColor,
    "--cloud-opacity": `${Math.max(.42, Math.min(.9, cloudCover))}`,
  } as CSSProperties;
  const aria = [
    isNight ? "Nacht" : bench.sunnyNow ? "Die Bank liegt in der Sonne" : "Die Bank liegt im Schatten",
    hasWater ? "am Wasser" : null,
    hasMountains ? "mit Bergblick" : null,
    bench.inForest ? "zwischen Bäumen" : null,
    backrest ? "mit Rückenlehne" : null,
  ].filter(Boolean).join(", ");

  return (
    <figure className={`bench-landscape phase-${bench.dayPhase} temperature-${temperatureMood}`} style={style} aria-label={aria}>
      <svg viewBox="0 0 640 390" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`sky-${bench.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop className="sky-top" offset="0" />
            <stop className="sky-bottom" offset="1" />
          </linearGradient>
          <filter id={`soft-${bench.id}`}><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <rect width="640" height="390" fill={`url(#sky-${bench.id})`} />
        <rect className="scene-temperature-wash" width="640" height="390" />
        {cloudCover > .55 && <rect className="scene-cloud-wash" width="640" height="390" opacity={Math.min(.24, (cloudCover - .45) * .46)} />}
        {isNight && <g className="scene-stars"><circle cx="92" cy="62" r="2" /><circle cx="174" cy="102" r="1.5" /><circle cx="310" cy="54" r="1.8" /><circle cx="520" cy="112" r="1.4" /><circle cx="586" cy="48" r="2" /></g>}
        <g className="scene-celestial" transform={`translate(${isNight ? 510 : celestialX} ${isNight ? 68 : celestialY})`} opacity={isNight && !moonVisible ? 0 : 1}>
          <circle className="celestial-glow" r="38" filter={`url(#soft-${bench.id})`} />
          {isNight ? <><circle className="scene-moon" r="21" /><circle className="scene-moon-shadow" cx={moonMaskOffset} r="21" /></> : <circle className="scene-sun" r="19" />}
        </g>
        {cloudCount > 0 && <g className="scene-clouds">
          <g transform="translate(72 49) scale(.92)"><path d="M30 54c3-19 19-31 37-27 12-27 54-23 61 8 26-4 42 29 21 46H27C4 76 6 57 30 54Z" /><path className="cloud-ink" d="M24 78c31 4 87 3 128-1" /></g>
          {cloudCount > 1 && <g transform="translate(380 84) scale(.72)"><path d="M30 54c3-19 19-31 37-27 12-27 54-23 61 8 26-4 42 29 21 46H27C4 76 6 57 30 54Z" /><path className="cloud-ink" d="M24 78c31 4 87 3 128-1" /></g>}
          {cloudCount > 2 && <g transform="translate(230 26) scale(.58)"><path d="M30 54c3-19 19-31 37-27 12-27 54-23 61 8 26-4 42 29 21 46H27C4 76 6 57 30 54Z" /><path className="cloud-ink" d="M24 78c31 4 87 3 128-1" /></g>}
        </g>}
        {raining && <g className="scene-rain">{Array.from({ length: 14 }, (_, index) => <path key={index} d={`M${78 + index * 34} ${138 + (index % 3) * 7}l-9 19`} />)}<path className="rain-ripple" d="M92 304q13-7 26 0M385 283q14-8 28 0M510 315q12-7 24 0" /></g>}
        {windy && <g className="scene-wind"><path d="M32 144c48-22 86 20 126-4 23-13 24-32 6-34-12-1-17 7-14 15M388 176c39-17 70 11 106-8 20-11 20-26 6-28" /></g>}
        {hasMountains && <g className="scene-mountains"><path d="M0 234 93 153l47 39 69-93 85 108 67-82 113 109Z" /><path d="m123 180 17 12 69-93 20 26-20-10-19 30-18-13-34 55Z" className="scene-snow" /></g>}
        {isUrban && <g className="scene-buildings"><path d="M32 216h72v91H32zM116 244h55v63h-55zM505 224h88v83h-88z" /><path d="m27 216 42-31 40 31m390 8 50-39 51 39" /></g>}
        <path className="scene-far-hill" d="M0 236c105-41 177-24 260 17 85 42 188-46 380-20v157H0Z" />
        <path className="scene-near-hill" d="M0 286c109-27 187 27 278 22 104-5 198-64 362-28v110H0Z" />
        {hasWater && <g className="scene-water"><path d="M0 302c111-14 203 18 320 10 109-7 207-35 320-14v92H0Z" /><path d="M32 329c80-8 132 10 211 3m116-1c90-12 151-8 231 2M90 354c75-5 128 7 191 0" /></g>}
        {(bench.distancePathMeters ?? 9999) < 150 && <path className="scene-path" d="M-20 390c132-95 231-81 332-52 92 26 175 4 352-52" />}
        <g className="scene-trees">
          {Array.from({ length: treeCount }, (_, index) => {
            const positions = [[66, 253, .9], [151, 277, .68], [488, 249, .82], [574, 270, .65], [405, 275, .55]] as const;
            const [x, y, scale] = positions[index];
            return <g key={index} transform={`translate(${x} ${y}) scale(${scale})`}><path className="tree-trunk" d="M-5 48h10v46H-5z" /><path className="tree-crown" d="M0-42c23 0 42 19 42 42 0 13-6 24-15 32 2 4 3 9 3 14 0 20-14 35-30 35S-30 66-30 46c0-6 2-12 5-17C-34 21-40 10-40-3c0-22 18-39 40-39Z" /></g>;
          })}
        </g>
        <ellipse className="bench-shadow" cx="322" cy="344" rx={shadowLength} ry="13" transform={`skewX(${shadowDirection * 18})`} />
        {covered && <g className="bench-cover"><path d="M250 249q72-48 144 0v9H250Z" /><path d="M263 254v91m118-91v91" /></g>}
        <g className="drawn-bench" transform={`translate(320 310) scale(${benchScale} 1)`}>
          {backrest && <><path className="bench-board" d="M-78-49q78-8 156 0v17q-78-7-156 0Z" /><path className="bench-frame" d="M-66-38v37m132-37v37" /></>}
          <path className="bench-board" d="M-87-10q87-6 174 0v17q-87 6-174 0Z" />
          <path className="bench-frame" d="M-65 5-75 53M65 5l75 48" />
          {armrests && <path className="bench-frame" d="M-84-25h23v27m145-27H61v27" />}
        </g>
        {rating !== null && <g className="scene-rating" transform="translate(501 352)" aria-label={`${bench.ratingAverage} von 5 Sternen`}>
          <title>{`${bench.ratingAverage} von 5 Sternen`}</title>
          {Array.from({ length: 5 }, (_, index) => <path key={index} className={index < rating ? "is-lit" : undefined} transform={`translate(${index * 24} 0)`} d="M0-8 2-3 8-3 3 1 5 7 0 4-5 7-3 1-8-3-2-3Z" />)}
        </g>}
      </svg>
      {bench.weather && <span className="sr-only">{Math.round(bench.weather.temperatureC)} Grad Celsius, MeteoSchweiz</span>}
      {isNight && <span className="sr-only">Mond {Math.round(bench.moonIllumination * 100)} Prozent beleuchtet</span>}
    </figure>
  );
}
