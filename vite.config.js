import { createSelfHostedProxyUrl } from './src/proxy-url.js';
import { defineConfig } from 'vite';
import { forwardSelfHosted } from './src/proxy-response.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function installSelfHostedProxy(server) {
  server.middlewares.use(async (req, res, next) => {
    let target;
    try {
      target = createSelfHostedProxyUrl(req.url || '/');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"Invalid self-hosted URL"}');
      return;
    }
    if (!target) return next();
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : null;
      const result = await forwardSelfHosted(target, req.method, req.headers, body);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) await pipeline(Readable.fromWeb(result.body), res);
      else res.end();
    } catch (error) {
      next(error);
    }
  });
}

export default defineConfig({
  plugins: [{ name: 'bitwarden-selfhost-proxy', configureServer: installSelfHostedProxy, configurePreviewServer: installSelfHostedProxy }],
  build: {
    target: 'esnext',
  },
  server: {
    proxy: {
      '/bw-identity': {
        target: 'https://identity.bitwarden.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bw-identity/, ''),
        secure: true,
      },
      '/bw-api': {
        target: 'https://api.bitwarden.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bw-api/, ''),
        secure: true,
      },
      '/bw-eu-identity': {
        target: 'https://identity.bitwarden.eu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bw-eu-identity/, ''),
        secure: true,
      },
      '/bw-eu-api': {
        target: 'https://api.bitwarden.eu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bw-eu-api/, ''),
        secure: true,
      },
    },
  },
});
