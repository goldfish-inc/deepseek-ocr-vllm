#!/bin/bash
# /app/scripts/core/logging.sh
# Extracted logging and utility functions for modular import system

# Set environment variable to disable pandera warning
export DISABLE_PANDERA_IMPORT_WARNING=True

# Enhanced logging with timestamps and validation
log_step() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - 📄 $1"
}

log_success() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ✅ $1"
}

log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ❌ $1"
}

log_warning() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ⚠️ $1"
}

# Create logs directory for debugging (called once when this script is sourced)
mkdir -p /import/logs
