import type { Migration } from "./migrations";

/** Additive tables: the existing benches table remains the canonical identity. */
export const knowledgeMigrations: Migration[] = [
  { id: "0019_official_places", sql: `
    CREATE TABLE official_place_features (
      id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, kind TEXT NOT NULL,
      name TEXT NOT NULL, municipality_id TEXT, canton_id TEXT, district_id TEXT, rank INTEGER NOT NULL DEFAULT 0,
      geometry_wkb BLOB NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
      source_version TEXT NOT NULL, source_updated_at TEXT, imported_at TEXT NOT NULL, UNIQUE(source,source_id)
    );
    CREATE VIRTUAL TABLE official_place_spatial USING rtree(id,min_lon,max_lon,min_lat,max_lat);
    CREATE TRIGGER official_place_insert AFTER INSERT ON official_place_features BEGIN
      INSERT INTO official_place_spatial VALUES(new.id,new.min_lon,new.max_lon,new.min_lat,new.max_lat); END;
    CREATE TRIGGER official_place_update AFTER UPDATE ON official_place_features BEGIN
      UPDATE official_place_spatial SET min_lon=new.min_lon,max_lon=new.max_lon,min_lat=new.min_lat,max_lat=new.max_lat WHERE id=new.id; END;
    CREATE TRIGGER official_place_delete AFTER DELETE ON official_place_features BEGIN DELETE FROM official_place_spatial WHERE id=old.id; END;
    CREATE INDEX official_place_kind ON official_place_features(kind,source_version);
    CREATE TABLE bench_geography (
      bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,
      municipality_id TEXT, municipality_name TEXT, canton_id TEXT, canton_name TEXT, district_id TEXT, district_name TEXT,
      locality_id TEXT, locality_name TEXT, locality_distance_meters REAL, confidence TEXT NOT NULL,
      source_version TEXT NOT NULL, method_version TEXT NOT NULL, computed_at TEXT NOT NULL
    );
    CREATE TABLE bench_knowledge_queue (bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,
      reason TEXT NOT NULL, requested_at TEXT NOT NULL);
    CREATE TRIGGER bench_knowledge_created AFTER INSERT ON benches BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.row_id,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER bench_knowledge_moved AFTER UPDATE OF latitude,longitude ON benches WHEN old.latitude!=new.latitude OR old.longitude!=new.longitude BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.row_id,'moved',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at;
      DELETE FROM bench_geography WHERE bench_row_id=new.row_id; END;
  ` },
  { id: "0020_attribute_evidence", sql: `
    CREATE TABLE bench_attribute_evidence (
      id INTEGER PRIMARY KEY, bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
      attribute TEXT NOT NULL, value_json TEXT NOT NULL, source_type TEXT NOT NULL,
      source_id TEXT NOT NULL, observed_at TEXT, source_updated_at TEXT, imported_at TEXT NOT NULL,
      confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1), method_version TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}', evidence_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX bench_evidence_attribute ON bench_attribute_evidence(bench_row_id,attribute,source_type,observed_at DESC);
    CREATE TABLE bench_attribute_state (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE, attribute TEXT NOT NULL,
      value_json TEXT, confidence TEXT NOT NULL, conflicting INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL, source_types_json TEXT NOT NULL, latest_at TEXT,
      method_version TEXT NOT NULL, resolved_at TEXT NOT NULL, PRIMARY KEY(bench_row_id,attribute)
    );
    CREATE TABLE bench_completeness (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE, category TEXT NOT NULL,
      known_count INTEGER NOT NULL, total_count INTEGER NOT NULL, uncertain_count INTEGER NOT NULL,
      missing_json TEXT NOT NULL, computed_at TEXT NOT NULL, method_version TEXT NOT NULL,
      PRIMARY KEY(bench_row_id,category)
    );
  ` },
  { id: "0021_amenities_approaches", sql: `
    CREATE TABLE bench_amenities (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE, category TEXT NOT NULL,
      nearest_source_id TEXT, distance_meters REAL, count_100m INTEGER, count_250m INTEGER, count_500m INTEGER,
      source TEXT NOT NULL, source_version TEXT, method_version TEXT NOT NULL, computed_at TEXT NOT NULL,
      PRIMARY KEY(bench_row_id,category)
    );
    CREATE TABLE bench_approaches (
      bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE, source_id TEXT,
      distance_meters REAL, length_meters REAL, average_slope_percent REAL, maximum_slope_percent REAL,
      elevation_gain_meters REAL, steps INTEGER, barriers_json TEXT NOT NULL, surface TEXT, smoothness TEXT,
      width_meters REAL, step_free_possible INTEGER, confidence TEXT NOT NULL, evidence_json TEXT NOT NULL,
      method_version TEXT NOT NULL, computed_at TEXT NOT NULL
    );
    CREATE TRIGGER bench_knowledge_clear_moved AFTER UPDATE OF latitude,longitude ON benches WHEN old.latitude!=new.latitude OR old.longitude!=new.longitude BEGIN
      DELETE FROM bench_approaches WHERE bench_row_id=new.row_id;
      DELETE FROM bench_amenities WHERE bench_row_id=new.row_id;
      DELETE FROM bench_attribute_state WHERE bench_row_id=new.row_id;
      DELETE FROM bench_completeness WHERE bench_row_id=new.row_id; END;
  ` },
  { id: "0022_verification_answers", sql: `
    CREATE TABLE bench_verification_answers (
      id INTEGER PRIMARY KEY, bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id), attribute TEXT NOT NULL, value_json TEXT NOT NULL,
      observed_at TEXT NOT NULL, UNIQUE(bench_row_id,user_id,attribute)
    );
    CREATE INDEX verification_answers_bench ON bench_verification_answers(bench_row_id,attribute,observed_at DESC);
  ` },
  { id: "0023_source_records", sql: `
    CREATE TABLE bench_source_records (
      id INTEGER PRIMARY KEY, bench_row_id INTEGER REFERENCES benches(row_id) ON DELETE SET NULL,
      source TEXT NOT NULL, external_id TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
      source_version TEXT, source_updated_at TEXT, imported_at TEXT NOT NULL, raw_attributes_json TEXT NOT NULL,
      match_confidence REAL, match_status TEXT NOT NULL, candidates_json TEXT NOT NULL DEFAULT '[]',
      method_version TEXT NOT NULL, UNIQUE(source,external_id)
    );
    CREATE INDEX source_records_bench ON bench_source_records(bench_row_id,source);
    CREATE INDEX source_records_review ON bench_source_records(match_status,source);
  ` },
  { id: "0024_noise_exposure", sql: `
    CREATE TABLE bench_noise_exposure (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('road','rail')), period TEXT NOT NULL CHECK(period IN ('day','night')),
      value REAL, unit TEXT NOT NULL, source TEXT NOT NULL, dataset_version TEXT NOT NULL,
      method_version TEXT NOT NULL, computed_at TEXT NOT NULL, PRIMARY KEY(bench_row_id,mode,period)
    );
  ` },
  { id: "0025_osm_context_categories", unsafe: true, sql: `
    PRAGMA writable_schema=ON;
    UPDATE sqlite_schema SET sql=replace(sql,
      'CHECK(kind IN (''building'',''tree'',''water'',''forest'',''path'',''major_road'',''fireplace'',''waste_basket''))',
      'CHECK(kind IN (''building'',''tree'',''water'',''forest'',''path'',''major_road'',''fireplace'',''waste_basket'',''toilets'',''drinking_water'',''fountain'',''shelter'',''picnic_table'',''playground'',''barrier''))')
      WHERE type='table' AND name='environment_features';
    PRAGMA writable_schema=RESET;
  ` },
  { id: "0026_knowledge_progress", sql: `
    CREATE TABLE knowledge_progress (job TEXT PRIMARY KEY, after_row_id INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TRIGGER knowledge_metadata_changed AFTER INSERT ON bench_metadata_edits BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.bench_row_id,'metadata',new.created_at) ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_answer_changed AFTER INSERT ON bench_verification_answers BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.bench_row_id,'verification',new.observed_at) ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_answer_updated AFTER UPDATE ON bench_verification_answers BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.bench_row_id,'verification',new.observed_at) ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_noise_moved AFTER UPDATE OF latitude,longitude ON benches WHEN old.latitude!=new.latitude OR old.longitude!=new.longitude BEGIN
      DELETE FROM bench_noise_exposure WHERE bench_row_id=new.row_id;
      DELETE FROM bench_enrichments WHERE bench_row_id=new.row_id;
      DELETE FROM bench_image_evidence WHERE bench_row_id=new.row_id;
      DELETE FROM bench_likely_metadata WHERE bench_row_id=new.row_id; END;
  ` },
  { id: "0027_knowledge_outcomes", sql: `
    ALTER TABLE bench_enrichments ADD COLUMN terrain_coverage TEXT;
    CREATE TABLE bench_terrain_attempts (
      bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,latitude REAL NOT NULL,longitude REAL NOT NULL,
      method_version TEXT NOT NULL,status TEXT NOT NULL,coverage_json TEXT NOT NULL,attempted_at TEXT NOT NULL
    );
    ALTER TABLE bench_geography ADD COLUMN municipality_search TEXT;
    ALTER TABLE bench_geography ADD COLUMN locality_search TEXT;
    CREATE TABLE knowledge_generation (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT INTO knowledge_generation VALUES(1,1);
    CREATE TRIGGER knowledge_source_completed AFTER UPDATE OF status ON pipeline_runs
      WHEN new.status='completed' AND new.kind IN ('import-osm','import-official-context','import-swissbuildings','import-basel-trees','import-zurich-trees','import-bank-photo-evidence','reconcile-source-photos') BEGIN
      UPDATE knowledge_generation SET revision=revision+1 WHERE id=1; END;
    ALTER TABLE bench_attribute_state ADD COLUMN freshness TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE bench_attribute_state ADD COLUMN coverage TEXT NOT NULL DEFAULT 'unknown';
    CREATE TABLE bench_knowledge_revisions (
      bench_row_id INTEGER PRIMARY KEY REFERENCES benches(row_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO bench_knowledge_revisions SELECT row_id,1 FROM benches;
    CREATE TABLE bench_knowledge_outcomes (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE,
      category TEXT NOT NULL, generation TEXT NOT NULL, input_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('current','missing_source','retryable_failure','unresolved')),
      known_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1, error TEXT, processed_at TEXT NOT NULL,
      PRIMARY KEY(bench_row_id,category)
    );
    CREATE INDEX knowledge_outcome_generation ON bench_knowledge_outcomes(generation,status,bench_row_id);
    CREATE INDEX amenity_positive_filter ON bench_amenities(category,distance_meters,bench_row_id);
    CREATE INDEX geography_search_municipality ON bench_geography(municipality_name,bench_row_id);
    CREATE INDEX geography_search_locality ON bench_geography(locality_name,bench_row_id);
    CREATE TRIGGER knowledge_queue_created AFTER INSERT ON bench_knowledge_queue BEGIN
      INSERT INTO bench_knowledge_revisions VALUES(new.bench_row_id,1)
      ON CONFLICT(bench_row_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER knowledge_queue_changed AFTER UPDATE ON bench_knowledge_queue BEGIN
      INSERT INTO bench_knowledge_revisions VALUES(new.bench_row_id,1)
      ON CONFLICT(bench_row_id) DO UPDATE SET revision=revision+1; END;
    CREATE TRIGGER knowledge_bench_source_changed AFTER UPDATE OF raw_tags,osm_version,osm_timestamp,active ON benches
      WHEN old.raw_tags IS NOT new.raw_tags OR old.osm_version IS NOT new.osm_version OR old.osm_timestamp IS NOT new.osm_timestamp OR old.active!=new.active BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.row_id,'source',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_presence_insert AFTER INSERT ON bench_confirmations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'presence',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_presence_update AFTER UPDATE ON bench_confirmations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'presence',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_presence_delete AFTER DELETE ON bench_confirmations BEGIN
      INSERT INTO bench_knowledge_queue SELECT old.bench_row_id,'presence',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=old.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_view_insert AFTER INSERT ON bench_view_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'view',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_view_update AFTER UPDATE ON bench_view_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'view',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_view_delete AFTER DELETE ON bench_view_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT old.bench_row_id,'view',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=old.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_light_insert AFTER INSERT ON bench_light_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'light',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_light_update AFTER UPDATE ON bench_light_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT new.bench_row_id,'light',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=new.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_light_delete AFTER DELETE ON bench_light_observations BEGIN
      INSERT INTO bench_knowledge_queue SELECT old.bench_row_id,'light',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=old.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_metadata_deleted AFTER DELETE ON bench_metadata_edits BEGIN
      INSERT INTO bench_knowledge_queue SELECT old.bench_row_id,'metadata',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=old.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_verification_deleted AFTER DELETE ON bench_verification_answers BEGIN
      INSERT INTO bench_knowledge_queue SELECT old.bench_row_id,'verification',strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS(SELECT 1 FROM benches WHERE row_id=old.bench_row_id)
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_environment_created AFTER INSERT ON bench_enrichments BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.bench_row_id,'environment',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
    CREATE TRIGGER knowledge_environment_updated AFTER UPDATE OF environment_computed_at,elevation_meters,pipeline_version ON bench_enrichments BEGIN
      INSERT INTO bench_knowledge_queue VALUES(new.bench_row_id,'environment',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(bench_row_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at; END;
  ` },
  { id: "0028_physical_photo_estimates", sql: `
    CREATE TABLE bench_photo_estimates (
      bench_row_id INTEGER NOT NULL REFERENCES benches(row_id) ON DELETE CASCADE, attribute TEXT NOT NULL,
      value_json TEXT, status TEXT NOT NULL CHECK(status IN ('eligible','unvalidated','conflicting')),
      image_hashes_json TEXT NOT NULL,model_version TEXT NOT NULL,prompt_version TEXT NOT NULL,
      captured_at TEXT,assessed_at TEXT NOT NULL,validation_samples INTEGER NOT NULL,method_version TEXT NOT NULL,
      latitude REAL NOT NULL,longitude REAL NOT NULL,PRIMARY KEY(bench_row_id,attribute)
    );
    CREATE TABLE photo_physical_reviews (
      image_sha256 TEXT NOT NULL,reviewer TEXT NOT NULL,labels_json TEXT NOT NULL,reviewed_at TEXT NOT NULL,
      PRIMARY KEY(image_sha256,reviewer)
    );
    CREATE TRIGGER knowledge_photo_estimates_moved AFTER UPDATE OF latitude,longitude ON benches
      WHEN old.latitude!=new.latitude OR old.longitude!=new.longitude BEGIN
      DELETE FROM bench_photo_estimates WHERE bench_row_id=new.row_id; END;
  ` },
];
