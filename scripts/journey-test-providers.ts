/** Playwright server preload only. Not imported by the application or production entrypoint. */
if (process.env.BENCHLY_JOURNEY_TEST_FIXTURES === "true") {
  const originalFetch = globalThis.fetch;
  const station = (id: string, name: string, x: number, y: number) => ({ id, name, coordinate: { x, y } });
  const bern = station("8507000", "Bern", 46.949, 7.439);
  const hb = station("8503000", "Zürich HB", 47.3785, 8.537);
  const tram = station("8503001", "Zürich, Bahnhofplatz", 47.3778, 8.5381);
  const end = station("8503002", "Zürich, Lindenhof", 47.3769, 8.5411);

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "transport.opendata.ch") {
      if (url.pathname.endsWith("locations")) {
        if (url.searchParams.has("query")) return Response.json({ stations: [bern] });
        return Response.json({ stations: [end] });
      }
      if (url.pathname.endsWith("connections")) {
        const now = Date.now();
        const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
        return Response.json({ connections: [{ sections: [
          { departure: { station: bern, departure: at(10), platform: "2" }, arrival: { station: hb, arrival: at(40), platform: "31", prognosis: { platform: "32" } }, journey: { category: "IC", number: "8", to: "Zürich HB", passList: [] } },
          { departure: { station: hb, departure: at(40) }, arrival: { station: tram, arrival: at(42) }, walk: { duration: 0 } },
          { departure: { station: tram, departure: at(50), platform: "A" }, arrival: { station: end, arrival: at(54) }, journey: { category: "BUS", number: "31", to: "Lindenhof" } },
        ] }] });
      }
      return Response.json({ connections: [] });
    }
    if (url.hostname === "127.0.0.1" && url.port === "8989") {
      const body = JSON.parse(String(init?.body)) as { points: number[][]; algorithm?: string; custom_model?: object; "round_trip.seed"?: number };
      const roundTrip = body.algorithm === "round_trip";
      const seed = Number(body["round_trip.seed"] ?? 0);
      const direction = seed % 3;
      const origin = body.points[0];
      const bench = [8.54183, 47.37674];
      const loopCorners = direction === 0
        ? [[origin[0] + .004, origin[1] + .003], bench, [origin[0] - .003, origin[1] - .003]]
        : direction === 1
          ? [[origin[0] - .004, origin[1] + .002], bench, [origin[0] + .004, origin[1] - .004]]
          : [[origin[0] + .001, origin[1] - .005], bench, [origin[0] - .005, origin[1] + .001]];
      const coordinates = roundTrip
        ? [origin, ...loopCorners, origin]
        : body.points;
      const longWalk = roundTrip || Boolean(body.custom_model && body.points.length > 2);
      return Response.json({ paths: [{ distance: longWalk ? 3_350 : 140, time: longWalk ? 2_520_000 : 100_800, ascend: longWalk ? 35 : 0, instructions: [{sign: 0, street_name: "Lindenhofweg", text: "Continue onto Lindenhofweg", distance: longWalk ? 3350 : 140, interval: [0, coordinates.length - 1]}, {sign: 4, text: "Arrive at destination", distance: 0, interval: [coordinates.length - 1, coordinates.length - 1]}], points: { coordinates }, snapped_waypoints: { coordinates: roundTrip ? [origin, origin] : body.points } }] });
    }
    if (url.hostname === "api3.geo.admin.ch" && url.searchParams.get("origins") === "address") {
      return Response.json({ results: [{ id: "journey-test-address", attrs: { origin: "address", label: "Bahnhofplatz 1, Zürich", lat: 47.378, lon: 8.538 } }] });
    }
    return originalFetch(input, init);
  };
}
