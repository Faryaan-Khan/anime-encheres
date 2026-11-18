/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// App builds (App Store, Google Play) must not contain the character pictures:
// VITE_CARD_IMAGES=off swaps the picture list for an empty one at build time.
const withoutCardImages = process.env.VITE_CARD_IMAGES === 'off';

export default defineConfig({
  plugins: [react()],
  resolve: withoutCardImages
    ? {
        alias: [
          {
            find: /^\.\/cardImages$/,
            replacement: fileURLToPath(new URL('./src/data/cardImages.none.ts', import.meta.url)),
          },
        ],
      }
    : undefined,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
