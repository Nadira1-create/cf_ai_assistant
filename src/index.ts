import { ChatAgent } from './chatAgent';
import { SummarizeWorkflow } from './summarizeWorkflow';
import { Env } from './types';

export { ChatAgent, SummarizeWorkflow };

const SESSION_COOKIE = 'memo_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    // All /api/* routes are forwarded to the user's ChatAgent Durable Object
    if (url.pathname.startsWith('/api/')) {
      const sessionId = getOrCreateSessionId(request);

      // Route to the user's personal Durable Object (one per session)
      const doId = env.CHAT_AGENT.idFromName(sessionId);
      const agent = env.CHAT_AGENT.get(doId);

      // Rewrite URL so the DO sees /chat, /history, /clear, etc.
      const doUrl = new URL(request.url);
      doUrl.pathname = url.pathname.replace('/api', '');

      const doResponse = await agent.fetch(new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' ? request.body : undefined,
      }));

      // Attach the session cookie to the response
      const response = new Response(doResponse.body, doResponse);
      response.headers.set(
        'Set-Cookie',
        `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}`
      );
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    }

    // Serve the frontend — Cloudflare Assets handles this automatically via wrangler.toml
    // This fallback is just a safety net
    return env.ASSETS.fetch(request);
  },
};

/**
 * Extract the session ID from the cookie header, or generate a new UUID.
 */
function getOrCreateSessionId(request: Request): string {
  const cookieHeader = request.headers.get('Cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;\\s]+)`));
  return match?.[1] ?? crypto.randomUUID();
}
