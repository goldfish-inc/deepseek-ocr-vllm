# DGX Spark Infrastructure

DGX Spark (spark-291b) hosts the Ollama LLM inference service with Llama 3.3 70B model.

## Components

### Cloudflare Tunnel
- **Tunnel ID**: `75a07d1a-0bc7-485f-86b2-ce676d7d1c35`
- **Tunnel Name**: `dgx-spark-ollama`
- **Hostname**: `ollama.goldfish.io`
- **Service**: Ollama API at `http://localhost:11434`

### Deployment

**Prerequisites:**
- DGX Spark machine accessible via SSH
- Cloudflare tunnel token stored in Pulumi ESC
- 1Password CLI configured

**Manual Deployment:**

```bash
# 1. Get tunnel token from Pulumi ESC
TUNNEL_TOKEN=$(pulumi config get --cwd cloud dgx-spark:cloudflareTunnelToken)

# 2. Copy systemd service to Spark
scp infrastructure/spark/cloudflared.service spark-291b:/tmp/

# 3. Install and configure
ssh spark-291b << 'ENDSSH'
  # Install service
  sudo mv /tmp/cloudflared.service /etc/systemd/system/

  # Set tunnel token
  sudo mkdir -p /etc/systemd/system/cloudflared.service.d
  echo "[Service]" | sudo tee /etc/systemd/system/cloudflared.service.d/override.conf
  echo "Environment=\"CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}\"" | sudo tee -a /etc/systemd/system/cloudflared.service.d/override.conf

  # Enable and start
  sudo systemctl daemon-reload
  sudo systemctl enable cloudflared
  sudo systemctl restart cloudflared
  sudo systemctl status cloudflared
ENDSSH
```

### Verification

```bash
# Check tunnel status
ssh spark-291b 'systemctl status cloudflared'

# Check tunnel connections
ssh spark-291b 'journalctl -u cloudflared --since "5 minutes ago" | grep Registered'

# Test Ollama locally
ssh spark-291b 'curl -s http://localhost:11434/api/tags | jq ".models[0].name"'
```

### Cloudflare Access Configuration

**Current Status**: ⚠️ Access policy configured but returning 403

**Access Application:**
- **ID**: `5c17729f-c6d4-4722-8920-42f2f197c40c`
- **Domain**: `ollama.goldfish.io`
- **Policy**: Allow all (temporary for testing)

**Service Token:**
- **ID**: `f4c14d9b-611e-48bb-b696-40f4425e64e4`
- **Client ID**: `a1ad143d0d633ec38d44fd230a285fc8.access`
- **Secret**: Stored in 1Password (vault: Development, UUID: 5zmjz55o2bnv7fq6tfgpvzi3je)

**Known Issues:**
- Requests to `https://ollama.goldfish.io/api/tags` return HTTP 403
- Tunnel is connected and healthy (4 registered connections)
- DNS resolves correctly to tunnel
- Access policy appears correct but traffic not flowing
- No requests visible in tunnel logs

**Next Steps:**
1. Verify Zero Trust account-level settings in Cloudflare dashboard
2. Check for conflicting Access policies
3. Test with Cloudflare support if issue persists

### Tunnel Configuration

The tunnel configuration is managed via Cloudflare API:

```json
{
  "config": {
    "ingress": [
      {
        "hostname": "ollama.goldfish.io",
        "service": "http://localhost:11434"
      },
      {
        "service": "http_status:404"
      }
    ]
  }
}
```

### DNS Configuration

```
ollama.goldfish.io → 75a07d1a-0bc7-485f-86b2-ce676d7d1c35.cfargotunnel.com (CNAME, Proxied)
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Client (Cloudflare Worker)                              │
│ ├─ CF-Access-Client-Id: a1ad143d...                     │
│ └─ CF-Access-Client-Secret: b0a39081...                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Cloudflare Edge (ollama.goldfish.io)                    │
│ ├─ Zero Trust Access (⚠️ 403 issue)                     │
│ └─ Tunnel Routing                                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ Cloudflare Tunnel (QUIC)
                 ▼
┌─────────────────────────────────────────────────────────┐
│ DGX Spark (spark-291b)                                  │
│ ├─ cloudflared (systemd)                                │
│ │  └─ Tunnel: dgx-spark-ollama                          │
│ └─ Ollama (localhost:11434)                             │
│    └─ Model: llama3.3:70b (Q4_K_M, 40GB)                │
└─────────────────────────────────────────────────────────┘
```

## Secrets Management

**Tunnel Token:**
- Store in Pulumi ESC: `dgx-spark:cloudflareTunnelToken`
- Value: `eyJhIjoiOGZhOTc0NzQ3NzhjOGE4OTQ5MjVjMTQ4Y2E4Mjk3MzkiLCJ0IjoiNzVhMDdkMWEtMGJjNy00ODVmLTg2YjItY2U2NzZkN2QxYzM1IiwicyI6Ilp4WXcrbnBZaDBFamk1WEtKcWo4U1VQSTFmMThubHVWMXd6NG8yb2JpdE09In0=`

**Service Token Secret:**
- Store in 1Password: Development vault
- Item: "DGX Spark Ollama Tunnel Access"
- Secret: `b0a39081611c6e21bc50d5fd092e5be914f5dc17d95054e94d7b904b5269457d`

## Maintenance

### Restart Tunnel

```bash
ssh spark-291b 'sudo systemctl restart cloudflared'
```

### View Logs

```bash
ssh spark-291b 'journalctl -u cloudflared -f'
```

### Update Tunnel Configuration

Changes to tunnel routes should be made via Cloudflare API or dashboard, not locally. The tunnel will automatically pick up configuration updates from Cloudflare's edge.
