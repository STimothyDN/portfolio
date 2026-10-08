/**
 * Bunny.net Storage helpers shared by the upload scripts
 * (upload-shoot.mjs for digital shoots, upload-film.mjs for film rolls).
 */

import { access } from 'node:fs/promises';

export function storageHostFromRegion(region) {
	const trimmed = region.trim();
	if (!trimmed) return 'storage.bunnycdn.com';

	try {
		const url = new URL(trimmed);
		return url.hostname;
	} catch {
		// Accept either a full storage hostname or Bunny's short region code.
		return trimmed.includes('.') ? trimmed : `${trimmed}.storage.bunnycdn.com`;
	}
}

/** PUT one file to `<zone>/<remotePath>`, retrying once. */
export async function uploadToBunny({ zone, region, accessKey, remotePath, buffer }) {
	const host = storageHostFromRegion(region);
	// Lab scan names can contain spaces; encode each segment, keep the slashes.
	const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
	const url = `https://${host}/${zone}/${encodedPath}`;
	const filename = remotePath.split('/').pop();

	for (let attempt = 1; attempt <= 2; attempt++) {
		let res;
		try {
			res = await fetch(url, {
				method: 'PUT',
				headers: { AccessKey: accessKey, 'Content-Type': 'application/octet-stream' },
				body: buffer,
			});
		} catch (error) {
			const cause = error.cause?.message ? ` (${error.cause.message})` : '';
			throw new Error(`Upload failed for ${filename}: ${error.message}${cause}`);
		}
		if (res.ok) return;
		if (attempt === 2) {
			throw new Error(`Upload failed for ${filename}: ${res.status} ${res.statusText}`);
		}
	}
}

export function naturalSort(a, b) {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
