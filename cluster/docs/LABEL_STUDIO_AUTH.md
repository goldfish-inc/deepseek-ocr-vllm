# Label Studio Authentication Setup

This document explains how Label Studio authentication is configured in the Oceanid cluster.

## Authentication Architecture

Label Studio 1.21.0 uses **JWT-based Personal Access Tokens (PAT)** as the default authentication method, replacing legacy API tokens. However, the API still supports legacy token authentication when enabled.

### Token Types

1. **Personal Access Tokens (JWT)** - Default in v1.21.0+
   - Created via UI: `https://label.boathou.se/user/account/personal-access-token`
   - Format: JWT token (starts with `eyJ...`)
   - Requires organization setting: `legacy_api_tokens_enabled = true`

2. **Legacy API Tokens** - Supported but disabled by default
   - Simpler token format
   - Backward compatible with older Label Studio versions

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

Once configured, use tokens with the `Token` authentication scheme:

```bash
# Get your token from: https://label.boathou.se/user/account/personal-access-token

# Use with API
curl -H "Authorization: Token <your-jwt-token>" \
     https://label.boathou.se/api/projects/
```

## Troubleshooting

### "Invalid token" Error

**Symptom**: API returns `{"detail": "Invalid token."}`

**Cause**: The organization doesn't have `legacy_api_tokens_enabled` set to `true`.

**Solution**:
1. Ensure `LABEL_STUDIO_ENABLE_LEGACY_API_TOKEN=true` is in deployment
2. Restart Label Studio pod to apply changes
3. Regenerate token if created before fix

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
2. JWT token is generated and stored in database
3. API request includes `Authorization: Token <jwt>`
4. `TokenAuthenticationPhaseout` class validates:
   - Token exists in database
   - Organization has `legacy_api_tokens_enabled = true`
   - User/org is active
5. If valid, request proceeds; otherwise 401

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

- GitHub Issue: https://github.com/HumanSignal/label-studio/issues/7355
- GitHub PR: https://github.com/HumanSignal/label-studio/pull/7413
- Label Studio Docs: https://labelstud.io/guide/api.html
- Oceanid Issue: https://github.com/goldfish-inc/oceanid/issues/58

## Related Configuration

### S3 Storage

Label Studio is configured to use AWS S3 for persistent file storage. See S3 configuration in the same component file.

### Admin Credentials

Admin credentials are managed via Pulumi ESC:
- `labelStudioUsername` - Admin email
- `labelStudioPassword` - Admin password (encrypted)
