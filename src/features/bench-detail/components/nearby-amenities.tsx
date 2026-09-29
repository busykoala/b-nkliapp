"use client";

import { Droplets, MapPin, Navigation, Toilet, Waves } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { nearbyAmenities, type NearbyAmenity } from "../overview";

export function NearbyAmenities({ bench, onLocate, hrefPrefix }: {
  bench: BenchDetail;
  onLocate?: (amenity: NearbyAmenity) => void;
  hrefPrefix?: string;
}) {
  const t = useTranslations();
  const amenities = nearbyAmenities(bench);
  if (!amenities.length) return null;
  return <section className="bench-nearby-amenities" aria-label={t("bench.summary.nearbyTitle")}>
    <h3><MapPin size={17} aria-hidden="true" />{t("bench.summary.nearbyTitle")}</h3>
    <ul>{amenities.map(item => <AmenityLocation key={`${item.category}-${item.sourceId}`} amenity={item} bench={bench} onLocate={onLocate} href={hrefPrefix ? `${hrefPrefix}${encodeURIComponent(item.sourceId ?? item.category)}` : undefined} />)}</ul>
  </section>;
}

function AmenityLocation({ amenity, bench, onLocate, href }: { amenity: NearbyAmenity; bench: BenchDetail; onLocate?: (amenity: NearbyAmenity) => void; href?: string }) {
  const t = useTranslations();
  const label = t(amenity.category === "toilets" ? "knowledge.amenities.toilets" : amenity.category === "fountain" ? "knowledge.amenities.fountain" : "knowledge.amenities.drinking_water");
  const Icon = amenity.category === "toilets" ? Toilet : amenity.category === "fountain" ? Waves : Droplets;
  const iconKind = amenity.category === "toilets" ? "toilets" : amenity.category === "fountain" ? "fountain" : "drinking-water";
  const located = Number.isFinite(amenity.latitude) && Number.isFinite(amenity.longitude);
  const direction = located ? bearing(bench.latitude, bench.longitude, amenity.latitude!, amenity.longitude!) : 0;
  const content = <><span className={`amenity-icon is-${iconKind}`} data-amenity-icon={iconKind}><Icon size={18} /></span><span><strong>{label}</strong><small>{t("bench.summary.straightLine", {distance: Math.round(amenity.distanceMeters!)})}</small></span>{located && <span className="amenity-map-cue"><Navigation size={16} style={{transform: `rotate(${direction}deg)`}} />{t("bench.summary.showOnMap")}</span>}</>;
  if (!located) return <li><div className="amenity-location is-static">{content}</div></li>;
  if (onLocate) return <li><button type="button" className="amenity-location" aria-label={t("bench.summary.showFacilityOnMap", {facility: label})} onClick={() => onLocate(amenity)}>{content}</button></li>;
  const locationHref = href ?? `https://www.openstreetmap.org/?mlat=${amenity.latitude}&mlon=${amenity.longitude}#map=19/${amenity.latitude}/${amenity.longitude}`;
  return <li><a className="amenity-location" href={locationHref} target={href ? undefined : "_blank"} rel={href ? undefined : "noreferrer"} aria-label={t("bench.summary.showFacilityOnMap", {facility: label})}>{content}</a></li>;
}

function bearing(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = Math.PI / 180;
  const deltaLongitude = (toLongitude - fromLongitude) * radians;
  const from = fromLatitude * radians;
  const to = toLatitude * radians;
  const y = Math.sin(deltaLongitude) * Math.cos(to);
  const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) / radians + 360) % 360;
}
