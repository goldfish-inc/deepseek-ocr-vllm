#!/bin/bash
# /app/scripts/core/database.sh
# Database connection utilities and validation functions

# Source logging functions
source /app/scripts/core/logging.sh

# Database connection validation with retry
wait_for_postgres() {
    log_step "Waiting for PostgreSQL to be ready..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; then
            log_success "PostgreSQL is ready!"
            return 0
        fi

        echo "   Attempt $attempt/$max_attempts - Waiting for PostgreSQL..."
        sleep 2
        ((attempt++))
    done

    log_error "PostgreSQL failed to become ready after $max_attempts attempts"
    exit 1
}

# Enhanced validation function with quality checks
validate_import_enhanced() {
    local table_name=$1
    local expected_min_records=$2
    local description=$3
    local quality_check=${4:-""}

    local actual_records
    actual_records=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM $table_name;" 2>/dev/null || echo "0")

    if [ "$actual_records" -ge "$expected_min_records" ]; then
        log_success "$description: $actual_records records imported successfully"

        # Run quality check if provided
        if [ -n "$quality_check" ]; then
            local quality_result
            quality_result=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$quality_check" 2>/dev/null || echo "0")
            log_success "  └── Quality check: $quality_result"
        fi

        return 0
    else
        log_error "$description: Only $actual_records records imported (expected at least $expected_min_records)"
        return 1
    fi
}

# Helper function for executing SQL with error handling
psql_execute() {
    local sql_command="$1"
    local description="${2:-SQL execution}"

    if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$sql_command" 2>/dev/null; then
        return 0
    else
        log_error "$description failed"
        return 1
    fi
}

# Helper function for executing SQL files
psql_execute_file() {
    local sql_file="$1"
    local description="${2:-SQL file execution}"

    if [ ! -f "$sql_file" ]; then
        log_error "SQL file not found: $sql_file"
        return 1
    fi

    if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$sql_file" 2>/dev/null; then
        log_success "$description completed successfully"
        return 0
    else
        log_error "$description failed"
        return 1
    fi
}
