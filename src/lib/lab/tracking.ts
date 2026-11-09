/**
 * Tracking numbers: which carrier a number belongs to (from its shape) and
 * where to follow it, plus words for 17TRACK's statuses. Works with no
 * tracking service set up; live status is an extra (server/tracking.ts).
 */

export interface Carrier {
	name: string;
	url: string;
}

const enc = encodeURIComponent;

/** The carrier a number most likely belongs to, by its shape. Unknown ones go to 17TRACK's universal page. */
export function carrierOf(number: string): Carrier {
	const n = number.replace(/[\s-]+/g, '').toUpperCase();
	if (/^1Z[0-9A-Z]{16}$/.test(n)) return { name: 'UPS', url: `https://www.ups.com/track?tracknum=${enc(n)}` };
	// USPS: domestic barcodes start 9x and run 20–22 digits (or 26–34 with routing); international "EA123456789US".
	if (/^9[2-5]\d{18,20}$/.test(n) || /^(420\d{5})?9[2-5]\d{18,20}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n) || /^(82|83|70|23|03)\d{18}$/.test(n)) {
		return { name: 'USPS', url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(n)}` };
	}
	// FedEx: 12 or 15 digits, or Ground's 96 + 20.
	if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^96\d{20}$/.test(n)) return { name: 'FedEx', url: `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}` };
	if (/^\d{10}$/.test(n)) return { name: 'DHL', url: `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc(n)}` };
	return { name: 'Tracking', url: `https://t.17track.net/en#nums=${enc(n)}` };
}

/** "9400 1000 0000 0000 0000 00": easier to read back against a receipt. */
export const spaced = (number: string) => number.replace(/(.{4})(?=.)/g, '$1 ');

/** What 17TRACK's main statuses mean, in a few words. */
export const TRACK_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
	NotFound: { label: 'Not scanned yet', tone: 'info' },
	InfoReceived: { label: 'Label made', tone: 'info' },
	InTransit: { label: 'In transit', tone: 'info' },
	OutForDelivery: { label: 'Out for delivery', tone: 'info' },
	AvailableForPickup: { label: 'Waiting for pickup', tone: 'warn' },
	Delivered: { label: 'Delivered', tone: 'ok' },
	DeliveryFailure: { label: 'Delivery failed', tone: 'bad' },
	Exception: { label: 'Problem in transit', tone: 'bad' },
	Expired: { label: 'No updates for a while', tone: 'warn' },
};

/** A number's last known state, as the lab shows it. */
export interface TrackView {
	status: string | null;
	detail: string | null;
	location: string | null;
	/** Epoch ms of the latest event. */
	eventAt: number | null;
	/** Epoch ms this was last asked. */
	checkedAt: number;
}
