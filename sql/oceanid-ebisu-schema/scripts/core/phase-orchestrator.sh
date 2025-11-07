#!/bin/bash
# /app/scripts/core/phase-orchestrator.sh
# Phase orchestration utilities for modular import system

source /app/scripts/core/logging.sh

# Phase execution with error handling
execute_phase() {
    local phase_name="$1"
    local phase_script="/app/scripts/phases/${phase_name}.sh"
    local optional="${2:-false}"

    log_step "Executing phase: $phase_name"

    if [ ! -f "$phase_script" ]; then
        if [ "$optional" = "true" ]; then
            log_warning "Optional phase script not found: $phase_script - skipping"
            return 0
        else
            log_error "Required phase script not found: $phase_script"
            return 1
        fi
    fi

    # Make sure script is executable
    chmod +x "$phase_script"

    # Execute phase with timing
    local start_time=$(date +%s)

    if bash "$phase_script"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_success "Phase $phase_name completed successfully in ${duration}s"
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_error "Phase $phase_name failed after ${duration}s"
        return 1
    fi
}

# Test individual phase (useful for development)
test_phase() {
    local phase_name="$1"

    echo "🧪 Testing individual phase: $phase_name"
    echo "================================================"

    if execute_phase "$phase_name"; then
        echo "✅ Phase test successful"
        return 0
    else
        echo "❌ Phase test failed"
        return 1
    fi
}

# Handle phase failure with different strategies
handle_phase_failure() {
    local phase_name="$1"
    local criticality="${2:-medium}"

    case "$criticality" in
        "critical")
            log_error "Critical phase $phase_name failed - stopping execution"
            exit 1
            ;;
        "medium")
            log_warning "Phase $phase_name failed - continuing with caution"
            return 1
            ;;
        "optional")
            log_warning "Optional phase $phase_name failed - continuing normally"
            return 0
            ;;
        *)
            log_warning "Phase $phase_name failed - continuing with default handling"
            return 1
            ;;
    esac
}

# Generate phase execution report
generate_phase_report() {
    local -a successful_phases=("$@")

    log_step "Phase Execution Summary:"
    if [ ${#successful_phases[@]} -gt 0 ]; then
        log_success "Successful phases: ${successful_phases[*]}"
    else
        log_warning "No phases completed successfully"
    fi
}
