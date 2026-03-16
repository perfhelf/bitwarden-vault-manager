import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['argon2-browser'],
  },
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
