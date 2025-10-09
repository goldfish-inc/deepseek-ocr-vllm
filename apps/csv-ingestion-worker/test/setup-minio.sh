#!/bin/bash

# Setup MinIO for testing

echo "Setting up MinIO..."

# Create an alias for MinIO
docker exec csv-worker-minio mc alias set local http://localhost:9000 minioadmin minioadmin

# Create test bucket
docker exec csv-worker-minio mc mb local/test-bucket 2>/dev/null || true

# Set public read policy on bucket
docker exec csv-worker-minio mc anonymous set download local/test-bucket

# Copy test file
docker exec csv-worker-minio mc cp /data/test-bucket/neafc-test.csv local/test-bucket/neafc-test.csv 2>/dev/null || true

echo "MinIO setup complete!"
echo "Bucket: test-bucket"
echo "Access: http://localhost:9000/test-bucket/"
