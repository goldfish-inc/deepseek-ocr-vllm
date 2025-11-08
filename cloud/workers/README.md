# Ollama Proxy Worker

Cloudflare Worker that proxies authenticated requests to DGX Spark's Ollama instance via Cloudflare Tunnel.

## Architecture

```
Client → Worker (ollama-api.goldfish.io) → Tunnel (ollama.goldfish.io) → Ollama (localhost:11434)
```

## Authentication

Uses AI Gateway-style authentication with `cf-aig-authorization` header:

```bash
curl https://ollama-api.goldfish.io/v1/chat/completions \
  -H "cf-aig-authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.3:70b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Deployment

### Prerequisites

- Wrangler CLI installed: `pnpm add -g wrangler`
- Cloudflare account with Workers enabled
- DNS record: `ollama-api.goldfish.io` CNAME to worker route

### Steps

1. **Generate authentication token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Set secrets:**
   ```bash
   cd cloud/workers
   wrangler secret put OLLAMA_ORIGIN --env production
   # Enter: https://ollama.goldfish.io

   wrangler secret put AIG_AUTH_TOKEN --env production
   # Enter: <token-from-step-1>
   ```

3. **Deploy:**
   ```bash
   wrangler deploy --env production
   ```

4. **Store token in Pulumi ESC:**
   ```bash
   pulumi config set --secret dgx-spark:aigAuthToken "<token-from-step-1>" --cwd cloud
   ```

## Testing

```bash
# Get token from ESC
TOKEN=$(pulumi config get dgx-spark:aigAuthToken --cwd cloud)

# Test chat completions
curl https://ollama-api.goldfish.io/v1/chat/completions \
  -H "cf-aig-authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.3:70b",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'

# Test models list
curl https://ollama-api.goldfish.io/api/tags \
  -H "cf-aig-authorization: Bearer ${TOKEN}"
```

## Security

- ✅ Bearer token authentication (AI Gateway pattern)
- ✅ Secrets encrypted at rest in Cloudflare
- ✅ CORS headers for browser clients
- ✅ No public access to tunnel endpoint
- ✅ Request logging via Workers analytics

## Monitoring

View Worker analytics in Cloudflare dashboard:
- Requests/minute
- Error rate
- P50/P95/P99 latency
- Geography distribution

## OpenAI SDK Compatibility

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://ollama-api.goldfish.io/v1',
  apiKey: process.env.AIG_AUTH_TOKEN, // Store token securely
  defaultHeaders: {
    'cf-aig-authorization': `Bearer ${process.env.AIG_AUTH_TOKEN}`
  }
});

const completion = await client.chat.completions.create({
  model: 'llama3.3:70b',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```
