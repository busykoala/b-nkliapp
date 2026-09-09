import io
import json

from benchly.enrichment import terrain_profile as terrain


def response_points(coordinates):
    return [{"easting": round(east, 3), "northing": round(north, 3),
             "alts": {"COMB": 500 + index / 100}}
            for index, (east, north) in enumerate(coordinates)]


def test_alignment_uses_coordinates_with_reordered_extra_and_repeated_points():
    coordinates = [[2600000, 1200000], [2600010.0004, 1200000.0004], [2600000, 1200000]]
    points = response_points(coordinates[:2])
    extra = {"easting": 2600100, "northing": 1200100, "alts": {"COMB": 4000}}
    aligned = terrain.align_profile_points([extra, *reversed(points)], coordinates)
    assert [terrain.profile_height(point) for point in aligned] == [500, 500.01, 500]


def test_alignment_rejects_missing_unique_point_instead_of_shifting_bearings():
    coordinates = [[2600000, 1200000], [2600010, 1200000], [2600025, 1200000]]
    points = response_points(coordinates)
    assert terrain.align_profile_points([points[0], points[2]], coordinates) is None
    assert terrain.align_profile_points([{"alts": {"COMB": 500}}], coordinates) is None
    points[1]["easting"] = float("nan")
    assert terrain.align_profile_points(points, coordinates) is None


def test_unknown_height_is_not_substituted_with_flat_terrain():
    coordinates = terrain.terrain_profile_coordinates(46.68, 7.68, [0])
    points = response_points(coordinates)
    points[10]["alts"] = {"COMB": -9999, "DTM2": "nan", "DTM25": None}
    assert terrain.align_profile_points(points, coordinates) is None
    assert terrain.terrain_horizon_from_profile(points, 1) is None
    points[10]["alts"]["DTM2"] = "620.2"
    assert terrain.terrain_horizon_from_profile(points, 1) is not None
    assert terrain.terrain_horizon_from_profile([*points, points[-1]], 1) is None


def test_client_matches_actual_response_coordinates_before_building_horizon(monkeypatch):
    expected = []

    def respond(request, timeout):
        from urllib.parse import parse_qs
        parameters = parse_qs(request.data.decode())
        coordinates = json.loads(parameters["geom"][0])["coordinates"]
        # Deduplicate repeated origins, as real responses may do, and reverse
        # the order so a positional implementation would assign wrong bearings.
        heights = {}
        for index, coordinate in enumerate(coordinates):
            heights.setdefault(tuple(coordinate), 500 + index / 100)
        points = [{"easting": round(east, 3), "northing": round(north, 3), "alts": {"COMB": height}}
                  for (east, north), height in heights.items()]
        ordered = [{"alts": {"COMB": heights[tuple(coordinate)]}} for coordinate in coordinates]
        expected.append(terrain.terrain_horizon_from_profile(ordered, 36))
        return io.BytesIO(json.dumps(list(reversed(points))).encode())

    monkeypatch.setattr(terrain.urllib.request, "urlopen", respond)
    result = terrain.fetch_terrain_horizon(46.68, 7.68)
    assert result == (expected[0][0], expected[0][1] + expected[1][1], expected[0][2] + expected[1][2])
