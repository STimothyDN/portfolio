/** Canvas plumbing shared by the sky's drawing modules (worker-safe). */

export type SkyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Sprite surfaces: OffscreenCanvas wherever it exists (always, in a worker). */
export function createSurface(width: number, height: number): SkyCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

export const context2d = (canvas: SkyCanvas) => canvas.getContext('2d') as Ctx2D | null;
