export const migrations = [
  {
    id: "0001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS benches (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        osm_type TEXT NOT NULL,
        osm_id INTEGER NOT NULL,
        latitude REAL NOT NULL CHECK(latitude BETWEEN 45.7 AND 47.9),
        longitude REAL NOT NULL CHECK(longitude BETWEEN 5.7 AND 10.7),
        backrest INTEGER,
        armrest INTEGER,
        covered INTEGER,
        wheelchair INTEGER,
        seats INTEGER,
        material TEXT,
        direction_degrees REAL,
        operator TEXT,
        description TEXT,
        raw_tags TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        source_updated_at TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        UNIQUE(osm_type, osm_id)
      );
      CREATE INDEX IF NOT EXISTS benches_material_idx ON benches(material);
      CREATE VIRTUAL TABLE IF NOT EXISTS bench_spatial_index USING rtree(
        row_id, min_longitude, max_longitude, min_latitude, max_latitude
      );
      CREATE TRIGGER IF NOT EXISTS benches_spatial_insert AFTER INSERT ON benches BEGIN
        INSERT OR REPLACE INTO bench_spatial_index VALUES (new.row_id, new.longitude, new.longitude, new.latitude, new.latitude);
      END;
      CREATE TRIGGER IF NOT EXISTS benches_spatial_update AFTER UPDATE OF latitude, longitude ON benches BEGIN
        UPDATE bench_spatial_index SET min_longitude=new.longitude, max_longitude=new.longitude,
          min_latitude=new.latitude, max_latitude=new.latitude WHERE row_id=new.row_id;
      END;
      CREATE TRIGGER IF NOT EXISTS benches_spatial_delete AFTER DELETE ON benches BEGIN
        DELETE FROM bench_spatial_index WHERE row_id=old.row_id;
      END;

      CREATE TABLE IF NOT EXISTS bench_enrichments (
        bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,
        elevation_meters REAL,
        in_forest INTEGER,
        canopy_percent REAL,
        distance_forest_meters REAL,
        distance_water_meters REAL,
        distance_path_meters REAL,
        distance_major_road_meters REAL,
        horizon_profile TEXT,
        sun_minutes_summer INTEGER,
        sun_minutes_winter INTEGER,
        sun_confidence TEXT NOT NULL DEFAULT 'niedrig',
        view_score REAL,
        view_confidence TEXT NOT NULL DEFAULT 'niedrig',
        view_components TEXT,
        pipeline_version TEXT,
        computed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS enrichments_view_idx ON bench_enrichments(view_score);

      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        relation TEXT NOT NULL CHECK(relation IN ('exact','nearby')),
        provider TEXT NOT NULL,
        external_id TEXT,
        source_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        author TEXT,
        license TEXT,
        latitude REAL,
        longitude REAL,
        distance_meters REAL,
        title TEXT,
        fetched_at TEXT NOT NULL,
        UNIQUE(provider, external_id, bench_row_id)
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        contributor_hash TEXT NOT NULL,
        overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),
        view_score INTEGER NOT NULL CHECK(view_score BETWEEN 1 AND 5),
        comfort INTEGER NOT NULL CHECK(comfort BETWEEN 1 AND 5),
        quiet INTEGER NOT NULL CHECK(quiet BETWEEN 1 AND 5),
        note TEXT,
        visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bench_row_id, contributor_hash)
      );
      CREATE INDEX IF NOT EXISTS ratings_bench_visible_idx ON ratings(bench_row_id, visible);

      CREATE TABLE IF NOT EXISTS corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        contributor_hash TEXT NOT NULL,
        field TEXT NOT NULL,
        proposed_value TEXT NOT NULL,
        note TEXT,
        visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS corrections_bench_visible_idx ON corrections(bench_row_id, visible);

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('rating','correction')),
        target_id INTEGER NOT NULL,
        contributor_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(target_type, target_id, contributor_hash)
      );
      CREATE TABLE IF NOT EXISTS blocked_contributors (
        contributor_hash TEXT PRIMARY KEY,
        reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(key_hash, action, window_start)
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS moderation_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        source_version TEXT,
        pipeline_version TEXT,
        stats TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
    `,
  },
  {
    id: "0002_seasonal_sun",
    sql: `
      ALTER TABLE bench_enrichments ADD COLUMN sun_minutes_spring INTEGER;
      ALTER TABLE bench_enrichments ADD COLUMN sun_minutes_autumn INTEGER;
      UPDATE bench_enrichments
        SET sun_minutes_spring = CAST((coalesce(sun_minutes_summer, 0) + coalesce(sun_minutes_winter, 0)) / 2 AS INTEGER),
            sun_minutes_autumn = CAST((coalesce(sun_minutes_summer, 0) + coalesce(sun_minutes_winter, 0)) / 2 AS INTEGER)
        WHERE sun_minutes_spring IS NULL;
    `,
  },
  {
    id: "0003_local_obstructions_and_view_context",
    sql: `
      ALTER TABLE bench_enrichments ADD COLUMN terrain_horizon_profile TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN obstruction_types TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN obstruction_distances TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN building_obstruction_percent REAL;
      ALTER TABLE bench_enrichments ADD COLUMN vegetation_obstruction_percent REAL;
      ALTER TABLE bench_enrichments ADD COLUMN distance_building_meters REAL;
      ALTER TABLE bench_enrichments ADD COLUMN building_count_100m INTEGER;
      ALTER TABLE bench_enrichments ADD COLUMN view_labels TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN view_sectors TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN context_source_version TEXT;

      CREATE TABLE IF NOT EXISTS environment_features (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('building','tree','water','forest','path','major_road')),
        subtype TEXT,
        center_latitude REAL NOT NULL,
        center_longitude REAL NOT NULL,
        min_latitude REAL NOT NULL,
        max_latitude REAL NOT NULL,
        min_longitude REAL NOT NULL,
        max_longitude REAL NOT NULL,
        height_meters REAL,
        raw_tags TEXT NOT NULL DEFAULT '{}',
        imported_at TEXT NOT NULL,
        UNIQUE(source, source_id, kind)
      );
      CREATE INDEX IF NOT EXISTS environment_kind_idx ON environment_features(kind);
      CREATE INDEX IF NOT EXISTS environment_imported_idx ON environment_features(source, imported_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS environment_spatial_index USING rtree(
        row_id, min_longitude, max_longitude, min_latitude, max_latitude
      );
      CREATE TRIGGER IF NOT EXISTS environment_spatial_insert AFTER INSERT ON environment_features BEGIN
        INSERT OR REPLACE INTO environment_spatial_index VALUES (
          new.row_id, new.min_longitude, new.max_longitude, new.min_latitude, new.max_latitude
        );
      END;
      CREATE TRIGGER IF NOT EXISTS environment_spatial_update
        AFTER UPDATE OF min_longitude, max_longitude, min_latitude, max_latitude ON environment_features BEGIN
        UPDATE environment_spatial_index SET
          min_longitude=new.min_longitude, max_longitude=new.max_longitude,
          min_latitude=new.min_latitude, max_latitude=new.max_latitude
        WHERE row_id=new.row_id;
      END;
      CREATE TRIGGER IF NOT EXISTS environment_spatial_delete AFTER DELETE ON environment_features BEGIN
        DELETE FROM environment_spatial_index WHERE row_id=old.row_id;
      END;

      UPDATE bench_enrichments SET
        view_labels = CASE
          WHEN distance_water_meters < 120 THEN '["Seeblick","Weitsicht"]'
          WHEN view_score >= 85 THEN '["Bergblick","Weitsicht"]'
          WHEN view_score < 55 THEN '["Eingeschränkte Aussicht"]'
          ELSE '["Keine besondere Aussicht"]'
        END,
        building_obstruction_percent = 8.3,
        vegetation_obstruction_percent = coalesce(canopy_percent, 0) / 3,
        distance_building_meters = 42,
        building_count_100m = 5
      WHERE pipeline_version LIKE 'demo-%' AND view_labels IS NULL;
    `,
  },
  {
    id: "0004_elevation_provenance",
    sql: `
      ALTER TABLE bench_enrichments ADD COLUMN elevation_source TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN elevation_updated_at TEXT;
      UPDATE bench_enrichments
        SET elevation_source = CASE
              WHEN pipeline_version LIKE 'demo-%' THEN 'Demo'
              ELSE 'swissALTI3D-Raster'
            END,
            elevation_updated_at = computed_at
        WHERE elevation_meters IS NOT NULL AND elevation_source IS NULL;
      CREATE INDEX IF NOT EXISTS enrichments_missing_elevation_idx
        ON bench_enrichments(elevation_meters) WHERE elevation_meters IS NULL;
    `,
  },
];
