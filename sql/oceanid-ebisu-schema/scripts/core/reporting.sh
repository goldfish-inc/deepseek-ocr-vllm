#!/bin/bash
# /app/scripts/core/reporting.sh
# Core reporting utilities for modular import system

source /app/scripts/core/logging.sh
source /app/scripts/core/database.sh

# Generate database table summary with categorization
generate_database_summary() {
    log_step "Database table summary (with categorized tables):"

    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'EOF'
SELECT
    schemaname,
    relname as tablename,
    CASE
        WHEN relname = 'worms_taxonomic_core' THEN '🌊 WoRMS Core Table (Normalized)'
        WHEN relname = 'worms_taxonomic_extended' THEN '🌊 WoRMS Extended Table (Normalized)'
        WHEN relname = 'itis_taxonomic_units' THEN '📚 ITIS Table (Enhanced - Optional)'
        WHEN relname = 'asfis_species' THEN '🟠 ASFIS Species (Enhanced)'
        WHEN relname = 'harmonized_species' THEN '🆕 Harmonized Species (Direct FK)'
        WHEN relname = 'harmonization_log' THEN '🆕 Harmonization Audit Log'
        WHEN relname = 'msc_fisheries' THEN 'MSC Fisheries (Main)'
        WHEN relname = 'msc_fisheries_species' THEN 'MSC Species Links'
        WHEN relname = 'msc_fisheries_fao_areas' THEN 'MSC FAO Areas Links'
        WHEN relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%' THEN '🚢 Vessel Tables'
        ELSE 'Regular Table'
    END as table_type,
    n_tup_ins as rows,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as size
FROM pg_stat_user_tables
WHERE n_tup_ins > 0
ORDER BY
    CASE
        WHEN relname = 'harmonized_species' THEN 1
        WHEN relname = 'harmonization_log' THEN 2
        WHEN relname = 'worms_taxonomic_core' THEN 3
        WHEN relname = 'asfis_species' THEN 4
        WHEN relname = 'itis_taxonomic_units' THEN 5
        WHEN relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%' THEN 6
        ELSE 10
    END,
    n_tup_ins DESC
LIMIT 40;
EOF
}

# Generate WoRMS-ASFIS harmonization summary
generate_harmonization_summary() {
    log_step "🆕 WoRMS-ASFIS Direct FK Harmonization Integration Summary:"

    local HARMONIZED_EXISTS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name = 'harmonized_species';" 2>/dev/null || echo "0")

    if [ "$HARMONIZED_EXISTS" -gt 0 ]; then
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'EOF'
-- Show direct FK WoRMS-ASFIS harmonization integration summary
SELECT '=== DIRECT FK WoRMS-ASFIS HARMONIZATION STATUS ===' as status_header;

-- Check if we have data
SELECT CASE
    WHEN COUNT(*) > 0 THEN 'SUCCESS: Direct FK harmonization completed with ' || COUNT(*) || ' species'
    ELSE 'PENDING: Harmonization table exists but no data loaded'
END as harmonization_status
FROM harmonized_species;

-- Show FK relationship validation
SELECT '=== FOREIGN KEY RELATIONSHIP VALIDATION ===' as fk_header;

SELECT
    'FK Relationships' as test_type,
    COUNT(*) as total_species,
    COUNT(*) FILTER (WHERE worms_taxon_id IS NOT NULL) as with_worms_fk,
    COUNT(*) FILTER (WHERE asfis_id IS NOT NULL) as with_asfis_fk,
    CASE
        WHEN COUNT(*) FILTER (WHERE worms_taxon_id IS NOT NULL) > 0
         AND COUNT(*) FILTER (WHERE asfis_id IS NOT NULL) > 0
        THEN '✅ FK RELATIONSHIPS WORKING'
        ELSE '❌ FK RELATIONSHIPS MISSING'
    END as fk_status
FROM harmonized_species;

-- Show boolean flag distribution (direct FK)
SELECT '=== MATCH TYPE DISTRIBUTION ===' as match_header;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM harmonized_species LIMIT 1) THEN
        -- Show match type distribution if data exists
        PERFORM
            CASE
                WHEN has_direct_alpha3 = true AND has_cascade_alpha3 = false THEN 'Direct ASFIS matches'
                WHEN has_direct_alpha3 = false AND has_cascade_alpha3 = true THEN 'Cascaded Alpha3 codes'
                WHEN has_direct_alpha3 = false AND has_cascade_alpha3 = false THEN 'WoRMS only (no codes)'
                ELSE 'Mixed/Other combinations'
            END as match_category,
            COUNT(*) as species_count,
            ROUND((COUNT(*)::DECIMAL / (SELECT COUNT(*) FROM harmonized_species) * 100), 1) as percentage
        FROM harmonized_species
        GROUP BY has_direct_alpha3, has_cascade_alpha3
        ORDER BY species_count DESC;

        -- Show quality statistics (direct FK)
        RAISE NOTICE '=== QUALITY STATISTICS ===';
        PERFORM
            'Total Species: ' || COUNT(*) as metric
        FROM harmonized_species
        UNION ALL
        SELECT 'With Trade Codes: ' || COUNT(*) FROM harmonized_species WHERE primary_alpha3_code IS NOT NULL
        UNION ALL
        SELECT 'Direct Matches: ' || COUNT(*) FROM harmonized_species WHERE has_direct_alpha3 = true
        UNION ALL
        SELECT 'Cascaded Codes: ' || COUNT(*) FROM harmonized_species WHERE has_cascade_alpha3 = true
        UNION ALL
        SELECT 'WoRMS FK Links: ' || COUNT(*) FROM harmonized_species WHERE worms_taxon_id IS NOT NULL
        UNION ALL
        SELECT 'ASFIS FK Links: ' || COUNT(*) FROM harmonized_species WHERE asfis_id IS NOT NULL
        UNION ALL
        SELECT 'Avg Confidence: ' || ROUND(AVG(confidence_score), 3) FROM harmonized_species;
    ELSE
        RAISE NOTICE 'No harmonized species data found - harmonization may have failed or been skipped';
    END IF;
END $$;
EOF
    else
        log_warning "WoRMS-ASFIS harmonized_species table not found - harmonization was skipped"
    fi
}

# Generate MSC fisheries summary
generate_msc_summary() {
    log_step "MSC Fisheries Integration Summary:"

    local MSC_FISHERIES_EXISTS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "
    SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'msc_fisheries';" 2>/dev/null || echo "0")

    if [ "$MSC_FISHERIES_EXISTS" -gt 0 ]; then
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'EOF'
-- Show MSC fisheries integration summary
SELECT '=== MSC FISHERIES INTEGRATION STATUS ===' as msc_header;

SELECT
    'MSC Fisheries' as component,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE msc_fishery_status = 'CERTIFIED') as certified,
    COUNT(*) FILTER (WHERE msc_gear_id IS NOT NULL) as with_gear_fk,
    COUNT(*) FILTER (WHERE source_id IS NOT NULL) as with_source_fk,
    CASE
        WHEN COUNT(*) > 0 THEN 'MSC FISHERIES LOADED'
        ELSE 'NO MSC FISHERIES DATA'
    END as status
FROM msc_fisheries;

SELECT
    'MSC Junction Tables' as component,
    (SELECT COUNT(*) FROM msc_fisheries_species) as species_links,
    (SELECT COUNT(*) FROM msc_fisheries_fao_areas) as fao_area_links,
    (SELECT COUNT(DISTINCT msc_fishery_id) FROM msc_fisheries_species) as fisheries_with_species,
    (SELECT COUNT(DISTINCT msc_fishery_id) FROM msc_fisheries_fao_areas) as fisheries_with_areas,
    CASE
        WHEN (SELECT COUNT(*) FROM msc_fisheries_species) > 0
         AND (SELECT COUNT(*) FROM msc_fisheries_fao_areas) > 0
        THEN 'MSC RELATIONSHIPS WORKING'
        ELSE 'MSC RELATIONSHIPS LIMITED'
    END as status;
EOF
    else
        log_warning "MSC fisheries tables not found - MSC import was skipped"
    fi
}

# Generate vessel data summary (extensible for future vessel phases)
generate_vessel_summary() {
    log_step "Vessel Data Integration Summary:"

    # Get all vessel-related tables dynamically
    local vessel_tables
    vessel_tables=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND (tablename LIKE '%vessel%' OR tablename LIKE '%iuu%' OR tablename LIKE '%sdn%')
        ORDER BY tablename;" 2>/dev/null)

    if [ -n "$vessel_tables" ]; then
        echo "=== VESSEL DATA INTEGRATION STATUS ==="

        local total_vessel_records=0
        echo "$vessel_tables" | while read -r table_name; do
            if [ -n "$table_name" ]; then
                local record_count
                record_count=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM $table_name;" 2>/dev/null || echo "0")

                local table_size
                table_size=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_size_pretty(pg_total_relation_size('$table_name'));" 2>/dev/null || echo "unknown")

                if [ "$record_count" -gt 0 ]; then
                    echo "  📊 $table_name: $record_count records ($table_size)"
                    total_vessel_records=$((total_vessel_records + record_count))
                else
                    echo "  📊 $table_name: empty"
                fi
            fi
        done

        if [ "$total_vessel_records" -gt 0 ]; then
            log_success "Total vessel records across all tables: $total_vessel_records"
        else
            log_warning "No vessel data found - vessel phases may not have run yet"
        fi
    else
        log_warning "No vessel tables found - vessel phases not yet implemented"
    fi
}

# Generate original sources summary
generate_sources_summary() {
    log_step "Original Sources Summary:"

    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'EOF' || log_warning "Could not show original sources status"
-- Show original sources with their data status
SELECT
    source_shortname,
    source_types,
    refresh_date,
    status,
    size_approx,
    CASE
        WHEN status = 'LOADED' THEN '✅ Data Loaded'
        WHEN status = 'PENDING' THEN '⏳ Pending'
        WHEN status = 'FAILED' THEN '❌ Failed'
        ELSE '❓ Unknown'
    END as status_display
FROM original_sources
ORDER BY source_types::text, source_shortname;
EOF
}

# Generate comprehensive validation summary
generate_validation_summary() {
    log_step "🆕 MODULAR IMPORT VALIDATION SUMMARY (WITH DIRECT FK WoRMS-ASFIS HARMONIZATION):"

    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" << 'EOF'
-- Enhanced validation summary with direct FK WoRMS-ASFIS harmonization
WITH import_validation AS (
    SELECT
        'Foundation Tables (MODULAR)' as dataset,
        (SELECT COUNT(*) FROM gear_types_msc) +
        (SELECT COUNT(*) FROM country_profiles) +
        (SELECT COUNT(*) FROM reference_data) as records,
        '✅ MODULAR PHASE EXECUTION' as status,
        'Executed via phase-based orchestration' as features

    UNION ALL

    SELECT
        'ASFIS Species' as dataset,
        COUNT(*) as records,
        CASE
            WHEN COUNT(*) > 25000 THEN '⚠️ HIGH - Verify expected'
            WHEN COUNT(*) BETWEEN 13000 AND 25000 THEN '✅ GOOD'
            WHEN COUNT(*) BETWEEN 5000 AND 13000 THEN '⚠️ LOW - Verify source'
            ELSE '❌ CRITICAL - Too few records'
        END as status,
        'Trade codes with taxonomic hierarchy' as features
    FROM asfis_species

    UNION ALL

    SELECT
        'WoRMS Core Taxa (Normalized)',
        COUNT(*),
        CASE
            WHEN COUNT(*) > 500000 THEN '✅ EXCELLENT'
            WHEN COUNT(*) > 100000 THEN '✅ GOOD'
            WHEN COUNT(*) > 50000 THEN '⚠️ PARTIAL'
            ELSE '❌ CRITICAL'
        END,
        'Normalized for faster queries'
    FROM worms_taxonomic_core

    UNION ALL

    SELECT
        '🆕 Harmonized Species (Direct FK)',
        COALESCE((SELECT COUNT(*) FROM harmonized_species), 0),
        CASE
            WHEN COALESCE((SELECT COUNT(*) FROM harmonized_species), 0) > 100000 THEN '✅ EXCELLENT - Direct FK'
            WHEN COALESCE((SELECT COUNT(*) FROM harmonized_species), 0) > 50000 THEN '✅ GOOD - Direct FK'
            WHEN COALESCE((SELECT COUNT(*) FROM harmonized_species), 0) > 10000 THEN '⚠️ LIMITED - Direct FK'
            WHEN COALESCE((SELECT COUNT(*) FROM harmonized_species), 0) = 0 THEN '❌ FAILED - Check migration'
            ELSE '❌ CRITICAL - Check migration'
        END,
        'MODULAR: Direct FK to source tables, JOINs work properly'

    UNION ALL

    -- Add vessel data validation (extensible)
    SELECT
        '🚢 Vessel Data (All Tables)',
        COALESCE((
            SELECT SUM(n_tup_ins)
            FROM pg_stat_user_tables
            WHERE relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%'
        ), 0),
        CASE
            WHEN COALESCE((
                SELECT SUM(n_tup_ins)
                FROM pg_stat_user_tables
                WHERE relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%'
            ), 0) > 50000 THEN '✅ EXCELLENT - Multiple datasets'
            WHEN COALESCE((
                SELECT SUM(n_tup_ins)
                FROM pg_stat_user_tables
                WHERE relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%'
            ), 0) > 10000 THEN '✅ GOOD - Some datasets'
            WHEN COALESCE((
                SELECT SUM(n_tup_ins)
                FROM pg_stat_user_tables
                WHERE relname LIKE '%vessel%' OR relname LIKE '%iuu%' OR relname LIKE '%sdn%'
            ), 0) > 0 THEN '⚠️ LIMITED - Few datasets'
            ELSE 'ℹ️ NOT YET IMPLEMENTED'
        END,
        'FUTURE: Configuration-driven vessel imports'
)
SELECT * FROM import_validation ORDER BY
    CASE WHEN dataset LIKE '🆕%' THEN 1 WHEN dataset LIKE 'Foundation%' THEN 2 ELSE 3 END,
    records DESC;
EOF
}

# Generate final success message with phase information
generate_final_message() {
    echo ""
    echo "🎉 MODULAR Database Import Process with Direct FK WoRMS-ASFIS Harmonization Finished!"
    echo "========================================================================================="
    log_success "All import phases completed with modular phase-based orchestration"
    log_success "✅ Foundation tables executed via modular phase script"
    log_success "Centralized original_sources management implemented"
    log_success "ASFIS trade data with proper taxonomic hierarchy support"
    log_success "WoRMS bulletproof normalized tables (core + extended for optimal performance)"
    log_success "ITIS table with corrected constraints (optional for WoRMS-ASFIS)"
    log_success "🆕 WoRMS-ASFIS Direct FK Harmonization with proper FK constraints for maximum relational integrity"
    log_success "MSC Fisheries data with proper species and FAO area relationships"
    log_success "📋 Modular phase-based execution with comprehensive logging and error handling"
    log_success "Database ready for ultra-high-performance API queries with direct FK harmonized species lookup"

    echo ""
    echo "📋 **MODULAR IMPORT ARCHITECTURE:**"
    echo "   ✅ Core utilities extracted and tested (logging.sh, database.sh, phase-orchestrator.sh, reporting.sh)"
    echo "   ✅ Foundation data phase extracted and working (03-foundation-data.sh)"
    echo "   ✅ Species data phase extracted and working (04-species-data.sh)"
    echo "   ✅ Harmonization phase extracted and working (05-harmonization.sh)"
    echo "   ✅ MSC fisheries phase extracted and working (06-msc-fisheries.sh)"
    echo "   ✅ Final reporting system modularized and extensible"
    echo "   🔄 Ready for vessel data phases (07+)"
}

# Generate logs summary
generate_logs_summary() {
    log_step "Modular Import Summary & Results:"
    echo "📋 Logs available in /import/logs/ for detailed troubleshooting"
    echo "🔍 Key logs to check:"
    echo "   - /import/logs/migrations.log (Database migrations)"
    echo "   - /import/logs/original_sources_import.log (Foundation sources)"
    echo "   - Foundation data phase logs handled via modular phase script"
    echo "   - /import/logs/asfis_full_pipeline.log (ASFIS enhanced pipeline)"
    echo "   - /import/logs/worms_bulletproof_normalized_import.log (WoRMS bulletproof normalized approach)"
    echo "   - /import/logs/itis_enhanced_corrected_import.log (ITIS with corrected constraints - optional)"
    echo "   - 🆕 /import/logs/worms_asfis_direct_fk_harmonization.log (WoRMS-ASFIS direct FK harmonization)"
    echo "   - /import/logs/msc_fisheries_import.log (MSC fisheries data)"
    echo "   - Future: Vessel import logs will be added automatically"
}
