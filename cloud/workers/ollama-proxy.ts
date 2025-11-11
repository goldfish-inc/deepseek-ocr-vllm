/**
 * Cloudflare Worker: Ollama Proxy with AI Gateway-style Authentication
 *
 * Proxies requests to DGX Spark Ollama instance via Cloudflare Tunnel.
 * Uses cf-aig-authorization header following AI Gateway best practices.
 *
 * Environment secrets (set via `pnpm exec wrangler secret put`):
 * - OLLAMA_ORIGIN: https://ollama.goldfish.io (tunnel endpoint)
 * - AIG_AUTH_TOKEN: Bearer token for authentication
 */

interface Env {
  OLLAMA_ORIGIN: string;
  AIG_AUTH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle OPTIONS preflight for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'cf-aig-authorization, Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Extract and validate cf-aig-authorization header (AI Gateway pattern)
    const authHeader = request.headers.get('cf-aig-authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing cf-aig-authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate Bearer token format
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Invalid authorization header format. Expected: Bearer <token>' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = match[1];
    if (token !== env.AIG_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: 'Invalid authentication token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse request URL and extract path
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, env.OLLAMA_ORIGIN);

    // Create proxied request (remove auth header, forward to origin)
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('cf-aig-authorization');
    proxyHeaders.set('Host', new URL(env.OLLAMA_ORIGIN).hostname);

    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'manual',
    });

    // Forward request to tunnel origin
    try {
      const response = await fetch(proxyRequest);

      // Return response with CORS headers for browser clients
      const proxyResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      proxyResponse.headers.set('Access-Control-Allow-Origin', '*');
      proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      proxyResponse.headers.set('Access-Control-Allow-Headers', 'CF-Access-Client-Id, CF-Access-Client-Secret, Content-Type');

      return proxyResponse;
    } catch (error) {
      return new Response(`Proxy error: ${error}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  },
};
