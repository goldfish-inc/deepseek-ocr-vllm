-- EBISU normalization transform (core + history pattern)
-- Matches staging data to ebisu.vessels (current state) and tracks changes in ebisu.vessel_reported_history
\set ON_ERROR_STOP on

BEGIN;

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Audit table tracks each batch processing run
CREATE TABLE IF NOT EXISTS ebisu.load_audit (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  inserted_vessels int DEFAULT 0,
  updated_vessels int DEFAULT 0,
  history_records int DEFAULT 0,
  source_records int DEFAULT 0
);

-- Collision log for conflicting hard identifiers detected during load
CREATE TABLE IF NOT EXISTS ebisu.load_collisions (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL,
  id_type text NOT NULL,         -- 'imo' | 'mmsi'
  id_value text NOT NULL,
  vessel_uuid uuid NOT NULL,     -- vessel matched/updated in this batch
  other_vessel_uuid uuid NOT NULL, -- another vessel already holding this id
  detected_at timestamptz NOT NULL DEFAULT now()
);

-- Helper: ensure source exists for provenance FK constraints
-- Auto-creates minimal source record for RFMO if missing
CREATE OR REPLACE FUNCTION ebisu.ensure_source(p_rfmo text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_source_id uuid;
BEGIN
  SELECT source_id INTO v_source_id
  FROM ebisu.original_sources_vessels
  WHERE source_shortname = p_rfmo;

  IF v_source_id IS NULL THEN
    INSERT INTO ebisu.original_sources_vessels (
      source_shortname,
      source_fullname,
      source_types,
      status
    ) VALUES (
      p_rfmo,
      p_rfmo || ' Vessel Registry',
      ARRAY['RFMO']::text[],
      'LOADED'
    ) RETURNING source_id INTO v_source_id;
  END IF;

  RETURN v_source_id;
END$$;

-- Main transform: upsert vessels and track changes
CREATE OR REPLACE FUNCTION ebisu.process_vessel_load(p_batch_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := now();
  v_inserted int := 0;
  v_updated int := 0;
  v_history int := 0;
  v_source_id uuid;
  v_rfmo text;
  rec RECORD;
BEGIN
  -- 1) Ensure batch record exists in stage.load_batches
  INSERT INTO stage.load_batches (batch_id, loaded_at, source)
  VALUES (p_batch_id, v_now, 'Parquet ETL')
  ON CONFLICT (batch_id) DO NOTHING;

  -- 2) Update stage.vessels_load to set batch_id if missing
  UPDATE stage.vessels_load
  SET batch_id = p_batch_id
  WHERE batch_id IS NULL;

  -- 3) Get representative RFMO from batch (assume uniform source per batch; use first non-null)
  SELECT COALESCE(rfmo, 'UNKNOWN') INTO v_rfmo
  FROM stage.vessels_load
  WHERE batch_id = p_batch_id AND COALESCE(rfmo, '') <> ''
  LIMIT 1;

  -- Fallback if no RFMO in batch
  IF v_rfmo IS NULL OR v_rfmo = '' THEN
    v_rfmo := 'UNKNOWN';
  END IF;

  -- Ensure source record exists
  v_source_id := ebisu.ensure_source(v_rfmo);

  -- 4) Process each row: match by IMO (preferred) or MMSI (fallback)
  FOR rec IN
    SELECT
      s.entity_id,
      NULLIF(s.imo, '') AS imo,
      NULLIF(s.mmsi, '') AS mmsi,
      NULLIF(s.ircs, '') AS ircs,
      NULLIF(s.vessel_name, '') AS vessel_name,
      NULLIF(s.vessel_name_other, '') AS vessel_name_other,
      NULLIF(s.national_registry, '') AS national_registry,
      NULLIF(s.eu_cfr, '') AS eu_cfr,
      s.rfmo,
      -- Common flag field aliases from staging (best-effort)
      NULLIF(COALESCE(s.flag, s.flag_of_fishing_vessel, s.country_flag, s.flag_country), '') AS flag_text,
      -- Attempt to match existing vessel by IMO or MMSI
      (SELECT vessel_uuid FROM ebisu.vessels v
       WHERE (s.imo IS NOT NULL AND s.imo <> '' AND v.imo = s.imo)
          OR (s.imo IS NULL AND s.mmsi IS NOT NULL AND s.mmsi <> '' AND v.mmsi = s.mmsi)
       LIMIT 1) AS matched_vessel_uuid
    FROM stage.vessels_load s
    WHERE s.batch_id = p_batch_id
  LOOP
    DECLARE
      v_vessel_uuid uuid;
      v_today date := CURRENT_DATE;
      v_other uuid;
    BEGIN
      IF rec.matched_vessel_uuid IS NULL THEN
        -- INSERT new vessel (no match found)
        v_vessel_uuid := gen_random_uuid();

        INSERT INTO ebisu.vessels (
          vessel_uuid,
          vessel_name,
          imo,
          mmsi,
          ircs,
          created_at,
          updated_at
        ) VALUES (
          v_vessel_uuid,
          rec.vessel_name,
          rec.imo,
          rec.mmsi,
          rec.ircs,
          v_now,
          v_now
        );
        v_inserted := v_inserted + 1;
      ELSE
        -- UPDATE existing vessel (track changes in history)
        v_vessel_uuid := rec.matched_vessel_uuid;
      -- Check for name change
      IF EXISTS (
        SELECT 1 FROM ebisu.vessels v
        WHERE v.vessel_uuid = rec.matched_vessel_uuid
          AND COALESCE(v.vessel_name, '') <> COALESCE(rec.vessel_name, '')
      ) THEN
        INSERT INTO ebisu.vessel_reported_history (
          history_uuid,
          vessel_uuid,
          source_id,
          reported_history_type,
          identifier_value,
          created_at
        ) VALUES (
          gen_random_uuid(),
          rec.matched_vessel_uuid,
          v_source_id,
          'VESSEL_NAME_CHANGE',
          rec.vessel_name,
          v_now
        );
        v_history := v_history + 1;
      END IF;

      -- Check for IMO change
      IF EXISTS (
        SELECT 1 FROM ebisu.vessels v
        WHERE v.vessel_uuid = rec.matched_vessel_uuid
          AND COALESCE(v.imo, '') <> COALESCE(rec.imo, '')
      ) THEN
        INSERT INTO ebisu.vessel_reported_history (
          history_uuid,
          vessel_uuid,
          source_id,
          reported_history_type,
          identifier_value,
          created_at
        ) VALUES (
          gen_random_uuid(),
          rec.matched_vessel_uuid,
          v_source_id,
          'IMO_CHANGE',
          rec.imo,
          v_now
        );
        v_history := v_history + 1;
      END IF;

      -- Check for MMSI change
      IF EXISTS (
        SELECT 1 FROM ebisu.vessels v
        WHERE v.vessel_uuid = rec.matched_vessel_uuid
          AND COALESCE(v.mmsi, '') <> COALESCE(rec.mmsi, '')
      ) THEN
        INSERT INTO ebisu.vessel_reported_history (
          history_uuid,
          vessel_uuid,
          source_id,
          reported_history_type,
          identifier_value,
          created_at
        ) VALUES (
          gen_random_uuid(),
          rec.matched_vessel_uuid,
          v_source_id,
          'MMSI_CHANGE',
          rec.mmsi,
          v_now
        );
        v_history := v_history + 1;
      END IF;

      -- Check for IRCS change
      IF EXISTS (
        SELECT 1 FROM ebisu.vessels v
        WHERE v.vessel_uuid = rec.matched_vessel_uuid
          AND COALESCE(v.ircs, '') <> COALESCE(rec.ircs, '')
      ) THEN
        INSERT INTO ebisu.vessel_reported_history (
          history_uuid,
          vessel_uuid,
          source_id,
          reported_history_type,
          identifier_value,
          created_at
        ) VALUES (
          gen_random_uuid(),
          rec.matched_vessel_uuid,
          v_source_id,
          'IRCS_CHANGE',
          rec.ircs,
          v_now
        );
        v_history := v_history + 1;
      END IF;

      -- Check for FLAG change (map textual flag to country_iso.id)
      IF rec.flag_text IS NOT NULL THEN
        PERFORM 1;
        -- Resolve country_id by alpha2/alpha3/numeric/name (case-insensitive)
        SELECT c.id INTO v_other FROM reference.country_iso c
        WHERE upper(c.alpha_2_code) = upper(rec.flag_text)
           OR upper(c.alpha_3_code) = upper(rec.flag_text)
           OR c.numeric_code = rec.flag_text
           OR lower(c.short_name_en) = lower(rec.flag_text)
        LIMIT 1;

        IF v_other IS NOT NULL THEN
          -- History if changed
          IF EXISTS (
            SELECT 1 FROM ebisu.vessels v
            WHERE v.vessel_uuid = rec.matched_vessel_uuid
              AND COALESCE(v.vessel_flag, '00000000-0000-0000-0000-000000000000'::uuid) <> v_other
          ) THEN
            INSERT INTO ebisu.vessel_reported_history (
              history_uuid,
              vessel_uuid,
              source_id,
              reported_history_type,
              flag_country_id,
              created_at
            ) VALUES (
              gen_random_uuid(),
              rec.matched_vessel_uuid,
              v_source_id,
              'FLAG_CHANGE',
              v_other,
              v_now
            );
            v_history := v_history + 1;
          END IF;

          -- Update current vessel flag
          UPDATE ebisu.vessels SET vessel_flag = v_other, updated_at = v_now
          WHERE vessel_uuid = rec.matched_vessel_uuid;
        END IF;
      END IF;

        -- Update current vessel state
        UPDATE ebisu.vessels
        SET
          vessel_name = COALESCE(rec.vessel_name, vessel_name),
          imo = COALESCE(rec.imo, imo),
          mmsi = COALESCE(rec.mmsi, mmsi),
          ircs = COALESCE(rec.ircs, ircs),
          updated_at = v_now
        WHERE vessel_uuid = rec.matched_vessel_uuid;

        v_updated := v_updated + 1;
      END IF;

      -- 5) Provenance tracking: upsert vessel_sources (vessel-source relationship)
      INSERT INTO ebisu.vessel_sources (
        vessel_uuid,
        source_id,
        first_seen_date,
        last_seen_date,
        is_active
      ) VALUES (
        v_vessel_uuid,
        v_source_id,
        v_today,
        v_today,
        true
      )
      ON CONFLICT (vessel_uuid, source_id) DO UPDATE
      SET
        last_seen_date = v_today,
        is_active = true;

      -- 6) Provenance tracking: insert vessel_source_identifiers (all identifiers from this source)
      -- Insert vessel_name
      IF rec.vessel_name IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'vessel_name',
          rec.vessel_name
        )
        ON CONFLICT DO NOTHING;  -- Avoid duplicate identifier entries
      END IF;

      -- Insert vessel_name_other
      IF rec.vessel_name_other IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'vessel_name_other',
          rec.vessel_name_other
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Insert IMO
      IF rec.imo IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'imo',
          rec.imo
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Insert MMSI
      IF rec.mmsi IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'mmsi',
          rec.mmsi
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Insert IRCS
      IF rec.ircs IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'ircs',
          rec.ircs
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Insert national_registry
      IF rec.national_registry IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'national_registry',
          rec.national_registry
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- Insert EU CFR
      IF rec.eu_cfr IS NOT NULL THEN
        INSERT INTO ebisu.vessel_source_identifiers (
          identifier_uuid,
          vessel_uuid,
          source_id,
          identifier_type,
          identifier_value
        ) VALUES (
          gen_random_uuid(),
          v_vessel_uuid,
          v_source_id,
          'eu_cfr',
          rec.eu_cfr
        )
        ON CONFLICT DO NOTHING;
      END IF;

      -- 7) Collision detection for IMO/MMSI
      -- IMO collision: another vessel already holds this IMO (should be prevented by unique index)
      IF rec.imo IS NOT NULL THEN
        SELECT v2.vessel_uuid INTO v_other
        FROM ebisu.vessels v2
        WHERE v2.imo = rec.imo AND v2.vessel_uuid <> v_vessel_uuid
        LIMIT 1;
        IF v_other IS NOT NULL THEN
          INSERT INTO ebisu.load_collisions (batch_id, id_type, id_value, vessel_uuid, other_vessel_uuid)
          VALUES (p_batch_id, 'imo', rec.imo, v_vessel_uuid, v_other)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      -- MMSI collision: another vessel already holds this MMSI
      IF rec.mmsi IS NOT NULL THEN
        SELECT v2.vessel_uuid INTO v_other
        FROM ebisu.vessels v2
        WHERE v2.mmsi = rec.mmsi AND v2.vessel_uuid <> v_vessel_uuid
        LIMIT 1;
        IF v_other IS NOT NULL THEN
          INSERT INTO ebisu.load_collisions (batch_id, id_type, id_value, vessel_uuid, other_vessel_uuid)
          VALUES (p_batch_id, 'mmsi', rec.mmsi, v_vessel_uuid, v_other)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END;
  END LOOP;

  -- 5) Record audit
  INSERT INTO ebisu.load_audit (
    batch_id,
    inserted_vessels,
    updated_vessels,
    history_records,
    source_records
  ) VALUES (
    p_batch_id,
    v_inserted,
    v_updated,
    v_history,
    (SELECT COUNT(*) FROM ebisu.original_sources_vessels WHERE source_id = v_source_id)
  );

  RAISE NOTICE 'Batch % complete: % inserted, % updated, % history records',
    p_batch_id, v_inserted, v_updated, v_history;
END$$;

COMMIT;
