#!/usr/bin/env node
/**
 * Film scans don't come in here any more. Film Labs owns the film desk: its
 * ingest uploads the scans to the same Bunny storage, measures them, saves the
 * roll, links it to the logbook, and rebuilds this site, which reads the desk
 * from Film Labs (src/utils/film.ts).
 */
const args = process.argv.slice(2).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
console.error(
	[
		'',
		'The film desk lives in Film Labs now. From the film-labs repository:',
		'',
		`  npm run ingest -- ${args || '<roll-folder | folder-of-rolls> [--roll R-047] [--title "Title"] [--force] [--dry-run]'}`,
		'',
		'Same folders and options as upload-film. The portfolio rebuilds by itself when it’s done.',
		'',
	].join('\n')
);
process.exit(1);
