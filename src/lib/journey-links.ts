import { swissWallTime, type JourneyOption } from "./journey";

/** External links use the calculated option, including when controls have changed. */
export function journeyExternalLinks(option: JourneyOption) {
  const first = option.legs[0], last = option.legs.at(-1);
  if (!first || !last) return { maps: null, sbb: null };
  const maps = new URL("https://www.google.com/maps/dir/");
  maps.search = new URLSearchParams({ api: "1", origin: `${first.from.latitude},${first.from.longitude}`, destination: `${last.to.latitude},${last.to.longitude}`, travelmode: option.legs.some((leg) => leg.mode !== "walk") ? "transit" : "walking" }).toString();
  const transit = option.legs.filter((leg) => leg.mode !== "walk");
  if (!transit.length) return { maps: maps.toString(), sbb: null };
  const departure = transit[0], arrival = transit.at(-1)!;
  const sbb = new URL("https://www.sbb.ch/de");
  if (departure.from.stationId && arrival.to.stationId) {
    sbb.searchParams.set("stops", JSON.stringify([departure.from, arrival.to].map((point) => ({ value: point.stationId, type: "ID", label: point.label }))));
  } else {
    sbb.searchParams.set("von", departure.from.label);
    sbb.searchParams.set("nach", arrival.to.label);
  }
  const wallTime = swissWallTime(departure.departure);
  sbb.searchParams.set("date", JSON.stringify(wallTime.slice(0, 10)));
  sbb.searchParams.set("time", JSON.stringify(wallTime.slice(11, 16)));
  sbb.searchParams.set("moment", JSON.stringify("DEPARTURE"));
  return { maps: maps.toString(), sbb: sbb.toString() };
}

export function finalWalkingLeg(option: JourneyOption) {
  const last = option.legs.at(-1);
  return last?.mode === "walk" ? last : null;
}
