# ADR-001: Modular entrypoint.sh Architecture

## Status
**Accepted** - Implemented and operational

## Context

### Problem
The original `entrypoint.sh` script had grown to over 500 lines with complex inline logic for:
- Database import orchestration
- Species data processing (ASFIS, WoRMS, ITIS)
- Harmonization workflows
- MSC fisheries integration
- Comprehensive validation and reporting

This monolithic approach created several issues:
- **Maintainability**: Difficult to debug specific import phases
- **Testing**: Cannot test individual components in isolation
- **Scalability**: Adding vessel data imports (40+ datasets) would make the script unmanageable
- **Recovery**: Failures required rerunning entire import process
- **Code Reuse**: Import logic couldn't be reused in other contexts

### Requirements
- Maintain 100% existing functionality and output
- Enable independent testing of import phases
- Support incremental execution and recovery
- Prepare for vessel data expansion (40+ datasets)
- Preserve detailed logging and validation
- Maintain backward compatibility with existing deployment

## Decision

### Architecture: Phase-Based Modular System

**Core Structure:**
```
/app/scripts/
├── core/                    # Reusable utilities
│   ├── logging.sh          # Centralized logging functions
│   ├── database.sh         # DB connection and validation
│   ├── phase-orchestrator.sh # Phase execution framework
│   └── reporting.sh        # Modular reporting system
├── phases/                 # Self-contained import phases
│   ├── 03-foundation-data.sh
│   ├── 04-species-data.sh
│   ├── 05-harmonization.sh
│   ├── 06-msc-fisheries.sh
│   └── 07-final-reporting.sh
└── entrypoint.sh          # Lightweight orchestrator
```

**Key Design Principles:**

1. **Phase Independence**: Each phase is self-contained with proper error handling
2. **Utility Sharing**: Common functions extracted to `/core/` directory
3. **Fallback Safety**: Main entrypoint has fallback to original monolithic script
4. **Configuration-Driven**: Reporting system automatically discovers new tables/phases
5. **Backward Compatibility**: Identical user experience and output format

### Implementation Details

**Phase Execution Pattern:**
```bash
if execute_phase "04-species-data"; then
    log_success "Species data phase completed via modular script"
else
    log_error "Species data phase failed - taxonomic systems required"
    exit 1
fi
```

**Utility Function Pattern:**
```bash
# Each phase script sources required utilities
source /app/scripts/core/logging.sh
source /app/scripts/core/database.sh
```

**Error Handling Strategy:**
- Phase-level validation with detailed logging
- Atomic operations where possible
- Graceful degradation for optional components
- Comprehensive final validation

## Consequences

### Positive

**Maintainability:**
- Individual phases can be debugged and modified independently
- Clear separation of concerns reduces cognitive complexity
- Reusable utilities eliminate code duplication

**Testing:**
- Each phase can be tested in isolation: `bash /app/scripts/phases/04-species-data.sh`
- Unit testing possible for individual utility functions
- Integration testing maintains full-system validation

**Scalability:**
- Ready for vessel data expansion without entrypoint.sh bloat
- Configuration-driven approach for 40+ vessel datasets
- Reporting system automatically adapts to new phases

**Operations:**
- Failed phases can be re-run individually
- Incremental deployment and rollback capabilities
- Better error localization and recovery

**Development Velocity:**
- Parallel development of different phases possible
- Easier onboarding for new team members
- Reduced merge conflicts

### Negative

**Complexity:**
- More files to manage (8 scripts vs 1 monolithic)
- Additional sourcing overhead and dependency management
- Requires understanding of phase orchestration pattern

**Debugging:**
- Stack traces may span multiple files
- Phase interdependencies must be carefully managed
- Slightly more complex failure analysis

### Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Phase dependency failures | High | Built-in dependency checking and validation |
| File system permissions | Medium | Explicit chmod in deployment process |
| Core utility corruption | High | Fallback to original monolithic script |
| Phase ordering issues | Medium | Clear naming convention and documentation |

### Migration Strategy

1. **Phase 1**: Extract utility functions (logging, database) - **COMPLETED**
2. **Phase 2**: Extract foundation data phase - **COMPLETED**
3. **Phase 3**: Extract species data phase - **COMPLETED**
4. **Phase 4**: Extract harmonization phase - **COMPLETED**
5. **Phase 5**: Extract MSC fisheries phase - **COMPLETED**
6. **Phase 6**: Extract final reporting - **COMPLETED**
7. **Phase 7**: Add vessel data phases - **PLANNED**

### Success Metrics

- **Functionality**: 100% preservation of existing import behavior ✅
- **Performance**: No degradation in import times ✅
- **Reliability**: Maintained comprehensive validation ✅
- **Maintainability**: Individual phase testing capability ✅
- **Scalability**: Architecture supports vessel data expansion ✅

## Implementation Notes

### Compatibility
- Original `entrypoint.sh.original` maintained as backup
- Fallback mechanism built into new entrypoint
- Identical log output and validation messages preserved

### Future Considerations
- Vessel data phases will use configuration-driven approach
- Reporting system designed to auto-discover new tables
- Phase orchestrator supports parallel execution potential
- Consider moving to structured config files (YAML/JSON) for complex datasets

### Documentation Requirements
- Update deployment procedures to include phase script permissions
- Document phase execution order and dependencies
- Create troubleshooting guide for phase-specific issues

---

**Decision Date**: August 2025
**Stakeholders**: Database Engineering Team, DevOps Team
**Review Date**: December 2025 (post vessel data implementation)
