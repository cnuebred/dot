import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/frontend'),
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.FRONT_PORT),
    allowedHosts: [
      'srv08.mikr.us',
      'dot.qrware.pl',
    ],
    proxy: {
      '/r': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
      '/i': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
      '/p': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
      '/o': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
      '/favicon': {
        target: process.env.PUBLIC_ORIGIN || 'http://localhost:3250',
        changeOrigin: true,
      },
    },
  },
});
