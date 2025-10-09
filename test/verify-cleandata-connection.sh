#!/bin/bash

# Verify CSV worker can connect to cleandata database

echo "🔍 Verifying CSV Ingestion Worker connection to cleandata database..."
echo "============================================="

# Check if pods are running
echo "Checking CSV worker pods..."
kubectl -n apps get pods -l app=csv-ingestion-worker

# Get the first pod name
POD=$(kubectl -n apps get pods -l app=csv-ingestion-worker -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POD" ]; then
    echo "❌ No CSV worker pods found"
    exit 1
fi

echo "Using pod: $POD"

# Check environment variable
echo ""
echo "Checking DATABASE_URL environment variable..."
kubectl -n apps exec $POD -- sh -c 'echo "$DATABASE_URL" | sed "s/:.*@/:****@/"'

# Test database connection
echo ""
echo "Testing database connection..."
kubectl -n apps exec $POD -- sh -c '
if psql "$DATABASE_URL" -c "SELECT current_database(), current_user, current_schema;" 2>/dev/null; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed"
    exit 1
fi
'

# Check schemas exist
echo ""
echo "Checking schemas exist..."
kubectl -n apps exec $POD -- sh -c '
psql "$DATABASE_URL" -t -c "
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('"'"'stage'"'"', '"'"'control'"'"', '"'"'curated'"'"', '"'"'label'"'"', '"'"'raw'"'"')
ORDER BY schema_name;
" | grep -v "^$"
'

# Check stage tables exist
echo ""
echo "Checking stage schema tables..."
kubectl -n apps exec $POD -- sh -c '
psql "$DATABASE_URL" -t -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = '"'"'stage'"'"'
ORDER BY table_name;
" | grep -v "^$"
'

echo ""
echo "✅ Verification complete!"
