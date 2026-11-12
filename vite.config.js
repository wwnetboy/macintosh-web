import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built site can be dropped into any subfolder / GitHub Pages.
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900
  }
})
