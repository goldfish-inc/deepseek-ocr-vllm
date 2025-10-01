# Shell Script Retirement Plan

## Current Script Inventory

### 1. `/scripts/bootstrap-gitops.sh`
**Purpose**: Bootstrap Flux GitOps with PKO
**Configuration Touched**:
- GitHub tokens from ESC
- Pulumi credentials from ESC
- Flux installation and configuration
- PKO deployment and secrets

### 2. `/cluster/scripts/rotate-k3s-token.sh`
**Purpose**: Rotate K3s cluster token and sync across all components
**Configuration Touched**:
- K3s master token generation
- ESC environment updates
- 1Password credential sync
- Pulumi configuration updates
- Worker node token updates
- Cluster health verification

### 3. `/cluster/scripts/sync-ssh-keys.sh`
**Purpose**: Sync SSH keys from 1Password to Pulumi config
**Configuration Touched**:
- 1Password document retrieval
- Pulumi config secret storage
- SSH key management for all nodes

### 4. `/cluster/scripts/rotate-ssh-keys.sh`
**Purpose**: Generate new SSH keys and deploy them to all nodes
**Configuration Touched**:
- SSH key generation (Ed25519)
- Node deployment and verification
- ESC environment updates
- Backup management
- Rotation metadata tracking

### 5. `/cluster/scripts/disable-password-auth.sh`
**Purpose**: Enforce key-only SSH authentication and security hardening
**Configuration Touched**:
- SSH daemon configuration
- Password authentication disabling
- Security policy enforcement
- Root account lockdown

### 6. `/cluster/scripts/sync-credentials.sh`
**Purpose**: Bidirectional sync between ESC and 1Password for all credentials
**Configuration Touched**:
- K3s token synchronization
- Node information updates
- SSH key verification
- Cluster health monitoring

### 7. `/cluster/scripts/migrate-ssh-to-esc.sh`
**Purpose**: One-time migration of SSH keys to ESC format
**Configuration Touched**:
- Base64 encoding of SSH keys
- ESC environment setup
- Pulumi config mapping

## Target IaC Replacements

### Pulumi Components to Create

1. **SSHKeyManager** (`/cluster/src/components/sshKeyManager.ts`)
   - Replace: `rotate-ssh-keys.sh`, `sync-ssh-keys.sh`, `migrate-ssh-to-esc.sh`
   - Features: Automated rotation, ESC integration, deployment verification

2. **K3sTokenRotator** (`/cluster/src/components/k3sTokenRotator.ts`)
   - Replace: `rotate-k3s-token.sh`
   - Features: Token generation, cluster-wide deployment, health checks

3. **SecurityHardening** (`/cluster/src/components/securityHardening.ts`)
   - Replace: `disable-password-auth.sh`
   - Features: DaemonSet-based SSH configuration, policy enforcement

4. **CredentialSynchronizer** (`/cluster/src/components/credentialSynchronizer.ts`)
   - Replace: `sync-credentials.sh`
   - Features: Automated ESC/1Password sync, validation, monitoring

### Flux Resources to Create

5. **FluxBootstrap** (Enhanced - self-installing)
   - Replace: `bootstrap-gitops.sh`
   - Features: Self-bootstrapping GitRepository, automated PKO deployment

## Migration Strategy

### Phase 1: Create IaC Components (Week 1)
- [ ] Implement SSHKeyManager component
- [ ] Implement K3sTokenRotator component
- [ ] Implement SecurityHardening DaemonSet
- [ ] Implement CredentialSynchronizer component
- [ ] Enhanced FluxBootstrap for self-installation

### Phase 2: Parallel Validation (Week 2)
- [ ] Deploy components alongside existing scripts
- [ ] Validate parity with existing functionality
- [ ] Test full rotation cycles
- [ ] Monitor for edge cases and issues

### Phase 3: Cut Over (Week 3)
- [ ] Mark scripts as deprecated
- [ ] Update documentation to use IaC paths
- [ ] Add CI policy checks to prevent script re-addition
- [ ] Create new runbooks for Pulumi operations

### Phase 4: Cleanup (Week 4)
- [ ] Remove all shell scripts
- [ ] Clean up package.json references
- [ ] Update AUDIT_SUMMARY.md
- [ ] Create enforcement policies

## Success Metrics

1. **Zero Manual Scripts**: All operations through Pulumi/Flux
2. **Full Automation**: SSH rotation, token rotation, security hardening
3. **Idempotency**: All operations can be safely re-run
4. **Observability**: Proper logging and status reporting
5. **Security**: No credential exposure in logs or intermediate files

## Risk Mitigation

1. **Backup Strategy**: Always maintain ESC and 1Password backups
2. **Rollback Plan**: Keep scripts available during migration period
3. **Testing**: Validate on non-production environment first
4. **Monitoring**: Watch for broken authentication or cluster issues
5. **Documentation**: Maintain runbooks for emergency procedures

## Timeline

- **Day 1-7**: Implement IaC components
- **Day 8-14**: Parallel validation and testing
- **Day 15-21**: Cut over and documentation updates
- **Day 22-28**: Cleanup and enforcement policies

## Next Steps

1. Start with SSHKeyManager component (lowest risk)
2. Implement K3sTokenRotator with extensive testing
3. Create SecurityHardening DaemonSet for immediate deployment
4. Build CredentialSynchronizer for ongoing maintenance
5. Enhance FluxBootstrap for complete self-installation