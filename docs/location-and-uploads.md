# Location and photo-upload contracts

## Location

- Searching is not a permission request. An empty, focused map search offers the location suggestion.
- The map control cycles: locate/follow north → follow device direction → follow north. Free map movement releases following; another tap locates again.
- A separate north-reset control appears when the map is rotated. It does not request sensors.
- Direction uses absolute readings or WebKit's compass heading, not relative orientation or stationary GPS course. The translucent sector is an approximate direction, not a measured field of view. GPS accuracy is a separate circle.
- Permissions are requested only from explicit actions. Denied/missing compass readings retain north-up mode; moving the map, opening another task, hiding the page or unmounting releases the controller's subscriptions. No location-history storage is added.
- Route/walk origins and bench placement are one-off requests using `src/lib/geolocation.ts`; they do not enable following. Map bounds remain respected.

## Photo upload

1. The browser decodes and orients the image, removes metadata via canvas, and encodes JPEG ≤1.6 MB, with a longest side of at most 1600px. Undecodable HEIC needs export to JPEG/PNG; there is no bundled HEIC decoder.
2. The authenticated action checks MIME/signature, positive size ≤1.8 MB, caption, contributor permissions and rate limits. The existing 2 MB action limit is unchanged. Valid small files must not be rejected because they compress below 8 KB.
3. The object is stored, then the existing background submission/people-check pipeline decides publication. Missing/incomplete/low-confidence moderation never becomes automatic acceptance.
4. Failed uploads retain the preview/caption. Interrupted polling offers a status retry for the same submission, not a duplicate upload. Refresh failure after acceptance must not claim that saving failed.

Production storage needs `BENCHLY_PHOTO_S3_ENDPOINT`, `BENCHLY_PHOTO_BUCKET`, `BENCHLY_PHOTO_ACCESS_KEY`, and `BENCHLY_PHOTO_SECRET_KEY`. Image moderation needs `INFERENCE_API_KEY` and the configured inference service/model. Local/archive overrides retain their existing semantics; an archive snapshot is read-only.

Safe diagnostic log events: `bench-photo-upload` (save), `bench-photo-storage` (put), `bench-photo-moderation` (transport/response/verdict). Do not add captions, image bytes, credentials, signed URLs or endpoint secrets to logs. The checksum compatibility settings do not remove the explicit Content-MD5 upload integrity check.

## Panorama

The renderer waits for measured layout before sizing its backing buffers and observes subsequent size buckets. Cached images must not freeze rendering at the initial 2px seam overlap. Clouds are a shared periodic pigment field composited over celestial objects and behind terrain; clear sky stays clear and opaque overcast hides stars. Astronomical positions and moon phase calculations are unchanged.

## Checks

```sh
npm run check
npm run test:e2e -- e2e/map/location.spec.ts e2e/map/interactions.spec.ts e2e/community/contributions.spec.ts e2e/bench/panorama.spec.ts
npm run test:e2e
```

Additionally verify compass permission, screen rotation and drag-release on a real HTTPS iPhone/Android device. A desktop sensor fixture does not validate physical heading accuracy. Validate one real people-free photo against the deployed storage and inference services without weakening the people-check gate.
