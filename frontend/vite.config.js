import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
