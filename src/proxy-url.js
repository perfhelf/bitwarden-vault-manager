const SELF_HOST_PREFIX = '/bw-selfhost';

export function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) {
    // IPv6 public unicast is checked below; single-label DNS names are local.
    if (!host.includes(':')) return true;
  }
  if (host.includes(':')) {
    // Allow global unicast IPv6 only; reject mapped IPv4 and local ranges.
    return !/^[23][0-9a-f]{3}:/.test(host);
  }
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  return false;
}

export function createSelfHostedProxyUrl(rawUrl, { publicOnly = false, allowedBases } = {}) {
  const url = new URL(rawUrl, 'http://localhost');
  if (url.pathname !== SELF_HOST_PREFIX && !url.pathname.startsWith(`${SELF_HOST_PREFIX}/`)) return null;
  const rest = url.pathname.slice(SELF_HOST_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash < 0) throw new Error('Missing self-hosted upstream path');
  const base = new URL(decodeURIComponent(rest.slice(0, slash)));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Invalid self-hosted server URL');
  }
  const path = rest.slice(slash);
  if (!/^\/(api|identity)(\/|$)/.test(path) || /[\\]/.test(decodeURIComponent(path))) {
    throw new Error('Invalid self-hosted API path');
  }
  const decoded = decodeURIComponent(path);
  if (decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid API path');
  if (publicOnly && isPrivateHostname(base.hostname)) throw new Error('Private or local self-hosted hosts are not allowed by the public proxy');
  if (allowedBases !== undefined) {
    const permitted = allowedBases.split(',').map(value => value.trim().replace(/\/+$/, '')).filter(Boolean);
    if (base.protocol !== 'https:' || !permitted.includes(base.href.replace(/\/+$/, ''))) {
      throw new Error('Self-hosted server is not enabled by the administrator');
    }
  }
  base.pathname = base.pathname.replace(/\/+$/, '').replace(/\/(api|identity)$/i, '') + path;
  base.search = url.search;
  base.hash = '';
  return base;
}

export function createOfficialProxyUrl(base, path, search) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Invalid API path');
  const target = new URL(base);
  target.pathname = path;
  target.search = search;
  return target;
}
