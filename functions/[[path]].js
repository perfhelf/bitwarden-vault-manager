import { forwardSelfHosted } from '../src/proxy-response.js';
import { createSelfHostedProxyUrl, createOfficialProxyUrl } from '../src/proxy-url.js';

const PROXY_TARGETS = [
  { prefix: '/bw-identity', target: 'https://identity.bitwarden.com' },
  { prefix: '/bw-api', target: 'https://api.bitwarden.com' },
  { prefix: '/bw-eu-identity', target: 'https://identity.bitwarden.eu' },
  { prefix: '/bw-eu-api', target: 'https://api.bitwarden.eu' },
];

function createProxyHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-proto');
  headers.delete('x-real-ip');
  return headers;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  let selfHostedUrl = null;
  try {
    selfHostedUrl = createSelfHostedProxyUrl(url, { publicOnly: true, allowedBases: context.env?.SELF_HOSTED_BASES || '' });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (selfHostedUrl) {
    return forwardSelfHosted(selfHostedUrl, context.request.method, context.request.headers, context.request.body);
  }

  const match = PROXY_TARGETS.find(({ prefix }) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));

  if (!match) {
    return context.next();
  }

  const upstreamPath = url.pathname.slice(match.prefix.length) || '/';
  let upstreamUrl;
  try {
    upstreamUrl = createOfficialProxyUrl(match.target, upstreamPath, url.search);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }

  return fetch(upstreamUrl, {
    method: context.request.method,
    headers: createProxyHeaders(context.request),
    body: context.request.body,
    redirect: 'manual',
  });
}
