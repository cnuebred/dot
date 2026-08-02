import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/frontend'),
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/frontend/embed.ts'),
      name: 'DotIconEmbed',
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
  },
});
