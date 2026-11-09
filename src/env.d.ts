/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_BUNNY_CDN_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace App {
	interface Locals {
		/** Film Lab: the signed-in user on /photography/lab pages (src/middleware.ts). */
		user: import('./lib/lab/server/auth').LabUser | null;
		/** Film Lab: false when the deployment is missing its env vars. */
		labConfigured: boolean;
	}
}

interface Window {
	/** Guards the theme after-swap listener against re-registration on each swap. */
	__themeObserver?: boolean;
	/** Guards the section-transition lifecycle listeners against double registration. */
	__sectionTransition?: boolean;
	/** Guards the anim-ready after-swap listener against re-registration. */
	__animReadySwap?: boolean;
	/** Tile click made before the lightbox island hydrated; consumed on mount. */
	__pendingLightbox?: { index: number; shootSlug?: string; t: number } | null;
}
