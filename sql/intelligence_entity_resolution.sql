-- Intelligence-Aware Entity Resolution
-- Builds vessel dossiers with source provenance and conflict detection
-- This is the CORRECT approach for vessel intelligence

\set ON_ERROR_STOP on

BEGIN;

-- Function to build intelligence dossiers
CREATE OR REPLACE FUNCTION curated.build_vessel_intelligence()
RETURNS TABLE(
  vessels_created bigint,
  identifiers_tracked bigint,
  conflicts_detected bigint
)
LANGUAGE plpgsql AS $$
DECLARE
  v_vessels bigint := 0;
  v_identifiers bigint := 0;
  v_conflicts bigint := 0;
  rec RECORD;
  v_vessel_id bigint;
  v_imo_vessel_id bigint;
  v_existing_mmsi text;
  v_existing_flag text;
BEGIN
  RAISE NOTICE 'Building vessel intelligence dossiers with source provenance...';

  -- Step 1: Create canonical vessels (one per IMO)
  FOR rec IN
    SELECT DISTINCT ON (imo)
      imo,
      vessel_name,
      vessel_flag,
      rfmo
    FROM public.vessels
    WHERE imo IS NOT NULL AND imo <> ''
    ORDER BY imo, vessel_name NULLS LAST
  LOOP
    INSERT INTO curated.vessels (imo, vessel_name, flag_code, status)
    VALUES (rec.imo, NULLIF(rec.vessel_name, ''), NULLIF(rec.vessel_flag, ''), 'active')
    ON CONFLICT (imo) DO NOTHING
    RETURNING vessel_id INTO v_vessel_id;

    IF v_vessel_id IS NOT NULL THEN
      v_vessels := v_vessels + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created % canonical vessels', v_vessels;

  -- Step 2: Track ALL identifiers with source provenance
  FOR rec IN
    SELECT
      v.vessel_id,
      pv.imo,
      pv.mmsi,
      pv.ircs,
      pv.vessel_name,
      pv.vessel_flag,
      pv.rfmo,
      pv.entity_id  -- Original source entity ID
    FROM public.vessels pv
    JOIN curated.vessels v ON v.imo = pv.imo
    WHERE pv.imo IS NOT NULL AND pv.imo <> ''
  LOOP
    -- Track IMO (already in vessels table, but log provenance)
    IF rec.imo IS NOT NULL AND rec.imo <> '' THEN
      INSERT INTO curated.vessel_identifiers (
        vessel_id,
        identifier_type,
        identifier_value,
        confidence,
        metadata
      ) VALUES (
        rec.vessel_id,
        'IMO',
        rec.imo,
        1.0,  -- IMO is primary identifier
        jsonb_build_object(
          'source_rfmo', rec.rfmo,
          'source_entity_id', rec.entity_id
        )
      )
      ON CONFLICT (identifier_type, identifier_value) DO UPDATE
      SET metadata = curated.vessel_identifiers.metadata || EXCLUDED.metadata;

      v_identifiers := v_identifiers + 1;
    END IF;

    -- Track MMSI with collision detection
    IF rec.mmsi IS NOT NULL AND rec.mmsi <> '' AND rec.mmsi <> 'NONE' THEN
      -- Check if this MMSI exists for a DIFFERENT vessel
      SELECT mmsi INTO v_existing_mmsi
      FROM curated.vessels
      WHERE mmsi = rec.mmsi AND vessel_id <> rec.vessel_id
      LIMIT 1;

      IF v_existing_mmsi IS NOT NULL THEN
        -- COLLISION DETECTED! Flag as conflict
        INSERT INTO curated.entity_conflicts (
          entity_type,
          entity_id,
          field_name,
          conflict_type,
          value_a,
          value_b,
          resolution_notes
        ) VALUES (
          'VESSEL',
          rec.vessel_id,
          'mmsi',
          'MMSI_COLLISION',
          rec.mmsi,
          rec.mmsi,
          'Same MMSI reported for multiple IMOs - potential identity fraud or data error. Source: ' || rec.rfmo
        );
        v_conflicts := v_conflicts + 1;

        -- Still track it, but with low confidence
        INSERT INTO curated.vessel_identifiers (
          vessel_id,
          identifier_type,
          identifier_value,
          confidence,
          metadata
        ) VALUES (
          rec.vessel_id,
          'MMSI',
          rec.mmsi,
          0.3,  -- Low confidence due to collision
          jsonb_build_object(
            'source_rfmo', rec.rfmo,
            'collision_detected', true,
            'source_entity_id', rec.entity_id
          )
        )
        ON CONFLICT (identifier_type, identifier_value) DO UPDATE
        SET confidence = LEAST(curated.vessel_identifiers.confidence, 0.3);
      ELSE
        -- No collision, high confidence
        INSERT INTO curated.vessel_identifiers (
          vessel_id,
          identifier_type,
          identifier_value,
          confidence,
          metadata
        ) VALUES (
          rec.vessel_id,
          'MMSI',
          rec.mmsi,
          0.9,
          jsonb_build_object(
            'source_rfmo', rec.rfmo,
            'source_entity_id', rec.entity_id
          )
        )
        ON CONFLICT (identifier_type, identifier_value) DO UPDATE
        SET metadata = curated.vessel_identifiers.metadata || EXCLUDED.metadata;

        -- Update vessel table with high-confidence MMSI
        UPDATE curated.vessels
        SET mmsi = rec.mmsi
        WHERE vessel_id = rec.vessel_id AND mmsi IS NULL;
      END IF;

      v_identifiers := v_identifiers + 1;
    END IF;

    -- Track IRCS
    IF rec.ircs IS NOT NULL AND rec.ircs <> '' AND rec.ircs <> 'NONE' THEN
      INSERT INTO curated.vessel_identifiers (
        vessel_id,
        identifier_type,
        identifier_value,
        confidence,
        metadata
      ) VALUES (
        rec.vessel_id,
        'IRCS',
        rec.ircs,
        0.8,
        jsonb_build_object(
          'source_rfmo', rec.rfmo,
          'source_entity_id', rec.entity_id
        )
      )
      ON CONFLICT (identifier_type, identifier_value) DO UPDATE
      SET metadata = curated.vessel_identifiers.metadata || EXCLUDED.metadata;

      v_identifiers := v_identifiers + 1;
    END IF;

    -- Track vessel names (can have multiple over time)
    IF rec.vessel_name IS NOT NULL AND rec.vessel_name <> '' THEN
      INSERT INTO curated.vessel_identifiers (
        vessel_id,
        identifier_type,
        identifier_value,
        confidence,
        metadata
      ) VALUES (
        rec.vessel_id,
        'NAME',
        rec.vessel_name,
        0.7,
        jsonb_build_object(
          'source_rfmo', rec.rfmo,
          'source_entity_id', rec.entity_id
        )
      )
      ON CONFLICT (identifier_type, identifier_value) DO NOTHING;  -- Names can be reused

      v_identifiers := v_identifiers + 1;
    END IF;

    -- Detect flag changes (intelligence signal!)
    IF rec.vessel_flag IS NOT NULL AND rec.vessel_flag <> '' THEN
      SELECT flag_code INTO v_existing_flag
      FROM curated.vessels
      WHERE vessel_id = rec.vessel_id;

      IF v_existing_flag IS NOT NULL AND v_existing_flag <> rec.vessel_flag THEN
        -- FLAG CHANGE DETECTED
        INSERT INTO curated.entity_conflicts (
          entity_type,
          entity_id,
          field_name,
          conflict_type,
          value_a,
          value_b,
          resolution_notes
        ) VALUES (
          'VESSEL',
          rec.vessel_id,
          'flag',
          'FLAG_CHANGE',
          v_existing_flag,
          rec.vessel_flag,
          'Different flags reported across sources. May indicate reflagging. Sources: multiple RFMOs'
        );
        v_conflicts := v_conflicts + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Tracked % identifiers from % sources', v_identifiers, v_vessels;
  RAISE NOTICE 'Detected % conflicts (red flags for intelligence review)', v_conflicts;

  RETURN QUERY SELECT v_vessels, v_identifiers, v_conflicts;
END;
$$;

COMMENT ON FUNCTION curated.build_vessel_intelligence() IS
  'Intelligence-aware entity resolution: tracks source provenance, detects conflicts, builds vessel dossiers';

COMMIT;

-- Example: View vessel dossier with all sources
CREATE OR REPLACE VIEW curated.vessel_dossier AS
SELECT
  v.vessel_id,
  v.imo,
  v.vessel_name as primary_name,
  v.mmsi as primary_mmsi,
  v.flag_code,
  -- All reported names
  (
    SELECT jsonb_agg(jsonb_build_object(
      'name', identifier_value,
      'source', metadata->>'source_rfmo',
      'confidence', confidence
    ))
    FROM curated.vessel_identifiers
    WHERE vessel_id = v.vessel_id AND identifier_type = 'NAME'
  ) as all_names,
  -- All reported MMSIs
  (
    SELECT jsonb_agg(jsonb_build_object(
      'mmsi', identifier_value,
      'source', metadata->>'source_rfmo',
      'confidence', confidence,
      'collision', (metadata->>'collision_detected')::boolean
    ))
    FROM curated.vessel_identifiers
    WHERE vessel_id = v.vessel_id AND identifier_type = 'MMSI'
  ) as all_mmsis,
  -- Unresolved conflicts (RED FLAGS)
  (
    SELECT jsonb_agg(jsonb_build_object(
      'field', field_name,
      'type', conflict_type,
      'value_a', value_a,
      'value_b', value_b,
      'detected_at', detected_at
    ))
    FROM curated.entity_conflicts
    WHERE entity_id = v.vessel_id
      AND entity_type = 'VESSEL'
      AND resolved = false
  ) as red_flags
FROM curated.vessels v;

COMMENT ON VIEW curated.vessel_dossier IS
  'Complete vessel intelligence dossier showing all identifiers, sources, and conflicts';
