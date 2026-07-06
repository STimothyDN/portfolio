/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_BUNNY_CDN_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	/** Guards the theme after-swap listener against re-registration on each swap. */
	__themeObserver?: boolean;
	/** Guards the section-transition lifecycle listeners against double registration. */
	__sectionTransition?: boolean;
	/** Tile click made before the lightbox island hydrated; consumed on mount. */
	__pendingLightbox?: { index: number; shootSlug?: string; t: number } | null;
}
