FROM python:3.11-alpine

# Install dependencies
RUN apk add --no-cache postgresql-client bash

# Install Python packages (enhanced for data processing)
RUN pip install --break-system-packages pandas pandera psycopg2-binary

# Set working directory
WORKDIR /app

# Note: Docker context is set in docker-compose.yml
# These paths are relative to the context (../)
COPY scripts /app/scripts
COPY migrations /app/migrations

# AGGRESSIVE permission fixing - enhanced for debugging
RUN chmod -R +x /app/scripts/
RUN chmod +x /app/scripts/*.sh || true
RUN chmod +x /app/scripts/*.py || true
RUN chmod +x /app/scripts/entrypoint.sh || true
RUN chmod +x /app/scripts/enhanced_worms_kingdom_splitter.py || true
RUN chmod +x /app/scripts/enhanced_clean_load_worms.sh || true
RUN chmod +x /app/scripts/worms_debug.sh || true

# Make SQL files readable
RUN find /app/scripts -name "*.sql" -type f -exec chmod 644 {} \; || true

# Create necessary directories
RUN mkdir -p /import/logs
RUN mkdir -p /import/WoRMS_kingdoms
RUN mkdir -p /app/scripts/kingdom_imports
RUN mkdir -p /app/migrations

# Test that essential scripts are executable and exist
RUN ls -la /app/scripts/entrypoint.sh
RUN ls -la /app/scripts/enhanced_worms_kingdom_splitter.py || echo "⚠️ Enhanced WoRMS splitter not found"
RUN ls -la /app/scripts/enhanced_clean_load_worms.sh || echo "⚠️ Enhanced WoRMS loader not found"
RUN ls -la /app/scripts/worms_debug.sh || echo "⚠️ WoRMS debug script not found"
RUN test -x /app/scripts/entrypoint.sh && echo "✅ entrypoint.sh is executable" || echo "❌ entrypoint.sh is NOT executable"

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
