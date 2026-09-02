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
  {
    id: "0005_exact_environment_and_visual_evidence",
    sql: `
      ALTER TABLE environment_features ADD COLUMN geometry_wkb BLOB;
      ALTER TABLE environment_features ADD COLUMN geometry_crs INTEGER NOT NULL DEFAULT 2056;
      ALTER TABLE environment_features ADD COLUMN source_version TEXT;
      ALTER TABLE environment_features ADD COLUMN source_updated_at TEXT;

      ALTER TABLE bench_enrichments ADD COLUMN land_context TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN waterfront INTEGER;
      ALTER TABLE bench_enrichments ADD COLUMN canopy_context TEXT;
      ALTER TABLE bench_enrichments ADD COLUMN canopy_share_3m REAL;
      ALTER TABLE bench_enrichments ADD COLUMN canopy_share_10m REAL;
      ALTER TABLE bench_enrichments ADD COLUMN canopy_share_25m REAL;
      ALTER TABLE bench_enrichments ADD COLUMN vegetation_median_height REAL;
      ALTER TABLE bench_enrichments ADD COLUMN vegetation_max_height REAL;
      ALTER TABLE bench_enrichments ADD COLUMN environment_computed_at TEXT;

      CREATE TABLE IF NOT EXISTS land_cover_features (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        class TEXT NOT NULL,
        geometry_wkb BLOB NOT NULL,
        geometry_crs INTEGER NOT NULL DEFAULT 2056,
        min_latitude REAL NOT NULL,
        max_latitude REAL NOT NULL,
        min_longitude REAL NOT NULL,
        max_longitude REAL NOT NULL,
        source_version TEXT NOT NULL,
        source_updated_at TEXT,
        imported_at TEXT NOT NULL,
        UNIQUE(source, source_id, class)
      );
      CREATE INDEX IF NOT EXISTS land_cover_class_idx ON land_cover_features(class);
      CREATE VIRTUAL TABLE IF NOT EXISTS land_cover_spatial_index USING rtree(
        row_id, min_longitude, max_longitude, min_latitude, max_latitude
      );
      CREATE TRIGGER IF NOT EXISTS land_cover_spatial_insert AFTER INSERT ON land_cover_features BEGIN
        INSERT OR REPLACE INTO land_cover_spatial_index VALUES(
          new.row_id,new.min_longitude,new.max_longitude,new.min_latitude,new.max_latitude
        );
      END;
      CREATE TRIGGER IF NOT EXISTS land_cover_spatial_update
        AFTER UPDATE OF min_longitude,max_longitude,min_latitude,max_latitude ON land_cover_features BEGIN
        UPDATE land_cover_spatial_index SET min_longitude=new.min_longitude,max_longitude=new.max_longitude,
          min_latitude=new.min_latitude,max_latitude=new.max_latitude WHERE row_id=new.row_id;
      END;
      CREATE TRIGGER IF NOT EXISTS land_cover_spatial_delete AFTER DELETE ON land_cover_features BEGIN
        DELETE FROM land_cover_spatial_index WHERE row_id=old.row_id;
      END;

      CREATE TABLE IF NOT EXISTS official_context_sources (
        source TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        asset_url TEXT NOT NULL,
        asset_checksum TEXT,
        imported_at TEXT NOT NULL,
        stats TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS image_discovery_cells (
        provider TEXT NOT NULL,
        cell_id TEXT NOT NULL,
        min_latitude REAL NOT NULL,
        max_latitude REAL NOT NULL,
        min_longitude REAL NOT NULL,
        max_longitude REAL NOT NULL,
        status TEXT NOT NULL,
        image_count INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        discovered_at TEXT,
        retry_after TEXT,
        PRIMARY KEY(provider, cell_id)
      );

      CREATE TABLE IF NOT EXISTS image_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        provider_image_id TEXT NOT NULL,
        capture_group_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        fetch_url TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        heading REAL,
        captured_at TEXT,
        author TEXT,
        license TEXT,
        image_sha256 TEXT,
        analysis_status TEXT NOT NULL DEFAULT 'pending',
        relevance_probability REAL,
        predictions TEXT,
        model_version TEXT,
        prompt_version TEXT,
        analyzed_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        discovered_at TEXT NOT NULL,
        UNIQUE(provider, provider_image_id)
      );
      CREATE INDEX IF NOT EXISTS image_observations_status_idx
        ON image_observations(analysis_status, discovered_at);
      CREATE INDEX IF NOT EXISTS image_observations_group_idx
        ON image_observations(provider, capture_group_id);

      CREATE TABLE IF NOT EXISTS bench_image_evidence (
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        image_observation_id INTEGER NOT NULL REFERENCES image_observations(id) ON DELETE CASCADE,
        distance_meters REAL NOT NULL,
        direct_view_eligible INTEGER NOT NULL DEFAULT 0,
        evidence_weight REAL NOT NULL DEFAULT 1,
        PRIMARY KEY(bench_row_id, image_observation_id)
      );
      CREATE INDEX IF NOT EXISTS bench_image_evidence_bench_idx
        ON bench_image_evidence(bench_row_id, distance_meters);

      CREATE TABLE IF NOT EXISTS bench_likely_metadata (
        bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,
        land_context TEXT,
        land_context_probability REAL,
        canopy_context TEXT,
        canopy_probability REAL,
        lake_view_probability REAL,
        mountain_view_probability REAL,
        open_view_probability REAL,
        limited_view_probability REAL,
        buildings_probability REAL,
        road_rail_probability REAL,
        confidence TEXT NOT NULL DEFAULT 'low',
        evidence_group_count INTEGER NOT NULL DEFAULT 0,
        evidence_summary TEXT NOT NULL DEFAULT '[]',
        model_version TEXT,
        reconciler_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS likely_land_context_idx
        ON bench_likely_metadata(land_context, confidence);
      CREATE INDEX IF NOT EXISTS likely_lake_view_idx
        ON bench_likely_metadata(lake_view_probability, confidence);
      CREATE INDEX IF NOT EXISTS likely_mountain_view_idx
        ON bench_likely_metadata(mountain_view_probability, confidence);
      CREATE INDEX IF NOT EXISTS likely_open_view_idx
        ON bench_likely_metadata(open_view_probability, confidence);

      CREATE INDEX IF NOT EXISTS enrichments_land_context_idx
        ON bench_enrichments(land_context, waterfront, canopy_context);
    `,
  },
  {
    id: "0006_invalidate_legacy_forest_heuristic",
    sql: `
      UPDATE bench_enrichments
      SET in_forest=NULL,
          land_context='unknown',
          distance_forest_meters=NULL,
          environment_computed_at=NULL
      WHERE environment_computed_at IS NULL;
    `,
  },
  {
    id: "0007_accounts_bench_metadata_and_badges",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id, expires_at);

      ALTER TABLE benches ADD COLUMN name TEXT;
      ALTER TABLE benches ADD COLUMN dedication TEXT;
      ALTER TABLE benches ADD COLUMN location_name TEXT;
      ALTER TABLE benches ADD COLUMN location_key TEXT;
      ALTER TABLE benches ADD COLUMN location_postcode TEXT;
      ALTER TABLE benches ADD COLUMN location_canton TEXT;
      ALTER TABLE benches ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);
      ALTER TABLE benches ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified';
      ALTER TABLE benches ADD COLUMN verified_at TEXT;
      ALTER TABLE benches ADD COLUMN removed_at TEXT;
      CREATE INDEX IF NOT EXISTS benches_location_idx ON benches(location_key);
      CREATE INDEX IF NOT EXISTS benches_verification_idx ON benches(verification_status, active);

      CREATE TABLE IF NOT EXISTS bench_confirmations (
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(bench_row_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS bench_removal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bench_one_pending_removal
        ON bench_removal_requests(bench_row_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS bench_removal_confirmations (
        request_id INTEGER NOT NULL REFERENCES bench_removal_requests(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(request_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS bench_metadata_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        field TEXT NOT NULL CHECK(field IN ('name','dedication','location')),
        old_value TEXT,
        new_value TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_key TEXT NOT NULL,
        awarded_at TEXT NOT NULL,
        PRIMARY KEY(user_id, badge_key)
      );

      ALTER TABLE ratings ADD COLUMN user_id INTEGER REFERENCES users(id);
      ALTER TABLE corrections ADD COLUMN user_id INTEGER REFERENCES users(id);
      ALTER TABLE reports ADD COLUMN user_id INTEGER REFERENCES users(id);
      CREATE UNIQUE INDEX IF NOT EXISTS ratings_one_per_user
        ON ratings(bench_row_id, user_id) WHERE user_id IS NOT NULL;
    `,
  },
  {
    id: "0008_backfill_osm_names_and_dedications",
    sql: `
      UPDATE benches SET
        name=coalesce(name,nullif(json_extract(raw_tags,'$.name'),'')),
        dedication=coalesce(dedication,nullif(json_extract(raw_tags,'$.inscription'),''),nullif(json_extract(raw_tags,'$."memorial:text"'),'')),
        location_name=coalesce(location_name,nullif(json_extract(raw_tags,'$."addr:city"'),''),nullif(json_extract(raw_tags,'$.place'),'')),
        location_postcode=coalesce(location_postcode,nullif(json_extract(raw_tags,'$."addr:postcode"'),'')),
        location_canton=coalesce(location_canton,nullif(json_extract(raw_tags,'$."addr:state"'),''))
      WHERE json_valid(raw_tags);
      UPDATE benches SET location_key=lower(location_name) WHERE location_name IS NOT NULL AND location_key IS NULL;
    `,
  },
  {
    id: "0009_weather_buildings_and_view_v2",
    sql: `
      ALTER TABLE environment_features ADD COLUMN ground_elevation_meters REAL;
      ALTER TABLE environment_features ADD COLUMN eaves_elevation_meters REAL;
      ALTER TABLE environment_features ADD COLUMN roof_elevation_meters REAL;

      CREATE TABLE IF NOT EXISTS weather_snapshots (
        source TEXT NOT NULL,
        parameter TEXT NOT NULL,
        reference_at TEXT NOT NULL,
        valid_at TEXT NOT NULL,
        origin_easting REAL NOT NULL,
        origin_northing REAL NOT NULL,
        resolution_meters REAL NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        values_blob BLOB NOT NULL,
        nodata_value REAL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY(source, parameter)
      );
      CREATE INDEX IF NOT EXISTS weather_snapshots_valid_idx ON weather_snapshots(valid_at);

      UPDATE bench_enrichments
      SET view_labels='["Eingeschränkte Aussicht"]', pipeline_version=NULL
      WHERE coalesce(building_obstruction_percent, 0) + coalesce(vegetation_obstruction_percent, 0) >= 50
        AND coalesce(view_labels, '') LIKE '%Bergblick%';
      UPDATE bench_enrichments SET pipeline_version=NULL
      WHERE pipeline_version IN ('3.0.0', 'geo-admin-horizon-1.0', 'GeoAdmin-Horizont v1');
    `,
  },
  {
    id: "0010_progressive_building_imports",
    sql: `
      CREATE TABLE IF NOT EXISTS building_import_cells (
        cell_key TEXT PRIMARY KEY,
        bounds TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        stats TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS building_source_assets (
        asset_id TEXT PRIMARY KEY,
        source_version TEXT NOT NULL,
        asset_url TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        stats TEXT NOT NULL DEFAULT '{}'
      );
    `,
  },
];
