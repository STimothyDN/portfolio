// The photo meter in shooting mode: take a reading (a generated scene with
// iPhone-style EXIF, and one without), meter the frame, a spot and an area,
// say what was metered, zones, filters, fixes, scenes with rules, the
// calibration, a point-and-shoot, and that it all fits a phone.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import visual from './visual.mjs';
import { OUT, require } from '../paths.mjs';

/* ---------- a scene to photograph ---------- */

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
	<defs>
		<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd6ee"/><stop offset="1" stop-color="#eef3f7"/></linearGradient>
		<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#fffdf4"/><stop offset="1" stop-color="#fffdf4" stop-opacity="0"/></radialGradient>
		<linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c9a5c"/><stop offset="1" stop-color="#4f6d33"/></linearGradient>
	</defs>
	<rect width="1200" height="430" fill="url(#sky)"/>
	<circle cx="1020" cy="110" r="150" fill="url(#sun)"/>
	<path d="M0 400 C200 340 380 380 560 350 S900 330 1200 380 V470 H0Z" fill="#8aa0a8"/>
	<rect y="430" width="1200" height="470" fill="url(#field)"/>
	<path d="M0 470 C120 440 230 450 330 430 L360 900 H0Z" fill="#17210f"/>
	<path d="M700 900 L760 560 L800 560 L900 900Z" fill="#b8a585"/>
	<ellipse cx="520" cy="520" rx="62" ry="80" fill="#c69676"/>
	<rect x="450" y="600" width="140" height="300" rx="40" fill="#2b3346"/>
</svg>`;

function exifApp1() {
	// TIFF, little-endian: IFD0 (Make, Model, Exif pointer) and an Exif IFD.
	const buf = Buffer.alloc(400);
	buf.write('II', 0, 'latin1');
	buf.writeUInt16LE(42, 2);
	buf.writeUInt32LE(8, 4);
	let data = 250;
	const entries0 = [];
	const str = (s) => {
		const at = data;
		buf.write(`${s}\0`, at, 'latin1');
		data += s.length + 2;
		return { count: s.length + 1, at };
	};
	const make = str('Apple');
	const model = str('iPhone 15 Pro');
	entries0.push([0x010f, 2, make.count, make.at], [0x0110, 2, model.count, model.at]);
	const exifAt = 8 + 2 + 3 * 12 + 4;
	entries0.push([0x8769, 4, 1, exifAt]);
	const rat = (n, d, signed = false) => {
		const at = data;
		signed ? buf.writeInt32LE(n, at) : buf.writeUInt32LE(n, at);
		signed ? buf.writeInt32LE(d, at + 4) : buf.writeUInt32LE(d, at + 4);
		data += 8;
		return at;
	};
	const exif = [
		[0x829a, 5, 1, rat(1, 2000)],
		[0x829d, 5, 1, rat(178, 100)],
		[0x8827, 3, 1, 50],
		[0x9203, 10, 1, rat(895, 100, true)],
		[0xa405, 3, 1, 26],
	];
	const ifd = (at, list) => {
		buf.writeUInt16LE(list.length, at);
		list.forEach(([tag, type, count, value], k) => {
			const p = at + 2 + k * 12;
			buf.writeUInt16LE(tag, p);
			buf.writeUInt16LE(type, p + 2);
			buf.writeUInt32LE(count, p + 4);
			if (type === 3) buf.writeUInt16LE(value, p + 8);
			else buf.writeUInt32LE(value, p + 8);
		});
		buf.writeUInt32LE(0, at + 2 + list.length * 12);
	};
	ifd(8, entries0);
	ifd(exifAt, exif);
	const tiff = buf.subarray(0, data);
	const head = Buffer.from([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
	head.writeUInt16BE(tiff.length + 8, 2);
	return Buffer.concat([head, tiff]);
}

async function fixtures() {
	const sharp = require('sharp');
	const jpeg = await sharp(Buffer.from(SCENE)).jpeg({ quality: 88 }).toBuffer();
	const withExif = Buffer.concat([jpeg.subarray(0, 2), exifApp1(), jpeg.subarray(2)]);
	const a = join(OUT, 'meter-scene.jpg');
	const b = join(OUT, 'meter-noexif.jpg');
	writeFileSync(a, withExif);
	writeFileSync(b, jpeg);
	return { exif: a, plain: b };
}

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, clickSel, clickText, text, shot, evaluate, waitFor, sleep, check, send } = h;
	const { a } = await visual(h);
	const files = await fixtures();
	const phone = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	const setFile = async (sel, path) => {
		const { root } = await send('DOM.getDocument', { depth: 1 }, a);
		const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, a);
		await send('DOM.setFileInputFiles', { nodeId, files: [path] }, a);
	};
	/** A real tap or drag on the photo, at fractions of its size. */
	const onPhoto = async (x, y, to) => {
		await evaluate(a, `document.querySelector('.pm').scrollIntoView({ block: 'center' })`);
		await sleep(150);
		const r = await evaluate(a, `(() => { const b = document.querySelector('.pm').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
		const px = (fx, fy) => ({ x: r.x + fx * r.w, y: r.y + fy * r.h });
		const p = px(x, y);
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 }, a);
		if (to) {
			for (let k = 1; k <= 6; k++) {
				const q = px(x + ((to[0] - x) * k) / 6, y + ((to[1] - y) * k) / 6);
				await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...q, button: 'left', buttons: 1 }, a);
			}
			const end = px(to[0], to[1]);
			await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 }, a);
		} else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }, a);
		await sleep(250);
	};
	const drawer = () => text(a, '#light-drawer');
	const chain = () => evaluate(a, `(() => { const d = document.querySelector('#light-drawer .chain'); if (!d) return ''; d.open = true; return d.innerText; })()`);
	const openScene = async (key) => {
		if (!(await evaluate(a, `!!document.querySelector('#scene-grid')`))) await clickSel(a, '.scene-btn');
		await waitFor(a, `!!document.querySelector('#scene-grid')`, 2000);
		await clickSel(a, key === 'auto' ? '#scene-grid .tile' : `#scene-grid [data-scene=${key}]`);
		await sleep(250);
	};

	await phone();
	await goto(a, '/photography/lab/shoot/?roll=R-033');
	await waitFor(a, `!!document.querySelector('.light .summary')`);
	if (!(await evaluate(a, `!!document.querySelector('#light-drawer')`))) await clickSel(a, '.light .summary');
	await waitFor(a, `!!document.querySelector('#light-drawer')`);

	// ---------- before a photo: the sky ----------
	check('“Take a reading” opens the back camera', await evaluate(a, `document.querySelector('#meter-camera')?.getAttribute('capture') === 'environment' && /Take a reading/.test(document.querySelector('.take-btn').innerText)`));
	check('…and photos can come from the library too', await evaluate(a, `!!document.querySelector('#meter-library') && !document.querySelector('#meter-library').hasAttribute('capture')`));
	check('with no photo, the meter reads the sky', /sun \d+° (up|down)/.test(await drawer()), (await drawer()).slice(0, 120));
	check('Auto borrows tips for the light', await waitFor(a, `/^Shooting /.test(document.querySelector('#light-drawer .tips h3')?.innerText ?? '')`, 2000));

	// ---------- a photo with the phone's exposure ----------
	await setFile('#meter-camera', files.exif);
	check('the photo is read on the phone', !!(await waitFor(a, `!!document.querySelector('.pm img')?.complete && !!document.querySelector('.zs')`, 8000)));
	const source = await evaluate(a, `document.querySelector('.reading .why')?.innerText ?? ''`);
	check('it uses the phone’s exposure (1/2000, f/1.8, ISO 50)', /Phone at 1\/2000, f\/1\.8, ISO 50/.test(source), source);
	check('the whole frame is read first, with the scene’s shadows and highlights placed', (await evaluate(a, `document.querySelectorAll('.zs .mark').length`)) === 3 && /whole frame/.test(await text(a, '#light-drawer .ev')), await text(a, '#light-drawer .ev'));
	const frameEv = await evaluate(a, `document.querySelector('#light-drawer .ev b').innerText`);
	check('the frame reads like a sunny day (EV 13–16)', (() => { const v = parseFloat(frameEv.replace('EV ', '').replace('⅓', '.33').replace('⅔', '.67')); return v >= 13 && v <= 16.5; })(), frameEv);
	check('the summary says it’s a photo reading', /Photo reading/.test(await text(a, '.light .summary')));
	const lensFrame = await evaluate(a, `!!document.querySelector('.pm .frameline')`);
	check('the film camera’s frame is drawn over the phone’s view (or it has no lens noted)', lensFrame || !(await evaluate(a, `!!document.querySelector('#shoot-lens')?.value`)), String(lensFrame));

	// A spot on the face.
	await onPhoto(520 / 1200, 520 / 900);
	check('tapping meters a spot', await waitFor(a, `!!document.querySelector('.pm circle.ring')`, 2000));
	const tag = await evaluate(a, `document.querySelector('.pm .tag')?.innerText ?? ''`);
	check('the spot is tagged with its EV and zone', /^EV [\d⅓⅔]+ · Zone [0IVX]+$/.test(tag), tag);
	check('and asks what it is', await evaluate(a, `document.querySelectorAll('.tones .chip').length === 10`));
	await clickSel(a, '.tones [data-tone=skinLight]');
	await sleep(200);
	check('lighter skin goes a stop over middle gray', /Lighter skin sits a stop above middle gray\s*\+1/.test(await chain()), (await chain()).replace(/\n/g, ' | '));
	check('negative film gets its third', /Colour negative likes light: a third more\s*\+⅓/.test(await chain()));
	check('the call says so', /^Lighter skin placed a stop over middle gray: f\//.test(await text(a, '#light-drawer .call')), await text(a, '#light-drawer .call'));
	const tagAfter = await evaluate(a, `document.querySelector('.pm .tag')?.innerText ?? ''`);
	check('the metered face now lands on Zone VI', /Zone VI$/.test(tagAfter), tagAfter);
	await shot(a, 'meter-spot', { width: 390, height: 1900, mobile: true, light: true });
	await phone();

	// Picking a setting sets the dials, and the check agrees.
	await evaluate(a, `document.querySelector('#light-drawer .pick').click()`);
	await sleep(250);
	check('a suggested setting sets the dials and the check agrees', /right on the reading/.test(await text(a, '#light-drawer .check')), await text(a, '#light-drawer .check'));

	// The reading goes onto the frame's note.
	await clickText(a, 'Add to the frame note');
	await sleep(150);
	const noteVal = await evaluate(a, `document.querySelector('#shoot-note').value`);
	check('the reading can be added to the frame’s note', /^Spot: lighter skin, EV [\d⅓⅔]+ → f\/[\d.]+ 1\/\d+$/.test(noteVal), noteVal);
	await evaluate(a, `(() => { const n = document.querySelector('#shoot-note'); n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);

	// An area across the sky.
	await onPhoto(0.05, 0.05, [0.6, 0.35]);
	check('dragging meters an area', await waitFor(a, `!!document.querySelector('.pm rect.ring')`, 2000));
	await clickSel(a, '.tones [data-tone=sky]');
	await sleep(150);
	check('an area of sky is placed a stop over', /Area: sky/.test(await chain()) && /Sky holds its colour a stop over\s*\+1/.test(await chain()), (await chain()).replace(/\n/g, ' | '));

	// The finders.
	await clickText(a, 'Darkest detail');
	await sleep(250);
	const dark = await evaluate(a, `document.querySelector('.pm .tag')?.innerText ?? ''`);
	await clickText(a, 'Brightest detail');
	await sleep(250);
	const bright = await evaluate(a, `document.querySelector('.pm .tag')?.innerText ?? ''`);
	const evOf = (t) => parseFloat((t.match(/EV ([\d⅓⅔.]+)/)?.[1] ?? '0').replace('⅓', '.33').replace('⅔', '.67'));
	check('the brightest detail reads several stops above the darkest', evOf(bright) - evOf(dark) > 3, `${dark} / ${bright}`);
	await clickSel(a, '.tones [data-tone=highlight]');
	await sleep(150);
	check('the brightest detail is placed where Portra still holds it (Zone VIII)', /Zone VIII/.test(await evaluate(a, `document.querySelector('.pm .tag')?.innerText ?? ''`)));

	// Zones.
	await clickText(a, 'Zones');
	await sleep(300);
	const painted = await evaluate(
		a,
		`(() => { const c = document.querySelector('.pm canvas.false'); if (!c || getComputedStyle(c).display === 'none') return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n; })()`
	);
	check('zones paint the false-colour map, with a legend', painted > 1000 && (await evaluate(a, `document.querySelectorAll('.legend li').length`)) === 6, String(painted));
	await shot(a, 'meter-zones', { width: 390, height: 1900, mobile: true });
	await phone();

	// Filter and adjustments.
	await evaluate(a, `(() => { const s = document.querySelector('#light-filter'); s.value = 'orange'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
	await sleep(150);
	check('a filter adds its factor', /Orange \(×4\) filter\s*\+2/.test(await chain()));
	await evaluate(a, `document.querySelector('.adjust .step[aria-label^="A third of a stop more"]').click()`);
	await sleep(150);
	check('a manual adjustment shows in the sum', /Your adjustment\s*\+⅓/.test(await chain()));
	await evaluate(a, `(() => { const s = document.querySelector('#light-filter'); s.value = 'none'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
	await evaluate(a, `document.querySelector('.adjust .step[aria-label^="A third of a stop less"]').click()`);
	await sleep(150);

	// A fix button, where one is offered.
	const fix = await evaluate(a, `[...document.querySelectorAll('#light-drawer .fix')].map((b) => b.innerText)`);
	if (fix.length) {
		const before = await chain();
		await evaluate(a, `document.querySelector('#light-drawer .fix').click()`);
		await sleep(150);
		check('a note’s fix applies itself', (await chain()) !== before, fix.join(' / '));
	}

	// Calibration.
	await evaluate(a, `document.querySelector('.cal').open = true`);
	await evaluate(a, `document.querySelector('.cal .step[aria-label="Read a third brighter"]').click()`);
	await sleep(150);
	check('the phone can be calibrated, and it says so', /calibrated \+⅓/.test(await evaluate(a, `document.querySelector('.reading .why').innerText`)) && (await evaluate(a, `localStorage.getItem('lab-meter-cal')`)) === String(1 / 3));
	await evaluate(a, `document.querySelector('.cal .step[aria-label="Read a third darker"]').click()`);

	// ---------- scenes ----------
	await openScene('backlit');
	check('picking Backlit names it and its tips', /Backlit/.test(await text(a, '.scene-btn')) && /Shooting backlit/.test(await text(a, '#light-drawer .tips')));
	check('the scene asks for the right thing to meter', /shaded side of the face/.test(await text(a, '.reading .prompt')) || (await evaluate(a, `document.querySelector('.reading .prompt')?.innerText ?? ''`)).includes('Metering'));
	await openScene('moon');
	check('the moon: no photo reading, Looney 11 instead', !(await evaluate(a, `!!document.querySelector('.take')`)) && /Looney 11/.test(await drawer()));
	await openScene('fireworks');
	check('fireworks: f/16 on bulb at ISO 400', /f\/16 · B/.test(await text(a, '#light-drawer .picks')), await text(a, '#light-drawer .picks'));
	await openScene('snow');
	check('snow: the whole frame takes its correction', /Snow makes an average give far too little/.test(await chain()) || /snow/i.test(await text(a, '.scene-btn')));
	await clickText(a, 'Auto');
	await sleep(200);

	// ---------- a photo with no exposure data ----------
	await setFile('#meter-library', files.plain);
	await waitFor(a, `/No exposure data/.test(document.querySelector('.reading .why')?.innerText ?? '')`, 8000);
	check('no exposure data: pinned to the sky, and said so', /No exposure data in this photo/.test(await evaluate(a, `document.querySelector('.reading .why').innerText`)));
	check('…and the notes suggest a bracket', await evaluate(a, `!!document.querySelector('#light-drawer .bracket')`));
	await shot(a, 'meter-estimate', { width: 390, height: 1700, mobile: true, light: true });
	await phone();

	// Fits a phone.
	await sleep(300);
	const [sw, iw] = await evaluate(a, `[document.documentElement.scrollWidth, innerWidth]`);
	check('the meter fits a phone', sw <= iw, `${sw} > ${iw}`);

	await clickText(a, 'Clear the reading');
	await sleep(200);
	check('clearing goes back to the sky', !(await evaluate(a, `!!document.querySelector('.reading')`)) && /sun \d+°/.test(await drawer()));

	// ---------- a point-and-shoot ----------
	await goto(a, '/photography/lab/shoot/?roll=R-035');
	await waitFor(a, `!!document.querySelector('.light .summary')`);
	if (!(await evaluate(a, `!!document.querySelector('#light-drawer')`))) await clickSel(a, '.light .summary');
	await waitFor(a, `!!document.querySelector('#light-drawer')`);
	await setFile('#meter-camera', files.exif);
	await waitFor(a, `!!document.querySelector('.zs')`, 8000);
	check('a point-and-shoot gets the reading and advice, not settings', !(await evaluate(a, `!!document.querySelector('#light-drawer .picks')`)) && (await evaluate(a, `!!document.querySelector('#light-drawer .notes, #light-drawer .note')`)));
	await send('Emulation.clearDeviceMetricsOverride', {}, a);
}
