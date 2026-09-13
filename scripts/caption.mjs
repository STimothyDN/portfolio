/**
 * Shared helper for generating photo captions with a locally deployed
 * LM Studio server (OpenAI-compatible API) running google/gemma-4-12b.
 *
 * The server URL defaults to LM Studio's standard local address and can be
 * overridden with LM_STUDIO_BASE_URL in .env.
 */

import path from 'node:path';

export const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || 'google/gemma-4-12b';

// Photos are captioned from a downscaled CDN copy. This keeps the base64 image
// small enough to fit the model's context (originals are 5568px / several MB)
// and keeps gemma-4's reasoning pass short enough to leave room for the caption.
export const CAPTION_IMAGE_WIDTH = 768;

const MIME_TYPES = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
};

export function lmStudioBaseUrl() {
	return (process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234').replace(/\/+$/, '');
}

export function mimeTypeForFilename(filename) {
	return MIME_TYPES[path.extname(filename).toLowerCase()] ?? 'image/jpeg';
}

/**
 * Downloads a downscaled copy of a photo from the Bunny CDN for captioning.
 * The `width` query param triggers Bunny Optimizer resizing (falls back to the
 * full image if the Optimizer isn't enabled on the pull zone).
 *
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function fetchCaptionImage(cdnBase, shootSlug, filename) {
	const base = cdnBase.replace(/\/+$/, '');
	const url = `${base}/photography/${shootSlug}/${encodeURIComponent(filename)}?width=${CAPTION_IMAGE_WIDTH}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
	}
	return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: mimeTypeForFilename(filename) };
}

/** Returns true when the LM Studio server is reachable. */
export async function lmStudioAvailable() {
	try {
		const res = await fetch(`${lmStudioBaseUrl()}/v1/models`);
		return res.ok;
	} catch {
		return false;
	}
}

function cleanCaption(text) {
	return text
		.replace(/^caption:\s*/i, '')
		.replace(/^["'“‘]+|["'’”]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Generates a succinct caption for a photo.
 *
 * @param {Buffer} buffer - The image file contents.
 * @param {string} mimeType - e.g. "image/jpeg".
 * @param {{ context?: string }} [options] - Optional shoot context (title/location) to ground the caption.
 * @returns {Promise<string>} The generated caption.
 */
export async function generateCaption(buffer, mimeType, { context } = {}) {
	const prompt = [
		'Write one succinct caption for this photograph for a photography portfolio.',
		'One sentence, at most 15 words, plain and evocative.',
		'Do not use quotation marks, hashtags, or a "Caption:" prefix.',
		context ? `Context: ${context}` : undefined,
	]
		.filter(Boolean)
		.join(' ');

	const res = await fetch(`${lmStudioBaseUrl()}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LM_STUDIO_MODEL,
			// gemma-4 spends ~800 tokens on reasoning_content before the caption,
			// so leave generous headroom or the reply comes back empty.
			max_tokens: 2048,
			temperature: 0.4,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: prompt },
						{
							type: 'image_url',
							image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` },
						},
					],
				},
			],
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`LM Studio request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
	}

	const data = await res.json();
	const caption = cleanCaption(data.choices?.[0]?.message?.content ?? '');
	if (!caption) throw new Error('LM Studio returned an empty caption.');
	return caption;
}
