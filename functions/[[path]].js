const PROXY_TARGETS = [
  { prefix: '/bw-identity', target: 'https://identity.bitwarden.com' },
  { prefix: '/bw-api', target: 'https://api.bitwarden.com' },
  { prefix: '/bw-eu-identity', target: 'https://identity.bitwarden.eu' },
  { prefix: '/bw-eu-api', target: 'https://api.bitwarden.eu' },
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const match = PROXY_TARGETS.find(({ prefix }) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));

  if (!match) {
    return context.next();
  }

  const upstreamPath = url.pathname.slice(match.prefix.length) || '/';
  const upstreamUrl = new URL(upstreamPath + url.search, match.target);
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-proto');
  headers.delete('x-real-ip');

  return fetch(upstreamUrl, {
    method: context.request.method,
    headers,
    body: context.request.body,
    redirect: 'manual',
  });
}
