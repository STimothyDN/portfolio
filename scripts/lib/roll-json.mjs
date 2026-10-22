/**
 * A roll file's text: two-space JSON, but with short number lists (a scan's
 * `tone`) kept on one line instead of one number per line.
 */
export function rollJson(roll) {
	return (
		JSON.stringify(roll, null, 2).replace(/\[\n\s+([-\d.e,\s]+?)\n\s+\]/g, (_, list) => `[${list.split(/,\s+/).join(', ')}]`) +
		'\n'
	);
}
