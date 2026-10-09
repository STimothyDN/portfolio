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
  },
});
