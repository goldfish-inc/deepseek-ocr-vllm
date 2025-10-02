# Label Studio Authentication Setup

This document explains how Label Studio authentication is configured in the Oceanid cluster.

## Authentication Architecture

Label Studio 1.21.0 uses **JWT-based Personal Access Tokens (PAT)** as the default authentication method, replacing legacy API tokens. PATs act as refresh tokens; clients exchange a PAT for a short‑lived access token used with Bearer auth. The API can also support legacy token authentication when enabled.

### Token Types

1. **Personal Access Tokens (JWT)** - Default in v1.21.0+
   - Created via UI: `https://label.boathou.se/user/account/personal-access-token`
   - Format: JWT token (starts with `eyJ...`)
   - Usage: exchange PAT for access token via `/api/token/refresh`, then use `Authorization: Bearer <access>`

2. **Legacy API Tokens** - Optional and disabled by default
   - Simpler token format
   - Backward compatible with older Label Studio versions; requires `LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN=true`

## Configuration

### Environment Variables

The following environment variable is **required** for API token authentication to work:

```typescript
LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN=true
```

This enables the `legacy_api_tokens_enabled` flag for new organizations, allowing JWT tokens created in the UI to work with the API.

### Deployment Configuration

In `cluster/src/components/labelStudio.ts`:

```typescript
env: [
    // Enable legacy API token authentication (required for API access)
    { name: "LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN", value: "true" },
    // ... other env vars
]
```

## API Usage

Recommended (PAT refresh → Bearer):

```bash
# 1) Get PAT (refresh token) from the UI
PAT='<your PAT>'

# 2) Exchange PAT → access token (5 min expiry)
ACCESS=$(curl -s -X POST https://label.boathou.se/api/token/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refresh\": \"$PAT\"}" | jq -r .access)

# 3) Use access token with Bearer auth
curl -H "Authorization: Bearer $ACCESS" \
     https://label.boathou.se/api/projects/
```

Ops tip (ESC):

```bash
# Retrieve PAT from Pulumi ESC
PAT=$(esc env get default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioPat --value string --show-secrets)
```

Legacy scheme (if enabled):

```bash
curl -H "Authorization: Token <legacy-api-token>" \
     https://label.boathou.se/api/projects/
```

## Troubleshooting

### 401 / Invalid token

Symptoms:
- `{"detail": "Given token not valid for any token type"}` (expired access token)
- `{"detail": "Invalid token."}` (using PAT directly with Bearer or using legacy scheme without enabling it)

Fixes:
- Always refresh the PAT to get a short‑lived access token; then use `Authorization: Bearer <access>`
- If you need legacy tokens, enable `LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN=true` and use `Authorization: Token <legacy-token>`

### "Authentication credentials were not provided"

**Symptom**: API returns `{"detail": "Authentication credentials were not provided."}`

**Cause**: Token not included in request header or wrong format.

**Solution**:

- Use `Authorization: Token <token>` (not `Bearer`)
- Ensure token has no extra whitespace/newlines
- Verify token is actually sent in request

## Technical Details

### Authentication Flow

1. User creates PAT in Label Studio UI
2. Client exchanges PAT at `/api/token/refresh` for a short‑lived access token
3. API request includes `Authorization: Bearer <access>`
4. On expiry, client refreshes access token using PAT

### Django Configuration

From `label_studio/core/settings/base.py`:

```python
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'jwt_auth.auth.TokenAuthenticationPhaseout',
        'rest_framework.authentication.SessionAuthentication',
    ),
    # ...
}

LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN = get_bool_env('LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN', False)
```

### Feature Flag

The JWT authentication system is controlled by feature flag:

- `fflag__feature_develop__prompts__dia_1829_jwt_token_auth`

When enabled (default in 1.21.0+), the `TokenAuthenticationPhaseout` class checks organization settings before allowing token auth.

## References

- GitHub Issue: <https://github.com/HumanSignal/label-studio/issues/7355>
- GitHub PR: <https://github.com/HumanSignal/label-studio/pull/7413>
- Label Studio Docs: <https://labelstud.io/guide/api.html>
- Oceanid Issue: <https://github.com/goldfish-inc/oceanid/issues/58>

## Related Configuration

### S3 Storage

Label Studio is configured to use AWS S3 for persistent file storage. See S3 configuration in the same component file.

### Admin Credentials

Admin credentials are managed via Pulumi ESC:

- `labelStudioUsername` - Admin email
- `labelStudioPassword` - Admin password (encrypted)
