/// <reference types="vitest" />
// Vite build and dev server configuration with PWA plugin for SunoShop
// Exports default Vite configuration with Vitest testing setup and VitePWA
// Depends on vite, @vitejs/plugin-react, vite-plugin-pwa, vitest

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false, // Using public/manifest.webmanifest directly
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
