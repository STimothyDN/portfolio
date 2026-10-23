import { defineConfig } from 'astro/config';

import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [vue()],
  // Film is now the photography home; digital shoots moved under /digital.
  // Keep links shared before the move working.
  redirects: {
    '/photography/film': '/photography/',
    '/photography/[...slug]': '/photography/digital/[...slug]',
  },
  vite: {
    plugins: [tailwindcss()],
    // The sky worker is a module worker that code-splits (the observatory's
    // star catalogue loads on demand), which the default iife format can't.
    worker: { format: 'es' },
  },
});
