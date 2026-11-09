/**
 * Browser side of Film Lab auth. Better Auth's client handles the passkey
 * ceremonies; the lab's own endpoints (plugin.ts) go through `labPost`.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
	basePath: '/api/auth',
	plugins: [passkeyClient()],
});

export async function labPost<T = { ok: true }>(path: string, body: Record<string, unknown> = {}) {
	const { data, error } = await authClient.$fetch<T>(path, { method: 'POST', body });
	if (error) throw new Error(friendlyError(error));
	return data as T;
}

type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

/** Turn Better Auth / WebAuthn errors into sentences for the page. */
export function friendlyError(error: AuthError): string {
	const code = error?.code ?? '';
	if (/CANCELLED|NotAllowed/i.test(code) || /cancel|not allowed|timed out/i.test(error?.message ?? '')) {
		return 'The passkey prompt was closed before it finished.';
	}
	if (code === 'PREVIOUSLY_REGISTERED') return 'This device already has a passkey for Film Lab.';
	if (error?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
	return error?.message || 'Something went wrong. Try again.';
}

/** A starting name for a new passkey, from the device it's made on. */
export function deviceLabel(): string {
	const ua = navigator.userAgent;
	if (/iPhone/.test(ua)) return 'iPhone';
	if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
	if (/Macintosh/.test(ua)) return 'Mac';
	if (/Android/.test(ua)) return 'Android phone';
	if (/Windows/.test(ua)) return 'Windows PC';
	return 'This device';
}

/** Where to go after signing in: a lab path from ?next=, or the lab home. */
export function nextPath(): string {
	const next = new URLSearchParams(location.search).get('next');
	return next && /^\/photography\/lab(\/|$)/.test(next) ? next : '/photography/lab/';
}
