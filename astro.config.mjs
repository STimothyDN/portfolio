import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  // Every page is prerendered except one: the redirect from the Film Lab's old
  // address (src/pages/photography/lab/[...path].ts), which the adapter makes a
  // small function.
  adapter: vercel({
    webAnalytics: { enabled: true },
  }),
  // Old photography links (/photography/film, /photography/<shoot>) redirect
  // from prerendered pages: src/pages/photography/[legacy].astro.
  vite: {
    plugins: [tailwindcss()],
    // The sky worker is a module worker that code-splits (the observatory's
    // star catalogue loads on demand), which the default iife format can't.
    worker: { format: 'es' },
  },
});
