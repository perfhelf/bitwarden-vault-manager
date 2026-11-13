import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeServerUrl } from '../src/bitwarden-api.js';
import { createSelfHostedProxyUrl, createOfficialProxyUrl, isPrivateHostname } from '../src/proxy-url.js';
import { onRequest } from '../functions/[[path]].js';
const proxyPath = base => '/bw-selfhost/' + encodeURIComponent(base);

test('server URLs retain protocol, port and base path; full-width input is normalized on submit', () => {
  assert.equal(normalizeServerUrl(' https：／／vault.example:8443/vault/ '), 'https://vault.example:8443/vault');
  assert.equal(normalizeServerUrl('vault.example'), 'https://vault.example');
  assert.throws(() => normalizeServerUrl('ftp://vault.example'));
});

test('slash shortcut ignores editable fields and login view, still focuses dashboard search', () => {
  const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function setupKeyboardShortcuts()'), source.indexOf('// FILTER TAGS'));
  let handler, prevented = false, focused = false;
  class Element { constructor(editable, content = false) { this.editable = editable; this.isContentEditable = content; } closest() { return this.editable; } }
  const search = { focus() { focused = true; } }, dashboard = { style: { display: 'block' } };
  const document = { addEventListener(type, callback) { handler = callback; }, activeElement: null };
  new Function('document', 'Element', '$', 'closeDetailDrawer', 'closeModal', code + ';setupKeyboardShortcuts();')(document, Element, s => s === '#global-search' ? search : dashboard, () => {}, () => {});
  const press = target => handler({ key: '/', target, preventDefault() { prevented = true; } });
  press(new Element(true));
  press(new Element(false, true));
  assert.equal(prevented, false);
  dashboard.style.display = 'none'; press(new Element(false)); assert.equal(prevented, false);
  dashboard.style.display = 'block'; press(new Element(false)); assert.equal(prevented, true); assert.equal(focused, true);
});

test('self-host proxy preserves subpath and query; rejects authority replacement and traversal', () => {
  const prefix = proxyPath('https://vault.example/subdir');
  assert.equal(String(createSelfHostedProxyUrl(prefix + '/api/sync?x=1', { publicOnly: true })), 'https://vault.example/subdir/api/sync?x=1');
  for (const suffix of ['//127.0.0.1/api', '/api/%2e%2e/secret', '/api/%5c%5cother.test']) {
    assert.throws(() => createSelfHostedProxyUrl(prefix + suffix, { publicOnly: true }));
  }
  assert.throws(() => createOfficialProxyUrl('https://api.bitwarden.com', '//other.test/api', ''));
  assert.equal(String(createOfficialProxyUrl('https://api.bitwarden.com', '/sync', '?a=1')), 'https://api.bitwarden.com/sync?a=1');
});

test('public proxy distinguishes DNS names from IPv6 and rejects local IP forms', () => {
  for (const host of ['fc-vault.example', 'fd.example', 'vault.example', '[2606:4700::1111]']) assert.equal(isPrivateHostname(host), false);
  for (const host of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '100.64.1.1', '[::ffff:7f00:1]', '[::1]', '[fd00::1]', 'localhost.']) assert.equal(isPrivateHostname(host), true);
  assert.throws(() => createSelfHostedProxyUrl(proxyPath('http://2130706433') + '/api/sync', { publicOnly: true }));
  assert.equal(String(createSelfHostedProxyUrl(proxyPath('http://localhost:8080/vault') + '/api/sync')), 'http://localhost:8080/vault/api/sync');
});

test('deployed handler rejects malformed routes without issuing any upstream request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('mock'); });
  for (const path of ['/bw-api//other.test/api', proxyPath('https://vault.example') + '//127.0.0.1/api']) {
    const response = await onRequest({ request: new Request('https://manager.example' + path) });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});


test('deployed self-host proxy requires the configured HTTPS base and isolates browser headers', async t => {
  const base = 'https://vault.example/team';
  const context = (target, allow = '') => ({
    request: new Request('https://manager.example' + proxyPath(target) + '/api/sync', {
      headers: { Cookie: 'panel=synthetic', Authorization: 'Bearer synthetic' },
    }),
    env: { SELF_HOSTED_BASES: allow },
  });
  let mime = 'application/json', calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(String(url), base + '/api/sync');
    assert.equal(init.headers.has('Cookie'), false);
    assert.equal(init.headers.get('Authorization'), 'Bearer synthetic');
    return new Response('{}', { headers: { 'Content-Type': mime, 'Set-Cookie': 'sample=1' } });
  });
  for (const ctx of [context(base), context(base + '/other', base), context('http://vault.example', 'http://vault.example')]) {
    assert.equal((await onRequest(ctx)).status, 400);
  }
  assert.equal(calls, 0);
  const ok = await onRequest(context(base, base));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {});
  assert.equal(ok.headers.has('Set-Cookie'), false);
  assert.equal(ok.headers.get('X-Content-Type-Options'), 'nosniff');
  mime = 'text/html';
  assert.equal((await onRequest(context(base, base))).status, 502);
});
