---
name: 🏷️ NER Label Change Proposal
about: Propose changes to the NER taxonomy (labels.json)
title: '[LABEL] '
labels: ['enhancement', 'ner', 'taxonomy']
assignees: []
---

## Proposal Type
<!-- Check all that apply -->
- [ ] **Label Addition** (minor version bump: 1.0.0 → 1.1.0)
- [ ] **Label Rename** (major version bump: 1.x.x → 2.0.0)
- [ ] **Label Removal/Deprecation** (major version bump: 1.x.x → 2.0.0)
- [ ] **Label Definition Update** (patch version: 1.0.0 → 1.0.1)
- [ ] **Validator Update** (patch version: 1.0.0 → 1.0.1)

---

## Current State

### Existing Label(s)
<!-- If modifying existing labels, provide current definitions -->
```json
{
  "index": X,
  "label": "EXISTING_LABEL",
  "description": "...",
  "category": "...",
  "dbMapping": "..."
}
```

### Problem Statement
<!-- Why is this change necessary? What issues does the current taxonomy have? -->



---

## Proposed Change

### New/Modified Label(s)
```json
{
  "index": X,
  "label": "NEW_LABEL",
  "description": "...",
  "category": "...",
  "dbMapping": "curated.table.field",
  "validator": "validate_function_name",
  "format": "regex_pattern"
}
```

### Rationale
<!-- Why this change improves the taxonomy -->
- **Business value**:
- **Data coverage**:
- **Model performance impact**:

---

## Impact Assessment

### Model Retraining Required?
- [ ] **Yes** - Model output shape changes (label addition/removal/reorder)
- [ ] **No** - Only metadata changes (description, validator, dbMapping)

### Affected Components
<!-- Check all that need updates -->
- [ ] `labels.json` (taxonomy definition)
- [ ] Model training pipeline (label order/count)
- [ ] Triton model `config.pbtxt` (output shape)
- [ ] Adapter `lsTritonAdapter.ts` (NER_LABELS array)
- [ ] Postprocessor `ner_config.py` (EntityType enum)
- [ ] Database schema (new table/field for dbMapping)
- [ ] Label Studio project (annotation interface)

### Migration Path
<!-- How to handle existing labeled data and deployed models -->

#### Training Data Migration
<!-- How to update existing annotations -->
- [ ] No migration needed
- [ ] Relabel affected spans
- [ ] Automated label mapping (provide script)
- [ ] Training corpus version bump

#### Model Migration
<!-- How to transition deployed models -->
- [ ] Deploy new model alongside old (A/B test)
- [ ] Blue-green deployment (instant cutover)
- [ ] Gradual rollout with confidence monitoring

#### Database Migration
<!-- If dbMapping changes require schema updates -->
- [ ] No DB changes needed
- [ ] Add new table/field (provide DDL)
- [ ] Migrate existing data (provide script)

---

## Backward Compatibility

### Alias Map
<!-- If renaming labels, provide old → new mapping -->
```json
{
  "OLD_LABEL": "NEW_LABEL",
  "DEPRECATED_LABEL": "REPLACEMENT_LABEL"
}
```

### Deprecation Timeline
<!-- If removing labels -->
1. **v1.X.0** (Minor release): Mark as deprecated, add warning
2. **v1.Y.0** (Next minor): Remove from active use, keep in schema for old data
3. **v2.0.0** (Major release): Fully remove from taxonomy

---

## Testing & Validation

### Test Cases
<!-- Provide examples showing correct behavior -->

#### Example 1: Positive Match
**Input text**:
```
...
```
**Expected extraction**:
```json
{"label": "NEW_LABEL", "text": "...", "start": X, "end": Y}
```

#### Example 2: Negative Match (should NOT match)
**Input text**:
```
...
```
**Expected**: No extraction for NEW_LABEL

#### Example 3: Edge Case
**Input text**:
```
...
```
**Expected extraction**:
```json
...
```

### Validator Logic
<!-- If adding/updating validator -->
```python
def validate_new_label(value: str) -> bool:
    """
    Validation logic for NEW_LABEL

    Args:
        value: Extracted entity text

    Returns:
        True if valid, False otherwise

    Examples:
        >>> validate_new_label("valid_example")
        True
        >>> validate_new_label("invalid_example")
        False
    """
    # Implementation
    pass
```

---

## Documentation Updates

### Files to Update
- [ ] `labels.json` - Add changeLog entry
- [ ] `CURRENT_STATE.md` - Update NER section
- [ ] `adapter/ner/README.md` - Document new label usage
- [ ] Training corpus README - Update annotation guidelines

### Annotation Guidelines
<!-- How should annotators use this label? -->

**When to use NEW_LABEL:**
-

**When NOT to use NEW_LABEL:**
-

**Common confusion with:**
- **OTHER_LABEL**: Distinguish by...

---

## Rollout Checklist

### Pre-Merge
- [ ] Review by NER subject matter expert
- [ ] Review by data science team
- [ ] Test validator logic with 100+ examples
- [ ] Update `labels.json` with new version number
- [ ] Create DB migration if schema changes needed

### Deployment
- [ ] Update ESC `nerLabels` configuration
- [ ] Deploy updated adapter
- [ ] Update Label Studio project labels
- [ ] Restart Triton if model changes
- [ ] Monitor confidence scores for 7 days

### Post-Deployment
- [ ] Verify model health endpoint shows correct label count
- [ ] Check extraction quality on 100 production documents
- [ ] Review annotation acceptance rate
- [ ] Document lessons learned

---

## References

<!-- Link to related issues, documents, or discussions -->
- Related issue: #
- Documentation:
- Slack discussion:
- Training data examples:

---

## Approval

<!-- Required approvals before implementation -->
- [ ] **Data Science Lead** - Model impact assessment
- [ ] **Backend Lead** - Database schema changes
- [ ] **SME** - Label definition and annotation guidelines
- [ ] **Product** - Business value and priority

---

## Version Bump

**Current version**: `1.0.0`
**Proposed version**: `1.X.0`
**Semver justification**:

---

<!--
IMPORTANT NOTES:

1. **Label Addition**: Always append to end of list (never insert in middle) to preserve indices for existing models
2. **Label Rename**: Requires major version bump + alias map + training data migration
3. **Label Removal**: Deprecate first in minor version, remove in major version
4. **Validator Changes**: Document edge cases and provide 100+ test examples

See labels.json deprecationPolicy for versioning rules.
-->