# Label Studio API Authentication

## Overview

Label Studio 1.21.0 uses **JWT-based Personal Access Tokens (PAT)** for API authentication. The PAT acts as a **refresh token** that must be exchanged for short-lived **access tokens**.

## Authentication Flow

```
PAT (Refresh Token)
    → /api/token/refresh
    → Access Token (5 min expiry)
    → API Requests
```

## Step-by-Step Guide

### 1. Get Your PAT

1. Log into Label Studio: `https://label.boathou.se`
2. Navigate to: **User Account → Personal Access Token**
3. Copy the JWT token (starts with `eyJ...`)
4. Store in 1Password: `Development/Label Studio PAT`

### 2. Exchange PAT for Access Token

```bash
# Get PAT from 1Password
PAT=$(op read "op://Development/Label Studio PAT/credential")

# Exchange for access token
curl -X POST https://label.boathou.se/api/token/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh\": \"$PAT\"}" | jq -r '.access'
```

Response:

```json
{
  "access": "eyJhbGci...short-lived-token"
}
```

### 3. Use Access Token with API

```bash
ACCESS_TOKEN="eyJhbGci...from-step-2"

# Make API request
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://label.boathou.se/api/projects/
```

## Helper Function

Add to your shell profile:

```bash
ls_token() {
  PAT=$(op read "op://Development/Label Studio PAT/credential")
  curl -s -X POST https://label.boathou.se/api/token/refresh \
    -H "Content-Type: application/json" \
    -d "{\"refresh\": \"$PAT\"}" | jq -r '.access'
}

# Usage
curl -H "Authorization: Bearer $(ls_token)" \
  https://label.boathou.se/api/projects/
```

## Python SDK Example

```python
import requests

# Get PAT from environment or 1Password
PAT = "your-pat-token"

# Exchange for access token
response = requests.post(
    "https://label.boathou.se/api/token/refresh",
    json={"refresh": PAT}
)
access_token = response.json()["access"]

# Use with Label Studio SDK
from label_studio_sdk import Client

client = Client(
    url="https://label.boathou.se",
    api_key=access_token  # Use access token, not PAT
)

# Now you can use the SDK
projects = client.list_projects()
```

## Important Notes

### Token Lifetime

- **PAT (Refresh Token)**: Long-lived, store securely
- **Access Token**: ~5 minutes, refresh when expired

### Authentication Scheme

- **Correct**: `Authorization: Bearer <access-token>`
- **Incorrect**: `Authorization: Token <pat>` (won't work)

### Token Storage

- **PAT**: Store in 1Password, never commit to git
- **Access Token**: Generate on-demand, don't store

### Error Handling

#### 401 Unauthorized

```json
{"detail": "Given token not valid for any token type"}
```

**Solution**: Your access token expired. Get a new one from PAT.

#### 400 Bad Request

```json
{"refresh": ["This field may not be blank."]}
```

**Solution**: PAT not provided or empty. Check your environment variable.

## API Endpoints

### Token Management

- `POST /api/token/refresh` - Exchange PAT for access token
- `POST /api/token/verify` - Verify access token validity

### Common Endpoints

- `GET /api/projects/` - List projects
- `POST /api/projects/` - Create project
- `GET /api/projects/{id}/tasks/` - List tasks
- `POST /api/projects/{id}/tasks/` - Create task

Full API reference: <https://api.labelstud.io>

## Troubleshooting

### "Authentication credentials were not provided"

- Check Authorization header format: `Bearer <token>`
- Ensure you're using access token, not PAT
- Verify token isn't expired

### "Invalid token"

- PAT cannot be used directly with API
- Must exchange PAT for access token first
- Access token expires after 5 minutes

### Shell Variable Issues

- Avoid `$()` in zsh - use xargs or temp files
- Use `op read` instead of `op item get` for simplicity
- Quote tokens properly to avoid special char issues

## Related Documentation

- [Label Studio API Reference](https://api.labelstud.io)
- [Access Tokens Guide](https://labelstud.io/guide/access_tokens)
- [Label Studio SDK](https://pypi.org/project/label-studio-sdk/)
- [GitHub Issue #58](https://github.com/goldfish-inc/oceanid/issues/58)

## S3 Storage

Label Studio is configured with S3 persistent storage. Files uploaded via API will be automatically stored in `s3://labelstudio-goldfish-uploads/`.

## ML Backend Integration

The ML backend at `http://ls-triton-adapter.apps.svc.cluster.local:9090` can be accessed from within the cluster. For external access, it should also use PAT-based authentication.
