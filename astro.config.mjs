import { defineConfig, envField } from 'astro/config';

import vercel from '@astrojs/vercel';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  // Every public page is still prerendered. The adapter only adds functions
  // for the routes that opt out (`export const prerender = false`): the
  // private Film Lab under /photography/lab and its auth API.
  adapter: vercel(),
  // Old photography links (/photography/film, /photography/<shoot>) redirect
  // from prerendered pages: src/pages/photography/[legacy].astro.
  // Film Lab secrets. All optional so the public site still builds without
  // them; the lab itself refuses to run until they're set (src/lib/lab/server).
  env: {
    schema: {
      TURSO_DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURSO_AUTH_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      BETTER_AUTH_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      BETTER_AUTH_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      FILM_LAB_SETUP_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Vercel deploy hook the lab's "Publish to portfolio" button calls.
      VERCEL_DEPLOY_HOOK_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // The sky worker is a module worker that code-splits (the observatory's
    // star catalogue loads on demand), which the default iife format can't.
    worker: { format: 'es' },
  },
});
