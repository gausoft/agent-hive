import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

// Proxy target follows the server PORT from the repo-root .env (falls back to 8080).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '..'), '');
  const http = `http://localhost:${env.PORT || 8080}`;
  const ws = `ws://localhost:${env.PORT || 8080}`;
  const p = (target: string, opts: object = {}) => ({ target, changeOrigin: true, ...opts });
  return {
    base: '/ui/',
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: 5173,
      proxy: {
        '/api': p(http),
        '/prompt': p(http),
        '/status': p(http),
        '/messages': p(http),
        '/abort': p(http),
        '/events': p(ws, { ws: true }),
        '/health': p(http),
        '/system-prompt': p(http),
      },
    },
  };
});
