/** Playwright server preload only. Not imported by the application or production entrypoint. */
if (process.env.BENCHLY_JOURNEY_TEST_FIXTURES === "true") {
  const originalFetch = globalThis.fetch;
  const station = (id, name, x, y) => ({ id, name, coordinate: { x, y } });
  const bern = station("8507000", "Bern", 46.949, 7.439);
  const hb = station("8503000", "Zürich HB", 47.3785, 8.537);
  const tram = station("8503001", "Zürich, Bahnhofplatz", 47.3778, 8.5381);
  const end = station("8503002", "Zürich, Lindenhof", 47.3769, 8.5411);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "transport.opendata.ch") {
      if (url.pathname.endsWith("locations")) {
        if (url.searchParams.has("query")) return Response.json({ stations: [bern] });
        return Response.json({ stations: [end] });
      }
      if (url.pathname.endsWith("connections")) {
        const now = Date.now(); const at = (minutes) => new Date(now + minutes * 60000).toISOString();
        return Response.json({ connections: [{ sections: [
          { departure: { station: bern, departure: at(10), platform: "2" }, arrival: { station: hb, arrival: at(40), platform: "31", prognosis: { platform: "32" } }, journey: { category: "IC", number: "8", to: "Zürich HB", passList: [] } },
          { departure: { station: hb, departure: at(40) }, arrival: { station: tram, arrival: at(42) }, walk: { duration: 0 } },
          { departure: { station: tram, departure: at(50), platform: "A" }, arrival: { station: end, arrival: at(54) }, journey: { category: "BUS", number: "31", to: "Lindenhof" } },
        ] }] });
      }
      return Response.json({ connections: [] });
    }
    if (url.hostname === "127.0.0.1" && url.port === "8989") {
      const { points, algorithm } = JSON.parse(init.body);
      const coordinates = algorithm === "round_trip" ? [points[0], [points[0][0]+.005,points[0][1]], [points[0][0]+.005,points[0][1]+.005], [points[0][0],points[0][1]+.005], points[0]] : points;
      return Response.json({ paths: [{ distance: 140, time: 100800, ascend: 0, points: { coordinates }, snapped_waypoints: { coordinates: points } }] });
    }
    if (url.hostname === "api3.geo.admin.ch" && url.searchParams.get("origins") === "address") {
      return Response.json({ results: [{ id: "journey-test-address", attrs: { origin: "address", label: "Bahnhofplatz 1, Zürich", lat: 47.378, lon: 8.538 } }] });
    }
    return originalFetch(input, init);
  };
}
