/** One-off origin/placement requests never start map-following or persist coordinates. */
export const locationOptions: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
};

export function requestUserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation unavailable")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, locationOptions);
  });
}
