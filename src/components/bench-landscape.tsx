import type { CSSProperties, ReactNode } from "react";
import type { BenchDetail } from "@/lib/types";

function knownProperty(bench: BenchDetail, label: string) {
  return bench.properties.find((item) => item.label === label)?.value ?? "Unbekannt";
}

function hasView(bench: BenchDetail, fragment: string) {
  return bench.viewLabels.some((label) => label.toLocaleLowerCase("de-CH").includes(fragment));
}

function skyPosition(azimuth: number, altitude: number) {
  return {
    x: 54 + Math.max(0, Math.min(1, azimuth / 360)) * 532,
    y: Math.max(38, Math.min(204, 198 - altitude * 2.05)),
  };
}

function Cloud({ x, y, scale = 1, kind = "mid" }: { x: number; y: number; scale?: number; kind?: "low" | "mid" | "high" }) {
  return <g className={`scene-cloud cloud-${kind}`} transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M30 54c3-19 19-31 37-27 12-27 54-23 61 8 26-4 42 29 21 46H27C4 76 6 57 30 54Z" />
    <path className="cloud-ink" d="M24 78c31 4 87 3 128-1" />
  </g>;
}

function SeasonalTree({ x, y, scale, season, evergreen = false }: { x: number; y: number; scale: number; season: BenchDetail["season"]; evergreen?: boolean }) {
  const crown: ReactNode = evergreen
    ? <><path className="tree-evergreen" d="M0-60-35 5h22l-29 47h84L13 5h22Z" /></>
    : season === "winter"
      ? <path className="tree-branches" d="M0 48V-38m0 28-27-25m27 11 25-29M0 12-33-12m33 8 34-20M-19-27l-8-22m47 10 8-18" />
      : <><path className="tree-crown" d="M0-42c23 0 42 19 42 42 0 13-6 24-15 32 2 4 3 9 3 14 0 20-14 35-30 35S-30 66-30 46c0-6 2-12 5-17C-34 21-40 10-40-3c0-22 18-39 40-39Z" />
        {season === "spring" && <g className="tree-blossoms"><circle cx="-22" cy="-5" r="4" /><circle cx="12" cy="-23" r="3" /><circle cx="27" cy="16" r="4" /><circle cx="-8" cy="35" r="3" /></g>}
      </>;
  return <g className="seasonal-tree" transform={`translate(${x} ${y}) scale(${scale})`}>
    <path className="tree-trunk" d="M-5 42h10v52H-5z" />{crown}
  </g>;
}

export function BenchLandscape({ bench }: { bench: BenchDetail }) {
  const sun = skyPosition(bench.sunAzimuthDegrees, bench.sunAltitudeDegrees);
  const moon = skyPosition(bench.moonAzimuthDegrees, bench.moonAltitudeDegrees);
  const sunVisible = bench.sunAltitudeDegrees > 0;
  const moonVisible = bench.moonVisible;
  const moonMaskOffset = (1 - bench.moonIllumination) * 38 * (bench.moonPhase <= .5 ? 1 : -1);
  const hasWater = Boolean(bench.waterfront) || hasView(bench, "see") || hasView(bench, "wasser");
  const hasMountains = hasView(bench, "berg");
  const hasHills = hasView(bench, "hügel");
  const isUrban = bench.landContext === "urban" || (bench.buildingCount100m ?? 0) >= 5;
  const treeCount = bench.canopyContext === "dense" || bench.inForest ? 5 : bench.canopyContext === "partial" ? 3 : 1;
  const backrest = knownProperty(bench, "Rückenlehne") === "Ja";
  const armrests = knownProperty(bench, "Armlehnen") === "Ja";
  const covered = knownProperty(bench, "Überdacht") === "Ja";
  const material = knownProperty(bench, "Material").toLocaleLowerCase("de-CH");
  const seats = Number.parseInt(knownProperty(bench, "Sitzplätze"), 10);
  const benchScale = Number.isFinite(seats) ? seats <= 2 ? .84 : seats >= 6 ? 1.2 : 1 : 1;
  const benchColor = material.includes("stein") || material.includes("beton") ? "#7d8178" : material.includes("metall") ? "#3f5751" : "#a7693f";
  const shadowLength = Math.max(20, Math.min(142, 92 - bench.sunAltitudeDegrees * 1.15));
  const shadowDirection = bench.sunAzimuthDegrees > 180 ? -1 : 1;
  const weather = bench.weather;
  const precipitation = weather?.precipitationType ?? "none";
  const raining = precipitation === "rain" || precipitation === "mixed";
  const snowing = precipitation === "snow" || precipitation === "mixed";
  const windy = (weather?.windKmh ?? 0) >= 15;
  const cloudCover = weather?.cloudCover ?? 0;
  const lowClouds = weather?.cloudLow ?? cloudCover;
  const midClouds = weather?.cloudMid ?? cloudCover * .7;
  const highClouds = weather?.cloudHigh ?? cloudCover * .45;
  const snowCover = Math.max(weather?.snowCoverPercent ?? 0, snowing ? 18 : 0);
  const temperatureMood = weather ? weather.temperatureC <= 5 ? "cold" : weather.temperatureC >= 27 ? "hot" : weather.temperatureC >= 18 ? "warm" : "mild" : "mild";
  const rating = bench.ratingAverage === null ? null : Math.max(1, Math.min(5, Math.round(bench.ratingAverage)));
  const style = {
    "--shadow-x": `${shadowDirection * shadowLength}px`,
    "--bench-color": benchColor,
    "--cloud-opacity": `${Math.max(.34, Math.min(.92, cloudCover))}`,
    "--snow-opacity": `${Math.min(.92, .28 + snowCover / 130)}`,
  } as CSSProperties;
  const aria = [
    bench.dayPhase === "night" ? "Nacht" : bench.sunnyNow ? "Die Bank liegt in der Sonne" : "Die Bank liegt im Schatten",
    raining && snowing ? "Schneeregen" : raining ? "Regen" : snowing ? "Schneefall" : null,
    cloudCover >= .65 ? "stark bewölkt" : cloudCover >= .25 ? "teilweise bewölkt" : null,
    hasWater ? "am Wasser" : null,
    hasMountains ? "mit Bergblick" : hasHills ? "mit Hügelblick" : null,
    bench.inForest ? "zwischen Bäumen" : null,
    backrest ? "mit Rückenlehne" : null,
  ].filter(Boolean).join(", ");

  return (
    <figure className={`bench-landscape phase-${bench.dayPhase} season-${bench.season} temperature-${temperatureMood} precipitation-${precipitation}`} style={style} aria-label={aria}>
      <svg viewBox="0 0 640 480" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`sky-${bench.id}`} x1="0" y1="0" x2="0" y2="1"><stop className="sky-top" offset="0" /><stop className="sky-bottom" offset="1" /></linearGradient>
          <filter id={`soft-${bench.id}`}><feGaussianBlur stdDeviation="4" /></filter>
          <pattern id={`snow-${bench.id}`} width="38" height="38" patternUnits="userSpaceOnUse"><circle cx="7" cy="10" r="2" /><circle cx="28" cy="24" r="1.6" /><circle cx="16" cy="35" r="1.2" /></pattern>
        </defs>
        <rect width="640" height="480" fill={`url(#sky-${bench.id})`} />
        <rect className="scene-temperature-wash" width="640" height="480" />
        {cloudCover > .5 && <rect className="scene-cloud-wash" width="640" height="480" opacity={Math.min(.26, (cloudCover - .35) * .42)} />}
        {bench.dayPhase === "night" && cloudCover < .76 && <g className="scene-stars"><circle cx="92" cy="62" r="2" /><circle cx="174" cy="102" r="1.5" /><circle cx="310" cy="54" r="1.8" /><circle cx="520" cy="112" r="1.4" /><circle cx="586" cy="48" r="2" /></g>}

        {sunVisible && <g className="scene-celestial scene-celestial-sun" transform={`translate(${sun.x} ${sun.y})`}><circle className="celestial-glow" r="38" filter={`url(#soft-${bench.id})`} /><circle className="scene-sun" r="19" /></g>}
        {moonVisible && <g className="scene-celestial scene-celestial-moon" transform={`translate(${moon.x} ${moon.y})`}><circle className="celestial-glow" r="35" filter={`url(#soft-${bench.id})`} /><circle className="scene-moon" r="20" /><circle className="scene-moon-shadow" cx={moonMaskOffset} r="20" /></g>}

        <g className="scene-clouds">
          {highClouds >= .14 && <Cloud x={40} y={20} scale={.55 + highClouds * .3} kind="high" />}
          {midClouds >= .12 && <Cloud x={350} y={64} scale={.62 + midClouds * .28} kind="mid" />}
          {lowClouds >= .12 && <Cloud x={75} y={105} scale={.7 + lowClouds * .3} kind="low" />}
          {cloudCover >= .62 && <Cloud x={245} y={20} scale={.54} kind="high" />}
        </g>

        {windy && <g className="scene-wind"><path d="M32 174c48-22 86 20 126-4 23-13 24-32 6-34-12-1-17 7-14 15M388 188c39-17 70 11 106-8 20-11 20-26 6-28" /></g>}
        {hasMountains && <g className="scene-mountains"><path d="M0 294 93 196l47 46 69-119 85 133 67-96 113 134Z" /><path d="m122 221 18 21 69-119 22 34-22-14-20 34-18-16-34 67Z" className="scene-snow" /></g>}
        {hasHills && !hasMountains && <path className="scene-distant-hills" d="M0 290c72-73 132-69 195-8 80-92 163-82 247 4 68-56 132-59 198-10v95H0Z" />}
        {isUrban && <g className="scene-buildings"><path d="M32 273h72v91H32zM116 301h55v63h-55zM505 281h88v83h-88z" /><path d="m27 273 42-31 40 31m390 8 50-39 51 39" />{snowCover > 12 && <path className="building-snow" d="m27 273 42-31 40 31-8 1-32-22-33 22Zm472 8 50-39 51 39-9 1-42-29-41 29Z" />}</g>}
        <path className="scene-far-hill" d="M0 301c105-41 177-24 260 17 85 42 188-46 380-20v182H0Z" />
        <path className="scene-near-hill" d="M0 357c109-27 187 27 278 22 104-5 198-64 362-28v129H0Z" />
        {snowCover > 5 && <path className="scene-ground-snow" style={{ opacity: Math.min(.92, snowCover / 100 + .25) }} d="M0 349c109-27 187 27 278 22 104-5 198-64 362-28v137H0Z" />}
        {hasWater && <g className="scene-water"><path d="M0 375c111-14 203 18 320 10 109-7 207-35 320-14v109H0Z" /><path d="M32 402c80-8 132 10 211 3m116-1c90-12 151-8 231 2M90 434c75-5 128 7 191 0" /></g>}
        {(bench.distancePathMeters ?? 9999) < 150 && <path className="scene-path" d="M-20 480c132-95 231-81 332-52 92 26 175 4 352-52" />}

        <g className="scene-trees">
          {Array.from({ length: treeCount }, (_, index) => {
            const positions = [[66, 326, .9], [151, 350, .68], [488, 322, .82], [574, 343, .65], [405, 348, .55]] as const;
            const [x, y, scale] = positions[index];
            return <SeasonalTree key={index} x={x} y={y} scale={scale} season={bench.season} evergreen={index === 2 && treeCount >= 3} />;
          })}
        </g>

        {raining && <g className="scene-rain">{Array.from({ length: 18 }, (_, index) => <path key={index} d={`M${55 + index * 31} ${162 + (index % 4) * 15}l-9 20`} />)}<path className="rain-ripple" d="M92 414q13-7 26 0M385 397q14-8 28 0M510 425q12-7 24 0" /></g>}
        {snowing && <rect className="scene-snowfall" width="640" height="430" fill={`url(#snow-${bench.id})`} />}

        <ellipse className={`bench-shadow ${bench.sunnyNow ? "is-sunny" : ""}`} cx="322" cy="419" rx={shadowLength} ry="13" transform={`skewX(${shadowDirection * 18})`} />
        {covered && <g className="bench-cover"><path d="M250 324q72-48 144 0v9H250Z" /><path d="M263 329v91m118-91v91" />{snowCover > 12 && <path className="bench-snow" d="M250 324q72-48 144 0-72-36-144 7Z" />}</g>}
        <g className="drawn-bench" transform={`translate(320 385) scale(${benchScale} 1)`}>
          {backrest && <><path className="bench-board" d="M-78-49q78-8 156 0v17q-78-7-156 0Z" /><path className="bench-frame" d="M-66-38v37m132-37v37" />{snowCover > 15 && <path className="bench-snow" d="M-78-49q78-8 156 0v5q-78-5-156 1Z" />}</>}
          <path className="bench-board" d="M-87-10q87-6 174 0v17q-87 6-174 0Z" />
          {snowCover > 15 && <path className="bench-snow" d="M-87-10q87-6 174 0v5q-87-3-174 1Z" />}
          <path className="bench-frame" d="M-65 5-75 53M65 5l75 48" />
          {armrests && <path className="bench-frame" d="M-84-25h23v27m145-27H61v27" />}
        </g>
        {bench.season === "autumn" && <g className="falling-leaves"><path d="m112 247 8-6 5 9-8 7Z" /><path d="m532 280 9-5 4 10-9 5Z" /><path d="m183 315 7-4 4 8-8 4Z" /></g>}
        {rating !== null && <g className="scene-rating" transform="translate(501 449)">{Array.from({ length: 5 }, (_, index) => <path key={index} className={index < rating ? "is-lit" : undefined} transform={`translate(${index * 24} 0)`} d="M0-8 2-3 8-3 3 1 5 7 0 4-5 7-3 1-8-3-2-3Z" />)}</g>}
      </svg>
      {weather && <span className="sr-only">{Math.round(weather.temperatureC)} Grad Celsius, {precipitation === "snow" ? "Schnee" : precipitation === "rain" ? "Regen" : precipitation === "mixed" ? "Schneeregen" : "trocken"}, MeteoSchweiz</span>}
      {bench.dayPhase === "night" && <span className="sr-only">Mond {Math.round(bench.moonIllumination * 100)} Prozent beleuchtet</span>}
    </figure>
  );
}
