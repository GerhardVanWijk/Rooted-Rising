import { json } from '../_shared/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

// Runs in front of every /api request.
export async function onRequest({ request, next }) {
  // Cross-site request forgery guard: anything that changes data must come from this site itself.
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if (origin !== new URL(request.url).origin || (site && site !== 'same-origin')) {
      return harden(json({ error: 'Request blocked.' }, 403));
    }
  }
  let response;
  try {
    response = await next();
  } catch (err) {
    console.error('API error', request.method, new URL(request.url).pathname, err?.stack || err);
    response = json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  }
  return harden(response);
}

function harden(response) {
  const out = new Response(response.body, response);
  const h = out.headers;
  h.set('cache-control', 'no-store');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  h.set('cross-origin-resource-policy', 'same-origin');
  h.set('referrer-policy', 'no-referrer');
  h.delete('access-control-allow-origin');
  return out;
}
