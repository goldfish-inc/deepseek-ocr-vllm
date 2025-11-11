# Spark Upload Portal (Password/Access‑Protected)

Goal
- Provide a simple, access‑protected web page on DGX Spark for users to upload PDFs.
- Reuse the existing Cloudflare Worker `/upload` endpoint and R2 storage.

Recommended Auth
- Use Cloudflare Access (Zero Trust) on the hostname (preferred over basic password).
- Alternative: HTTP Basic Auth via NGINX (`auth_basic`) if you must use a single password.

Architecture
```
User → Cloudflare Access (upload.goldfish.io) → Cloudflare Tunnel → DGX Spark
                                       │
                                       └─ Static portal (NGINX) → POST → Worker /upload
```

Key Points
- The portal is just a static client. It never touches R2 keys.
- The Worker `/upload` continues to validate size/type and returns `{ doc_id }`.
- Ensure Worker CORS allows `Origin: https://upload.goldfish.io`.

Steps
1) Deploy static portal on DGX (Docker)
   - See `infrastructure/spark/upload-portal/` (docker‑compose, nginx.conf, index.html)
   - Run on port 8080 (tunnel target)

2) Add Cloudflare Tunnel route
   - Hostname: `upload.goldfish.io` → `http://localhost:8080`
   - Keep existing Ollama/DeepSeek routes as is

3) Protect with Access
   - Application: `upload.goldfish.io`
   - Policy: allow specific emails/groups or service tokens

4) Update Worker CORS
   - Add `upload.goldfish.io` to allowed origins in the `/upload` handler

5) Test
   - Open `https://upload.goldfish.io` → upload a PDF → receive `doc_id`
   - Confirm object in R2 and Parquet → MotherDuck loaders

Notes
- For HTTP Basic (if required), enable in `nginx.conf` (commented blocks provided) and add `.htpasswd` on DGX.
- For multi‑file/batch uploads, extend the form to accept multiple PDFs and loop `fetch` calls.
