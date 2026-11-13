// Forward only headers required by the Bitwarden client. Browser cookies belong to the panel.
export function apiHeaders(incoming) {
  const source = new Headers(incoming);
  const headers = new Headers();
  for (const name of ['authorization', 'accept', 'content-type', 'bitwarden-client-name', 'bitwarden-client-version']) {
    if (source.has(name)) headers.set(name, source.get(name));
  }
  return headers;
}

export async function forwardSelfHosted(target, method, headers, body) {
  const safe = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
  const error = () => new Response('{"error":"Invalid upstream response"}', { status: 502, headers: safe });
  try {
    const upstream = await fetch(target, { method, headers: apiHeaders(headers), body, redirect: 'manual' });
    const status = upstream.status;
    const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (status >= 300 && status < 400) {
      await upstream.body?.cancel();
      return error();
    }
    if (!upstream.body || upstream.headers.get('content-length') === '0') {
      return new Response(null, { status, headers: safe });
    }
    if (mime !== 'application/json' && !/^application\/[a-z0-9.-]+\+json$/.test(mime)) {
      // Some servers send an empty 200 without a MIME type or Content-Length.
      const reader = upstream.body.getReader();
      const first = await reader.read();
      if (first.done) return new Response(null, { status, headers: safe });
      await reader.cancel();
      return error();
    }
    return new Response(upstream.body, { status, headers: safe });
  } catch {
    return error();
  }
}
