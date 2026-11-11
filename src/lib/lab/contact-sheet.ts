/**
 * A roll's contact sheet, drawn on a canvas: strips of six on black paper,
 * sprocket holes and edge print, each frame's settings under it, grease-pencil
 * marks over the keepers and rejects, and the roll's details across the top.
 * One drawing serves the download (PNG) and the print. Scans come from the
 * CDN, which allows cross-origin reads, so the canvas stays exportable.
 */

export interface SheetFrame {
	/** Edge number printed on the film (00 → -1). */
	edge: number;
	src: string | null;
	/** Under the frame: "f/8 · 1/125 · 50mm". */
	line: string | null;
	note: string | null;
	/** Grease pencil: 1–5, -1 for a reject. */
	mark: number | null;
	/** EV 3 (night) to 16 (snow) as 0–1, for a frame with no scan yet. */
	lit: number | null;
}

export interface SheetData {
	code: string;
	title: string;
	stock: string;
	details: string[];
	frames: SheetFrame[];
	/** Text along the film's edge ("PORTRA 400"). */
	edgePrint: string;
}

export interface SheetOptions {
	paper: 'letter' | 'a4';
	negative: boolean;
	settings: boolean;
	marks: boolean;
}

const FONTS = {
	mono: "'Geist Mono Variable', ui-monospace, monospace",
	serif: "'Fraunces Variable', Georgia, serif",
	body: "'Newsreader Variable', Georgia, serif",
	marker: "'Permanent Marker', 'Marker Felt', cursive",
};

/** Make sure the sheet's fonts are loaded before drawing (canvas won't wait for them). */
export async function sheetFonts() {
	if (typeof document === 'undefined' || !document.fonts) return;
	await Promise.allSettled([
		document.fonts.load(`500 20px ${FONTS.mono}`),
		document.fonts.load(`400 40px ${FONTS.serif}`),
		document.fonts.load(`400 20px ${FONTS.body}`),
		document.fonts.load(`400 30px ${FONTS.marker}`),
	]);
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.decoding = 'async';
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
	});
}

const edgeText = (n: number) => (n === -1 ? '00' : String(n));

/** Draws the sheet; returns the canvas size used. Images are passed in already loaded (null where a frame has none). */
export function drawSheet(canvas: HTMLCanvasElement, data: SheetData, images: (HTMLImageElement | null)[], o: SheetOptions): { w: number; h: number } {
	// 300 dpi-ish pixels, portrait.
	const W = o.paper === 'a4' ? 2480 : 2550;
	const pad = 120;
	const perStrip = 6;
	const strips = Math.max(1, Math.ceil(data.frames.length / perStrip));
	const stripW = W - pad * 2;
	const frameGap = 14;
	const frameW = (stripW - 80 - frameGap * (perStrip - 1)) / perStrip;
	const frameH = frameW / 1.5;
	const rebate = 64;
	const stripH = frameH + rebate * 2;
	const under = o.settings ? 62 : 14;
	const headH = 330;
	const H = Math.round(headH + strips * (stripH + under + 26) + pad + 40);
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d')!;

	// Paper: black for a contact print's border.
	ctx.fillStyle = '#121110';
	ctx.fillRect(0, 0, W, H);

	// Head: the roll, in marker on the paper's edge, details in type.
	ctx.fillStyle = '#f3efe6';
	ctx.textBaseline = 'alphabetic';
	ctx.font = `400 92px ${FONTS.marker}`;
	ctx.fillText(data.code, pad, pad + 70);
	const codeW = ctx.measureText(data.code).width;
	ctx.font = `400 64px ${FONTS.serif}`;
	ctx.fillText(fit(ctx, data.title, W - pad * 2 - codeW - 60), pad + codeW + 50, pad + 68);
	ctx.font = `500 30px ${FONTS.mono}`;
	ctx.fillStyle = '#c9c2b4';
	wrapLines(ctx, data.details.join('  ·  '), W - pad * 2).forEach((line, i) => ctx.fillText(line, pad, pad + 140 + i * 42));

	// Strips.
	data.frames.forEach((f, i) => {
		const s = Math.floor(i / perStrip);
		const k = i % perStrip;
		const y0 = headH + s * (stripH + under + 26);
		if (k === 0) {
			const count = Math.min(perStrip, data.frames.length - s * perStrip);
			const w = 40 + count * frameW + (count - 1) * frameGap + 40;
			drawStrip(ctx, pad, y0, w, stripH, rebate, o.negative);
		}
		const x = pad + 40 + k * (frameW + frameGap);
		const y = y0 + rebate;
		// Edge print above the frame.
		ctx.font = `600 22px ${FONTS.mono}`;
		ctx.fillStyle = o.negative ? '#d9a35f' : '#e2b45a';
		ctx.fillText(`${edgeText(f.edge)} ▸ ${edgeText(f.edge)}A`, x + 4, y0 + rebate - 14);
		if (k === 2) ctx.fillText(data.edgePrint, x + 4, y0 + stripH - 16);

		const img = images[i];
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, frameW, frameH);
		ctx.clip();
		if (img) {
			const r = Math.max(frameW / img.width, frameH / img.height);
			const dw = img.width * r;
			const dh = img.height * r;
			if (o.negative) ctx.filter = 'invert(1) sepia(0.55) saturate(1.6) hue-rotate(-12deg) brightness(0.95)';
			ctx.drawImage(img, x + (frameW - dw) / 2, y + (frameH - dh) / 2, dw, dh);
			ctx.filter = 'none';
		} else {
			// A latent frame: as bright as the light it was exposed for.
			const lit = f.lit ?? 0.35;
			const g = ctx.createRadialGradient(x + frameW / 2, y + frameH / 2, 10, x + frameW / 2, y + frameH / 2, frameW * 0.7);
			g.addColorStop(0, `hsl(28 55% ${18 + lit * 42}%)`);
			g.addColorStop(1, `hsl(24 50% ${8 + lit * 20}%)`);
			ctx.fillStyle = g;
			ctx.fillRect(x, y, frameW, frameH);
			if (f.line) {
				ctx.fillStyle = 'rgba(255,240,220,0.85)';
				ctx.font = `500 30px ${FONTS.mono}`;
				ctx.fillText(fit(ctx, f.line, frameW - 30), x + 16, y + frameH / 2 + 10);
			}
		}
		ctx.restore();

		// Grease pencil.
		if (o.marks && f.mark != null) {
			ctx.save();
			ctx.strokeStyle = '#ff4136';
			ctx.lineWidth = 7;
			ctx.lineCap = 'round';
			if (f.mark < 0) {
				ctx.beginPath();
				ctx.moveTo(x + 18, y + 18);
				ctx.lineTo(x + frameW - 18, y + frameH - 18);
				ctx.moveTo(x + frameW - 18, y + 18);
				ctx.lineTo(x + 18, y + frameH - 18);
				ctx.stroke();
			} else if (f.mark >= 4) {
				ctx.beginPath();
				ctx.ellipse(x + frameW / 2, y + frameH / 2, frameW / 2 + 6, frameH / 2 + 10, -0.03, 0.1, Math.PI * 2 + 0.25);
				ctx.stroke();
				if (f.mark === 5) {
					ctx.font = `400 46px ${FONTS.marker}`;
					ctx.fillStyle = '#ff4136';
					ctx.fillText('★', x + frameW - 44, y + 50);
				}
			}
			ctx.restore();
		}

		// Settings under the strip.
		if (o.settings && f.line && img) {
			ctx.font = `500 24px ${FONTS.mono}`;
			ctx.fillStyle = '#d8d1c3';
			ctx.fillText(fit(ctx, f.line, frameW), x, y0 + stripH + 36);
		}
		if (o.settings && f.note) {
			ctx.font = `italic 400 24px ${FONTS.body}`;
			ctx.fillStyle = '#a8a091';
			ctx.fillText(fit(ctx, f.note, frameW), x, y0 + stripH + (img && f.line ? 66 : 36));
		}
	});

	ctx.font = `500 22px ${FONTS.mono}`;
	ctx.fillStyle = '#7d766a';
	ctx.fillText(`Contact sheet · Film Lab · ${new Date().toISOString().slice(0, 10)}`, pad, H - pad / 2);
	return { w: W, h: H };
}

function drawStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rebate: number, negative: boolean) {
	// The film base: orange-brown for a negative, near black for a positive print.
	ctx.fillStyle = negative ? '#3a2214' : '#050505';
	ctx.fillRect(x, y, w, h);
	// Sprocket holes along both edges.
	ctx.fillStyle = '#121110';
	const hole = 22;
	for (let hx = x + 18; hx < x + w - hole; hx += 44) {
		ctx.beginPath();
		ctx.roundRect(hx, y + 12, hole, 16, 3);
		ctx.roundRect(hx, y + h - 28, hole, 16, 3);
		ctx.fill();
	}
	void rebate;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
	if (ctx.measureText(text).width <= max) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
	return `${t}…`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (ctx.measureText(next).width > max && line) {
			lines.push(line);
			line = w;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines.slice(0, 3);
}
