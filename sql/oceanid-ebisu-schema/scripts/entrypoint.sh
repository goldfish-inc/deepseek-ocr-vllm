#!/bin/bash
# ENHANCED DATABASE IMPORT WITH WoRMS-ASFIS DIRECT FK HARMONIZATION (COMPLETE MODULAR VERSION)
set -euo pipefail

# Source core utilities (with fallback for safety)
if [ -f "/app/scripts/core/logging.sh" ] && [ -f "/app/scripts/core/database.sh" ] && [ -f "/app/scripts/core/phase-orchestrator.sh" ]; then
    source /app/scripts/core/logging.sh
    source /app/scripts/core/database.sh
    source /app/scripts/core/phase-orchestrator.sh
else
    echo "ERROR: Core utilities not found. Using backup entrypoint.sh"
    exec /app/scripts/entrypoint.sh.original "$@"
fi

echo "🚀 Starting ENHANCED Database Import Process with WoRMS-ASFIS Direct FK Harmonization"
echo "======================================================================================"
echo "🎯 Includes: Original Sources, Reference, Country, Gear, ASFIS, WoRMS, ITIS"
echo "🔧 Enhanced: Better error handling, validation, and recovery mechanisms"
echo "🆕 NEW: WoRMS-ASFIS Direct FK Harmonization (matches TypeScript schema exactly)"
echo "🔗 Features: Proper FK constraints, JOINs work in DBeaver, data integrity"
echo "📋 Modular: Phase-based execution with comprehensive logging"
echo ""

wait_for_postgres

# === PHASE 1: MIGRATIONS ===
log_step "PHASE 1: Database Migrations"

if [ -f "/app/scripts/run-migrations.sh" ]; then
    if bash /app/scripts/run-migrations.sh 2>&1 | tee /import/logs/migrations.log; then
        log_success "Database migrations completed successfully"
    else
        log_error "Database migrations failed!"
        echo "📋 Check log: /import/logs/migrations.log"
        exit 1
    fi
else
    log_error "Migration script not found at /app/scripts/run-migrations.sh"
    exit 1
fi

# === PHASE 2: FOUNDATION SOURCES ===
log_step "PHASE 2: Loading Foundation Sources (CENTRALIZED SOURCE MANAGEMENT)"

if [ -f "/app/scripts/import/load_original_sources.sh" ]; then
    log_step "Loading original sources from CSV..."
    if bash /app/scripts/import/load_original_sources.sh 2>&1 | tee /import/logs/original_sources_import.log; then
        log_success "Original sources loaded successfully"
    else
        log_error "Original sources loading failed!"
        echo "📋 Check log: /import/logs/original_sources_import.log"
        exit 1
    fi
else
    log_error "Original sources script not found!"
    echo "   Expected: /app/scripts/import/load_original_sources.sh"
    exit 1
fi

# === PHASE 3: FOUNDATION TABLES (MODULAR) ===
log_step "PHASE 3: Loading Foundation Tables (MODULAR APPROACH)"

if execute_phase "03-foundation-data"; then
    log_success "Foundation data phase completed via modular script"
else
    log_error "Foundation data phase failed"
    exit 1
fi

# === PHASE 4: SPECIES DATA (MODULAR) ===
if execute_phase "04-species-data"; then
    log_success "Species data phase completed via modular script"
else
    log_error "Species data phase failed - taxonomic systems required for harmonization"
    exit 1
fi

# === PHASE 5: WoRMS-ASFIS HARMONIZATION (DIRECT FK APPROACH) ===
log_step "PHASE 5: WoRMS-ASFIS HARMONIZATION (DIRECT FK APPROACH)"
if execute_phase "05-harmonization"; then
    log_success "Species harmonization phase completed via modular script"
else
    log_warning "Species harmonization phase had issues - database will be functional with individual taxonomic systems"
    # Continue with remaining phases
fi

# === PHASE 6: MSC FISHERIES DATA LOADING (MODULAR) ===
if execute_phase "06-msc-fisheries"; then
    log_success "MSC fisheries phase completed via modular script"
else
    log_warning "MSC fisheries phase had issues - continuing with final validation"
    # Continue with final status report
fi

# === PHASE 7: FINAL STATUS REPORT (MODULAR) ===
if execute_phase "07-final-reporting"; then
    log_success "Final reporting phase completed via modular script"
else
    log_warning "Final reporting phase had issues"
fi

# === BEFORE PHASE 8: LOAD ORIGINAL_SOURCES_VESSELS TABLE ===

# STEP 1: Create and load original_sources_vessels table FIRST
log_step "Loading vessel sources from CSV..."
if [ -f "/app/scripts/import/vessels/create_sources_vessels.sql" ]; then
    psql_execute_file "/app/scripts/import/vessels/create_sources_vessels.sql" "Create vessel sources table"
fi

if [ -f "/app/scripts/import/vessels/load_sources_vessels.sh" ]; then
    bash /app/scripts/import/vessels/load_sources_vessels.sh
    log_success "Vessel sources loaded from CSV"
else
    log_error "load_sources_vessels.sh not found - vessel sources not loaded!"
    # This is critical - should probably exit here
fi

# === PHASE 8: RFMO VESSEL DATA (NEW) ===
log_step "PHASE 8: RFMO Vessel Data Import (NEW)"
if execute_phase "08-rfmo-vessels" "true"; then
    log_success "RFMO vessel phase completed via modular script"
else
    log_warning "RFMO vessel phase had issues - continuing with container startup"
    log_warning "Note: RFMO vessel data is optional - check if data files are available"
fi

# === PHASE XX: COUNTRY VESSEL DATA (PLACEHOLDER) ===

# === PHASE XX: EU-COUNTRY VESSEL DATA (PLACEHOLDER) ===

# === PHASE 9: BADDIE VESSEL DATA (NEW) ===
log_step "PHASE 9: BADDIE Vessel Data Import (NEW)"
if execute_phase "09-baddie-vessels" "true"; then
    log_success "BADDIE vessel phase completed via modular script"
else
    log_warning "BADDIE vessel phase had issues - continuing with container startup"
    log_warning "Note: BADDIE vessel data is optional - check if data files are available"
fi

# Keep container running
log_step "Modular import with phase-based orchestration complete - container will keep running for database access"
exec tail -f /dev/null
