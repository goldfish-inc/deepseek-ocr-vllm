# Final Script Removal Checklist

## ✅ Pre-Removal Validation

Before removing any scripts, ensure the following validations pass:

### 1. Run Comprehensive Validation
```bash
./scripts/validate-iac-migration.sh
```
**Expected Result**: All checks pass, 0 errors found

### 2. Verify Migration Phase
```bash
pulumi stack output migrationStatus
```
**Expected Result**: `{"phase": "cleanup", "scriptRetirementReady": true}`

### 3. Test All IaC Components
```bash
cd cluster/
pulumi preview
```
**Expected Result**: No pending changes, all components healthy

## 🗑️ Script Removal Commands

**⚠️ CRITICAL**: Only run these commands after validation passes!

### Step 1: Remove Shell Scripts
```bash
# Remove cluster scripts directory
rm -rf cluster/scripts/

# Remove bootstrap script
rm -f scripts/bootstrap-gitops.sh

# Verify removal
find . -name "*.sh" -path "*/scripts/*" | grep -v ".github" | grep -v "validate-iac-migration.sh"
# Should return empty result
```

### Step 2: Clean Up package.json References
```bash
# Edit package.json to remove script references
# Remove any "scripts" entries that call shell scripts
```

### Step 3: Update .gitignore (if needed)
```bash
# Remove any script-specific ignores that are no longer needed
```

## 📋 Post-Removal Verification

### 1. Verify No Script Dependencies
```bash
# Search for any remaining script references
grep -r "\.sh" --exclude-dir=.git --exclude-dir=node_modules . | grep -v "validate-iac-migration.sh"
```

### 2. Test Infrastructure Operations
```bash
# Test SSH rotation
pulumi up --target "*SSHKeyManager*"

# Test K3s token rotation
pulumi up --target "*K3sTokenRotator*"

# Test security hardening
pulumi up --target "*SecurityHardening*"
```

### 3. Run Policy Enforcement
```bash
# This should pass with flying colors
.github/workflows/policy-enforcement.yml
```

## 🔄 Migration Complete Commands

### Mark Migration as Complete
```bash
cd cluster/
pulumi config set migration_phase cleanup
pulumi up
```

### Final Status Check
```bash
pulumi stack output scriptRetirementReady
# Should return: true

pulumi stack output migrationStatus
# Should show cleanup phase complete
```

## 📚 Documentation Updates

### Update README.md
Add section about IaC operations:

```markdown
## Infrastructure Operations

All infrastructure operations are now performed through Pulumi:

- **SSH Key Rotation**: `pulumi up --target "*SSHKeyManager*"`
- **K3s Token Rotation**: `pulumi up --target "*K3sTokenRotator*"`
- **Security Hardening**: `pulumi up --target "*SecurityHardening*"`
- **Credential Sync**: `pulumi up --target "*CredentialSynchronizer*"`
- **GitOps Bootstrap**: `pulumi up --target "*SelfInstallingFlux*"`

### Emergency Procedures
- **Full Infrastructure**: `pulumi up`
- **Component Health**: `pulumi stack output componentHealth`
- **Migration Status**: `pulumi stack output migrationStatus`
```

### Update AUDIT_SUMMARY.md
```markdown
## Infrastructure as Code Migration - COMPLETE

**Status**: ✅ COMPLETE
**Date**: $(date +%Y-%m-%d)
**Shell Scripts**: RETIRED
**IaC Coverage**: 100%

### Retired Scripts → IaC Components
- `rotate-ssh-keys.sh` → `SSHKeyManager`
- `rotate-k3s-token.sh` → `K3sTokenRotator`
- `disable-password-auth.sh` → `SecurityHardening`
- `sync-credentials.sh` → `CredentialSynchronizer`
- `bootstrap-gitops.sh` → `SelfInstallingFlux`
- `sync-ssh-keys.sh` → Integrated into `SSHKeyManager`
- `migrate-ssh-to-esc.sh` → Integrated into `SSHKeyManager`

### Security Improvements
- ✅ No credential exposure in logs
- ✅ ESC-based secret management
- ✅ Automated rotation and validation
- ✅ Complete audit trail
- ✅ Policy enforcement active
```

## 🎯 Success Criteria

### All Must Be True
- [ ] `validate-iac-migration.sh` passes with 0 errors
- [ ] `scriptRetirementReady` output is `true`
- [ ] All shell scripts removed from `scripts/` and `cluster/scripts/`
- [ ] Policy enforcement workflow passes
- [ ] All IaC components deploy successfully
- [ ] Documentation updated
- [ ] Team trained on new IaC procedures

### Final Verification Command
```bash
echo "🏆 Script Retirement Verification"
echo "================================"

# Check for any remaining forbidden scripts
SCRIPTS=$(find . -name "*.sh" -path "*/scripts/*" | grep -v ".github" | grep -v "validate-iac-migration.sh" || echo "")
if [ -z "$SCRIPTS" ]; then
    echo "✅ No forbidden scripts found"
else
    echo "❌ Scripts still present: $SCRIPTS"
    exit 1
fi

# Check migration status
cd cluster/
STATUS=$(pulumi stack output scriptRetirementReady 2>/dev/null || echo "false")
if [ "$STATUS" = "true" ]; then
    echo "✅ Migration marked as complete"
else
    echo "❌ Migration not complete: $STATUS"
    exit 1
fi

echo ""
echo "🎉 SCRIPT RETIREMENT SUCCESSFUL!"
echo "All shell scripts have been successfully replaced with Infrastructure as Code."
echo "The Oceanid infrastructure now operates with 100% IaC automation."
```

## 🚨 Rollback Plan (Emergency Only)

If issues arise after script removal:

1. **Restore from Git**: `git revert <removal-commit>`
2. **Emergency SSH Access**: Use ESC keys directly
3. **Manual Operations**: Use `kubectl` and `pulumi` commands
4. **Support Contact**: Reference `SCRIPT_RETIREMENT_COMPLETE.md`

## 🏁 Mission Accomplished

Upon completion of this checklist:
- **Zero shell scripts** in operational paths
- **100% Infrastructure as Code** coverage
- **Enterprise-grade security** and automation
- **Complete audit trail** and observability
- **Policy enforcement** preventing regression

**The Oceanid infrastructure transformation is complete!** 🎉