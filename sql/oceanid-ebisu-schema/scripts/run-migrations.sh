#!/bin/bash
# Migration runner for ebisu database

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database connection parameters
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"  # Inside Docker, PostgreSQL runs on standard port
DB_NAME="${POSTGRES_DB:-ebisu}"
DB_USER="${POSTGRES_USER:-ebisu_user}"
DB_PASSWORD="${POSTGRES_PASSWORD:-ebisu_password}"

# Migration directory
MIGRATION_DIR="/app/migrations"

echo -e "${YELLOW}Starting ebisu database migrations...${NC}"

# Wait for database to be ready
echo "Waiting for database to be ready..."
until PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c '\q' 2>/dev/null; do
  echo "Database is unavailable - sleeping"
  sleep 1
done

echo -e "${GREEN}Database is ready!${NC}"

# Create migration tracking table if it doesn't exist
echo "Setting up migration tracking..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME <<EOF
CREATE TABLE IF NOT EXISTS applied_migrations (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
EOF

# Run migrations
for migration in $(ls $MIGRATION_DIR/*.sql | sort); do
    filename=$(basename "$migration")

    # Check if migration has already been applied
    already_applied=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM applied_migrations WHERE filename = '$filename'")

    if [ $already_applied -eq 0 ]; then
        echo -e "${YELLOW}Applying migration: $filename${NC}"

        # Apply the migration
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration"

        # Record the migration
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "INSERT INTO applied_migrations (filename) VALUES ('$filename')"

        echo -e "${GREEN}✓ Applied: $filename${NC}"
    else
        echo -e "${GREEN}✓ Already applied: $filename${NC}"
    fi
done

echo -e "${GREEN}All migrations completed successfully!${NC}"

# Display migration status
echo -e "\n${YELLOW}Migration Status:${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT filename, applied_at FROM applied_migrations ORDER BY applied_at"

# Display table count
echo -e "\n${YELLOW}Database Statistics:${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME <<EOF
SELECT
    'Tables' as type,
    COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
UNION ALL
SELECT
    'Views' as type,
    COUNT(*) as count
FROM information_schema.views
WHERE table_schema = 'public'
UNION ALL
SELECT
    'Indexes' as type,
    COUNT(*) as count
FROM pg_indexes
WHERE schemaname = 'public';
EOF
