# Networking Topology (Cloudflare + K3s)

This describes how public endpoints, tunnels, and in-cluster services connect.

```mermaid
flowchart LR
  subgraph Internet
    U[Users / SMEs]
    WUI[Workers.dev / custom route]
  end

  subgraph Cloudflare
    CDN[CDN + WAF]
    TUN[Zero Trust Tunnel]
  end

  subgraph K3s Cluster (tethys)
    SvcMD[Service: md-query-proxy:80 → Pod:8080]
    SvcArg[Service: argilla:6900]
    SvcGraph[Service: postgraphile:8080]
  end

  U -->|HTTPS| CDN
  WUI --> CDN
  CDN -->|Workers upload / R2 / Queues| Wkr[Cloudflare Workers]
  Wkr -->|HTTPS| TUN
  TUN -->|HTTP :80| SvcMD
  U -->|HTTPS label.boathou.se| CDN -->|Tunnel| SvcArg
  U -->|HTTPS graph.boathou.se| CDN -->|Tunnel| SvcGraph
```

Public DNS (Cloudflare)
- k3s.boathou.se → main tunnel CNAME → kubernetes.default.svc:443
- label.boathou.se → main tunnel CNAME → argilla.apps.svc:6900
- graph.boathou.se → main tunnel CNAME → postgraphile.apps.svc:8080
- md.boathou.se → main tunnel CNAME → md-query-proxy.apps.svc:80

Security & Access
- Cloudflare Access is recommended for upload routes and Admin UIs.
- md-query-proxy should be restricted (Access or shared header); SQL is limited to pipeline needs.
- PostGraphile exposed at graph.boathou.se; rate limits and Access enforced in cloud stack.

Worker Variables (relevant)
- `MD_QUERY_PROXY_URL` → https://md.boathou.se/query
- `USE_DIRECT_UPLOAD` (OCR Worker) → true to use Space direct upload in Workers
- Secrets: `MOTHERDUCK_TOKEN`, `ARGILLA_API_KEY`, `HF_TOKEN`
