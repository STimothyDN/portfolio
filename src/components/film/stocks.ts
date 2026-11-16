/**
 * The film stocks shoot.dev.scan knows: who makes each, what it's called, its speed and process,
 * the formats it comes in, what its canister looks like, how its negatives (or slides) look on a
 * light table, and how to develop it at home. Every app reads this one list (the Swift and Kotlin
 * copies are generated from it), so a roll of Portra looks like Portra everywhere, and nobody has
 * to type a film in by hand.
 *
 * Canister colours were measured from makers' and retailers' product photos (body, the band the
 * name sits on, and the ink), so they're close but not Pantone. Development times are starting
 * points from makers' data sheets where noted; check the sheet that came with your chemistry.
 */
import type { NegativeProfileKey } from './negative';

export type StockProcess = 'c41' | 'bw' | 'e6' | 'ecn2';
export type StockFormat = '35mm' | '120' | '110' | '127' | 'sheet';

/** A film's canister: its body, the band its name sits on (if it has one), and the ink. */
export interface CanisterLook {
	body: string;
	band?: string;
	ink: string;
}

export interface CatalogStock {
	/** Stable key; the token the film desk and labels use (portra400). */
	id: string;
	brand: string;
	/** The name without the brand, as the maker writes it ("Portra 400"). */
	name: string;
	iso: number;
	process: StockProcess;
	/** Other processes it also takes (an AHU cine film goes in C-41 or ECN-2). */
	alsoProcess?: StockProcess[];
	formats: StockFormat[];
	can: CanisterLook;
	/** How its strips look on a light table (negative.ts). */
	negative: NegativeProfileKey;
	/** Tungsten-balanced (for indoor light), rather than daylight. */
	tungsten?: boolean;
	/** Developing it at home: specific notes, and built-in recipes (darkroom.ts) by id. */
	dev?: { note?: string; recipes?: string[] };
	/** What it is underneath, where that's known (a re-spooled cine or aerial film). */
	madeFrom?: string;
	/** Other names it goes by, to match rolls logged under them. */
	aliases?: string[];
	/** No longer made, though rolls are still about. */
	discontinued?: boolean;
}

/* ---------- canister palettes ---------- */

const ILFORD = (band = '#c81828'): CanisterLook => ({ body: '#ececea', band, ink: '#151515' });
const KODAK_GOLD = '#f2a90d';
const FUJI_GREEN = '#0b7a3c';
const CINESTILL = (band: string): CanisterLook => ({ body: '#1b1b1d', band, ink: '#f5f2ec' });

const c = (
	id: string,
	brand: string,
	name: string,
	iso: number,
	process: StockProcess,
	can: CanisterLook,
	negative: NegativeProfileKey,
	extra: Partial<CatalogStock> = {}
): CatalogStock => ({ id, brand, name, iso, process, formats: ['35mm'], can, negative, ...extra });

/** Both 35mm and 120. */
const both: Partial<CatalogStock> = { formats: ['35mm', '120'] };

export const STOCK_CATALOG: CatalogStock[] = [
	/* ---------- Kodak ---------- */
	c('portra160', 'Kodak', 'Portra 160', 160, 'c41', { body: '#e8a818', band: '#3828d8', ink: '#ffffff' }, 'portra', { ...both, formats: ['35mm', '120', 'sheet'] }),
	c('portra400', 'Kodak', 'Portra 400', 400, 'c41', { body: '#f59a0a', band: '#4838c8', ink: '#ffffff' }, 'portra', { formats: ['35mm', '120', 'sheet'] }),
	c('portra800', 'Kodak', 'Portra 800', 800, 'c41', { body: '#f5a80a', band: '#4030cc', ink: '#ffffff' }, 'portra', both),
	c('ektar100', 'Kodak', 'Ektar 100', 100, 'c41', { body: '#e89808', band: '#7c0a0a', ink: '#f8c848' }, 'ektar', { formats: ['35mm', '120', 'sheet'] }),
	c('gold200', 'Kodak', 'Gold 200', 200, 'c41', { body: KODAK_GOLD, band: '#883878', ink: '#ffffff' }, 'kodak', both),
	c('ultramax400', 'Kodak', 'UltraMax 400', 400, 'c41', { body: KODAK_GOLD, band: '#2868a8', ink: '#ffffff' }, 'kodak', { aliases: ['Ultra Max 400', 'Kodak 400 UltraMax'] }),
	c('colorplus200', 'Kodak', 'ColorPlus 200', 200, 'c41', { body: KODAK_GOLD, band: '#d83828', ink: '#ffffff' }, 'kodak', { aliases: ['Color Plus 200', 'Kodacolor Plus'] }),
	c('proimage100', 'Kodak', 'Pro Image 100', 100, 'c41', { body: '#f6b808', band: '#283838', ink: '#f6b808' }, 'kodak', { aliases: ['ProImage 100'] }),
	c('kodacolor100', 'Kodak', 'Kodacolor 100', 100, 'c41', { body: '#d89808', band: '#282818', ink: '#e8a808' }, 'kodak'),
	c('kodacolor200', 'Kodak', 'Kodacolor 200', 200, 'c41', { body: '#d88808', band: '#282818', ink: '#e8a808' }, 'kodak'),
	c('ektachromee100', 'Kodak', 'Ektachrome E100', 100, 'e6', { body: '#0844ae', band: '#f8c848', ink: '#0838a8' }, 'slide', { formats: ['35mm', '120', 'sheet'], aliases: ['E100', 'Ektachrome 100'] }),
	c('trix400', 'Kodak', 'Tri-X 400', 400, 'bw', { body: '#e8a808', band: '#c81828', ink: '#ffffff' }, 'kodakMono', {
		...both,
		aliases: ['Tri-X', '400TX', 'TX 400'],
		dev: { recipes: ['trix-d76-400', 'trix-d76h-400', 'trix-xtol-400'] },
	}),
	c('tmax100', 'Kodak', 'T-Max 100', 100, 'bw', { body: '#9a9aa8', band: '#e8a808', ink: '#1a1a1a' }, 'kodakMono', { ...both, aliases: ['TMax 100', 'TMX'] }),
	c('tmax400', 'Kodak', 'T-Max 400', 400, 'bw', { body: '#f6c444', band: '#0c0c0c', ink: '#f6c444' }, 'kodakMono', { ...both, aliases: ['TMax 400', 'TMY'] }),
	c('tmaxp3200', 'Kodak', 'T-Max P3200', 3200, 'bw', { body: '#383838', band: '#e87808', ink: '#ffffff' }, 'kodakMono', { aliases: ['TMax P3200', 'P3200', 'TMZ'] }),
	c('doublex', 'Kodak', 'Eastman Double-X 5222', 250, 'bw', { body: '#2a2a2a', band: '#d9d9d9', ink: '#141414' }, 'kodakMono', {
		aliases: ['Double-X', 'Double X', '5222'],
		madeFrom: 'Kodak Eastman Double-X 5222 motion picture film, re-spooled',
	}),
	c('ektacolorpro400', 'Kodak', 'Ektacolor Pro 400', 400, 'c41', { body: '#d9a21a', band: '#5a2a6a', ink: '#ffffff' }, 'expired', { discontinued: true }),
	c('ektacolorpro800', 'Kodak', 'Ektacolor Pro 800', 800, 'c41', { body: '#d9a21a', band: '#2a4a8a', ink: '#ffffff' }, 'expired', { discontinued: true }),
	c('vision3-50d', 'Kodak', 'Vision3 50D 5203', 50, 'ecn2', { body: '#2a2a2a', band: '#e8a808', ink: '#141414' }, 'cine', { aliases: ['Vision3 50D', '5203'] }),
	c('vision3-250d', 'Kodak', 'Vision3 250D 5207', 250, 'ecn2', { body: '#2a2a2a', band: '#e8a808', ink: '#141414' }, 'cine', { aliases: ['Vision3 250D', '5207'] }),
	c('vision3-500t', 'Kodak', 'Vision3 500T 5219', 500, 'ecn2', { body: '#2a2a2a', band: '#e8a808', ink: '#141414' }, 'cineTungsten', { tungsten: true, aliases: ['Vision3 500T', '5219'] }),

	/* ---------- Fujifilm ---------- */
	c('fuji200', 'Fujifilm', '200', 200, 'c41', { body: '#086a10', band: '#580838', ink: '#ffffff' }, 'kodak', { aliases: ['Fujicolor 200'], madeFrom: 'Made by Kodak for Fujifilm (by most accounts, Kodak Gold 200)' }),
	c('fuji400', 'Fujifilm', '400', 400, 'c41', { body: '#087818', band: '#08b858', ink: '#ffffff' }, 'kodak', { aliases: ['Fujicolor 400'], madeFrom: 'Made by Kodak for Fujifilm (by most accounts, Kodak UltraMax 400)' }),
	c('fujicolor100', 'Fujifilm', 'Fujicolor 100', 100, 'c41', { body: '#089810', band: '#d83828', ink: '#ffffff' }, 'fuji', { aliases: ['Fuji 100', 'Fujicolor Industrial 100'] }),
	c('superia400', 'Fujifilm', 'Superia X-TRA 400', 400, 'c41', { body: '#18a848', band: '#480808', ink: '#ffffff' }, 'fuji', {
		aliases: ['Superia 400', 'Superia Xtra 400', 'Superia X-Tra', 'Fujicolor Superia X-Tra 400', 'Superia'],
	}),
	c('superiapremium400', 'Fujifilm', 'Superia Premium 400', 400, 'c41', { body: '#101010', band: '#087838', ink: '#ffffff' }, 'fuji', { aliases: ['Superia Premium'] }),
	c('c200', 'Fujifilm', 'Fujicolor C200', 200, 'c41', { body: '#087838', band: '#789878', ink: '#ffffff' }, 'fuji', { aliases: ['C200'], discontinued: true }),
	c('pro400h', 'Fujifilm', 'Pro 400H', 400, 'c41', { body: '#08a848', band: '#682888', ink: '#ffffff' }, 'fuji', { ...both, discontinued: true }),
	c('velvia50', 'Fujifilm', 'Velvia 50', 50, 'e6', { body: '#d8e6ea', band: '#282898', ink: '#ffffff' }, 'slide', { formats: ['35mm', '120', 'sheet'], aliases: ['RVP 50'] }),
	c('velvia100', 'Fujifilm', 'Velvia 100', 100, 'e6', { body: '#c6cad6', band: '#181888', ink: '#ffffff' }, 'slide', { formats: ['35mm', '120', 'sheet'], aliases: ['RVP 100'] }),
	c('provia100f', 'Fujifilm', 'Provia 100F', 100, 'e6', { body: '#08c848', band: '#0808b8', ink: '#ffffff' }, 'slide', { formats: ['35mm', '120', 'sheet'], aliases: ['RDP III', 'Provia 100'] }),
	c('acros100ii', 'Fujifilm', 'Neopan 100 Acros II', 100, 'bw', { body: FUJI_GREEN, band: '#101010', ink: '#ffffff' }, 'mono', {
		...both,
		aliases: ['Acros 100', 'Acros II', 'Neopan Acros 100', 'Neopan Acros', 'Acros'],
		dev: { recipes: ['acros-d76-100', 'acros-d76h-100'], note: 'Very fine grain and almost no reciprocity failure up to two minutes.' },
	}),

	/* ---------- Ilford / Harman ---------- */
	c('hp5', 'Ilford', 'HP5 Plus', 400, 'bw', ILFORD(), 'mono', {
		formats: ['35mm', '120', 'sheet'],
		aliases: ['HP5', 'HP5 Plus 400', 'HP5+'],
		dev: { recipes: ['hp5-ddx-400', 'hp5-ddx-800', 'hp5-ddx-1600', 'hp5-ddx-3200', 'hp5-ilfosol-400'], note: 'Pushes well to 1600 and 3200.' },
	}),
	c('fp4', 'Ilford', 'FP4 Plus', 125, 'bw', ILFORD(), 'mono', { formats: ['35mm', '120', 'sheet'], aliases: ['FP4', 'FP4 Plus 125', 'FP4+'], dev: { recipes: ['fp4-ddx-125', 'fp4-id11-125'] } }),
	c('delta100', 'Ilford', 'Delta 100 Professional', 100, 'bw', ILFORD(), 'mono', { formats: ['35mm', '120', 'sheet'], aliases: ['Delta 100'], dev: { recipes: ['delta100-ddx-100'] } }),
	c('delta400', 'Ilford', 'Delta 400 Professional', 400, 'bw', ILFORD(), 'mono', {
		...both,
		aliases: ['Delta 400'],
		dev: { recipes: ['delta400-ddx-400', 'delta400-id11-400'] },
	}),
	c('delta400ce', 'Ilford', "Delta 400 Professional Collector's Edition", 400, 'bw', { body: '#1a1a1a', band: '#3a3a3a', ink: '#e8e8e8' }, 'mono', {
		aliases: ["Delta 400 Collector's Edition", 'Delta 400 Collectors Edition', 'Delta 400 CE'],
		madeFrom: 'Delta 400 coated on a clearer base with anti-halation protection; same speed and times',
		dev: { recipes: ['delta400-ddx-400', 'delta400-id11-400'] },
	}),
	c('delta3200', 'Ilford', 'Delta 3200 Professional', 3200, 'bw', ILFORD('#2a2a2a'), 'mono', { ...both, aliases: ['Delta 3200'], dev: { note: 'Nominally ISO 1000; rated 3200, it is a push. Follow the data sheet for your EI.' } }),
	c('panf50', 'Ilford', 'Pan F Plus', 50, 'bw', ILFORD(), 'mono', { ...both, aliases: ['Pan F', 'Pan F Plus 50', 'PanF+'] }),
	c('xp2', 'Ilford', 'XP2 Super', 400, 'c41', ILFORD(), 'chromogenicMono', {
		...both,
		aliases: ['XP2', 'XP2 Super 400'],
		dev: { note: 'Black and white, but developed in C-41 colour chemistry, like any colour negative.' },
	}),
	c('sfx200', 'Ilford', 'SFX 200', 200, 'bw', ILFORD(), 'mono', { ...both, aliases: ['SFX'], dev: { note: 'Extended red sensitivity: with a deep red filter it gives an infrared-like look.' } }),
	c('ortho80', 'Ilford', 'Ortho Plus', 80, 'bw', ILFORD('#2a2a2a'), 'mono', { formats: ['35mm', '120', 'sheet'], aliases: ['Ortho Plus 80', 'Ortho 80'], dev: { note: 'Orthochromatic: blind to red, so it can be developed under a red safelight.' } }),
	c('ilfocolor400', 'Ilford', 'Ilfocolor 400 Plus', 400, 'c41', { body: '#ececea', band: '#e05a1a', ink: '#151515' }, 'kodak', { aliases: ['Ilfocolor 400'] }),
	c('kentmere100', 'Kentmere', 'Pan 100', 100, 'bw', { body: '#c8c8c8', band: '#2878b8', ink: '#151515' }, 'mono', { aliases: ['Kentmere 100'] }),
	c('kentmere200', 'Kentmere', 'Pan 200', 200, 'bw', { body: '#d0d0d0', band: '#9a9a3a', ink: '#151515' }, 'mono', { aliases: ['Kentmere 200'] }),
	c('kentmere400', 'Kentmere', 'Pan 400', 400, 'bw', { body: '#c8c8c8', band: '#684898', ink: '#ffffff' }, 'mono', { aliases: ['Kentmere 400'] }),
	c('phoenix200', 'Harman', 'Phoenix 200', 200, 'c41', { body: '#e62a2a', band: '#f88868', ink: '#ffffff' }, 'color', { ...both, aliases: ['Phoenix'], dev: { note: 'Low halation protection and strong grain by design; standard C-41.' } }),
	c('phoenix2', 'Harman', 'Phoenix II 200', 200, 'c41', { body: '#2888c8', band: '#383868', ink: '#ffffff' }, 'color', { aliases: ['Phoenix II'] }),
	c('harmanred125', 'Harman', 'Red 125', 125, 'c41', { body: '#c80818', band: '#e8e8e8', ink: '#c80818' }, 'color', { aliases: ['Harman Red'], dev: { note: 'Redscale: the film is spooled base-side forward.' } }),

	/* ---------- Foma ---------- */
	c('fomapan100', 'Foma', 'Fomapan 100 Classic', 100, 'bw', { body: '#182878', band: '#d8c828', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Fomapan 100', 'Fomapan Classic 100'] }),
	c('fomapan200', 'Foma', 'Fomapan 200 Creative', 200, 'bw', { body: '#181878', band: '#d8d8d8', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Fomapan 200', 'Fomapan Creative 200'] }),
	c('fomapan400', 'Foma', 'Fomapan 400 Action', 400, 'bw', { body: '#080868', band: '#a8e808', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Fomapan 400', 'Fomapan Action 400'] }),
	c('retropan320', 'Foma', 'Retropan 320 Soft', 320, 'bw', { body: '#080868', band: '#885828', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Retropan 320'] }),

	/* ---------- Lomography ---------- */
	c('lomo100', 'Lomography', 'Color Negative 100', 100, 'c41', { body: '#c81c0c', band: '#f8f8e8', ink: '#c81c0c' }, 'color', { ...both, aliases: ['Colour Negative 100', 'Lomography 100'] }),
	c('lomo400', 'Lomography', 'Color Negative 400', 400, 'c41', { body: '#0a2a7a', band: '#d8d8d8', ink: '#ffffff' }, 'color', { formats: ['35mm', '120', '110'], aliases: ['Colour Negative 400', 'Lomography 400'] }),
	c('lomo800', 'Lomography', 'Color Negative 800', 800, 'c41', { body: '#489808', band: '#d8d8d8', ink: '#ffffff' }, 'color', { formats: ['35mm', '120'], aliases: ['Colour Negative 800', 'Lomography 800'] }),
	c('ladygrey400', 'Lomography', 'Lady Grey 400', 400, 'bw', { body: '#b8b8b8', band: '#e86808', ink: '#151515' }, 'mono', { ...both, aliases: ['Lady Grey'] }),
	c('earlgrey100', 'Lomography', 'Earl Grey 100', 100, 'bw', { body: '#141414', band: '#d86808', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Earl Grey'] }),
	c('berlinkino400', 'Lomography', 'Berlin Kino B&W 400', 400, 'bw', { body: '#f1e9d8', band: '#d9452e', ink: '#d9452e' }, 'mono', {
		...both,
		aliases: ['Berlin 400', 'Berlin Kino 400', 'Berlin Kino'],
		madeFrom: 'A cinema black-and-white emulsion (by most accounts ORWO N74 Plus)',
		dev: { note: 'Standard black-and-white chemistry; Lomography publishes times for common developers.' },
	}),
	c('potsdam100', 'Lomography', 'Potsdam Kino B&W 100', 100, 'bw', { body: '#e8e8e8', band: '#284898', ink: '#284898' }, 'mono', { ...both, aliases: ['Potsdam 100', 'Potsdam Kino'] }),
	c('lomochromepurple', 'Lomography', 'LomoChrome Purple', 400, 'c41', { body: '#6868b8', band: '#c8b878', ink: '#ffffff' }, 'color', { ...both, aliases: ['Lomochrome Purple 100-400', 'Purple'] }),
	c('lomochromemetropolis', 'Lomography', 'LomoChrome Metropolis', 400, 'c41', { body: '#d8e838', band: '#181818', ink: '#d8e838' }, 'color', { ...both, aliases: ['Metropolis', 'Metropolis 100-400'] }),
	c('lomocolor92', 'Lomography', "LomoChrome Color '92", 400, 'c41', { body: '#d8b888', band: '#282828', ink: '#ffffff' }, 'color', { ...both, aliases: ["Color '92", "Colour '92"] }),
	c('lomocolor92sunkissed', 'Lomography', "LomoChrome Color '92 Sun-kissed", 400, 'c41', { body: '#e8b878', band: '#c84828', ink: '#ffffff' }, 'color', { aliases: ["Color '92 Sun-kissed", 'Sunkissed'] }),

	/* ---------- CineStill ---------- */
	c('cinestill50d', 'CineStill', '50D', 50, 'c41', CINESTILL('#1858d8'), 'cine', { ...both, madeFrom: 'Kodak Vision3 50D, rem-jet removed' }),
	c('cinestill400d', 'CineStill', '400D', 400, 'c41', CINESTILL('#6848a8'), 'cine', { ...both, madeFrom: 'A daylight cine-based emulsion, rem-jet free' }),
	c('cinestill800t', 'CineStill', '800T', 800, 'c41', CINESTILL('#d83838'), 'cineTungsten', { ...both, tungsten: true, madeFrom: 'Kodak Vision3 500T, rem-jet removed (halation around lights)' }),
	c('cinestillbwxx', 'CineStill', 'BwXX', 250, 'bw', CINESTILL('#b8b8b8'), 'kodakMono', { aliases: ['Double-X BwXX'], madeFrom: 'Kodak Eastman Double-X 5222' }),

	/* ---------- Re-spoolers and small makers ---------- */
	c('reflx640t', 'Reflx Lab', '640T', 640, 'c41', { body: '#262a52', band: '#c8463a', ink: '#f2efe8' }, 'cineTungsten', {
		alsoProcess: ['ecn2'],
		tungsten: true,
		aliases: ['640T AHU', 'Reflx Lab 640T AHU'],
		madeFrom: 'A Vision3 500T-type cine film with an anti-halation undercoat (AHU) in place of rem-jet',
		dev: { note: 'No rem-jet: develop in C-41 at ISO 640, or ECN-2 at ISO 500.' },
	}),
	c('reflx800t', 'Reflx Lab', '800T', 800, 'c41', { body: '#1c1c1c', band: '#c82828', ink: '#ffffff' }, 'cineTungsten', { tungsten: true, madeFrom: 'Kodak Vision3 500T, rem-jet removed' }),
	c('reflx320d', 'Reflx Lab', '320D', 320, 'c41', { body: '#262a52', band: '#e8b838', ink: '#f2efe8' }, 'cine', { alsoProcess: ['ecn2'], aliases: ['320D AHU'], dev: { note: 'No rem-jet: C-41 or ECN-2.' } }),
	c('santacolor100', 'SantaColor', '100', 100, 'c41', { body: '#f2f0ec', band: '#e04a3c', ink: '#e04a3c' }, 'aerial', {
		aliases: ['Santacolor 100', 'Santa Color 100'],
		madeFrom: 'Fresh Kodak aerial (air-surveillance) colour negative film, spooled in Finland',
		dev: { note: 'Standard C-41. Its base is clearer and warmer than most negatives, so it scans and prints differently; it can also be cross-processed in E-6.' },
	}),
	c('santacolor800', 'SantaColor', '800', 800, 'c41', { body: '#f2f0ec', band: '#f85848', ink: '#f85848' }, 'portra', {
		aliases: ['Santacolor 800', 'Santa Color 800'],
		dev: { note: 'Standard C-41; expose and process it as you would Portra 800.' },
	}),
	c('mrnegfragile400', 'Mr. Negative', 'Fragile 400', 400, 'c41', { body: '#c81828', band: '#f8c8d8', ink: '#c81828' }, 'color', {
		aliases: ['Fragile', 'Fragile (Film Safety Capsule) 400', 'Fragile Film Safety Capsule'],
	}),
	c('mrnegparental400', 'Mr. Negative', 'Parental Advisory 400', 400, 'bw', { body: '#1c1414', band: '#ececec', ink: '#141414' }, 'mono', {
		aliases: ['Parental Advisory', 'Parental Advisory (Film Safety Capsule) 400', 'Analogue Content 400'],
		dev: { note: 'Standard black-and-white chemistry. Shot at ISO 200 it comes out clean; at 400, slightly faded.' },
	}),
	c('samesamebutdifferent400', 'Mr. Negative', 'Same Same But Different 400', 400, 'c41', { body: '#e8c848', band: '#3a3a8a', ink: '#ffffff' }, 'color', { aliases: ['Same Same But Different! 400', 'Same Same But Different'] }),
	c('secretsauce100', 'Mr. Negative', 'Secret Sauce 100', 100, 'c41', { body: '#c83828', band: '#f8e0b8', ink: '#c83828' }, 'color', { aliases: ['Secret Sauce'] }),
	c('candido200', 'Candido', '200', 200, 'c41', { body: '#682838', band: '#b88888', ink: '#ffffff' }, 'cine', { aliases: ['Candido 200'], madeFrom: 'Re-spooled Kodak Vision3 cine film, rem-jet removed' }),
	c('candido400', 'Candido', '400', 400, 'c41', { body: '#384838', band: '#8898a8', ink: '#ffffff' }, 'cineTungsten', { tungsten: true, aliases: ['Candido 400'], madeFrom: 'Re-spooled Kodak Vision3 cine film, rem-jet removed' }),
	c('candido800', 'Candido', '800', 800, 'c41', { body: '#384888', band: '#8898c8', ink: '#ffffff' }, 'cineTungsten', { tungsten: true, aliases: ['Candido 800'], madeFrom: 'Re-spooled Kodak Vision3 500T, rem-jet removed' }),
	c('luckyc200', 'Lucky', 'C200', 200, 'c41', { body: '#e62818', band: '#e8e8e8', ink: '#e62818' }, 'lucky', { aliases: ['Lucky Color 200', 'Lucky Colour C200'] }),
	c('luckyc400', 'Lucky', 'C400', 400, 'c41', { body: '#d80808', band: '#f8e8e8', ink: '#d80808' }, 'lucky', { aliases: ['Lucky Color 400', 'Lucky Colour C400'] }),
	c('luckyshd100', 'Lucky', 'SHD 100', 100, 'bw', { body: '#586878', band: '#d8d8d8', ink: '#ffffff' }, 'mono', { ...both, aliases: ['SHD100'] }),
	c('luckyshd400', 'Lucky', 'SHD 400', 400, 'bw', { body: '#d8d8d8', band: '#585858', ink: '#151515' }, 'mono', { ...both, aliases: ['SHD400'] }),
	c('rpx25', 'Rollei', 'RPX 25', 25, 'bw', { body: '#d8d8d4', band: '#d8b808', ink: '#151515' }, 'mono', { ...both }),
	c('rpx100', 'Rollei', 'RPX 100', 100, 'bw', { body: '#d8d8d4', band: '#78a818', ink: '#151515' }, 'mono', { ...both }),
	c('rpx400', 'Rollei', 'RPX 400', 400, 'bw', { body: '#d8d8d4', band: '#b81818', ink: '#151515' }, 'mono', { ...both }),
	c('retro80s', 'Rollei', 'Retro 80S', 80, 'bw', { body: '#c8c8c8', band: '#181818', ink: '#ffffff' }, 'mono', { ...both }),
	c('retro400s', 'Rollei', 'Retro 400S', 400, 'bw', { body: '#a8b8c8', band: '#38485a', ink: '#ffffff' }, 'mono', { ...both }),
	c('superpan200', 'Rollei', 'Superpan 200', 200, 'bw', { body: '#e4e8e8', band: '#5848a8', ink: '#ffffff' }, 'mono', { ...both }),
	c('rolleiir400', 'Rollei', 'Infrared 400', 400, 'bw', { body: '#081848', band: '#a80838', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Infrared 400', 'IR 400'] }),
	c('chs100', 'Adox', 'CHS 100 II', 100, 'bw', { body: '#0c0c0c', band: '#e8e8e8', ink: '#0c0c0c' }, 'mono', { ...both, aliases: ['CHS 100', 'CHS II'] }),
	c('apx100', 'AgfaPhoto', 'APX 100', 100, 'bw', { body: '#b8b8b8', band: '#383838', ink: '#ffffff' }, 'mono', { aliases: ['Agfa APX 100'] }),
	c('apx400', 'AgfaPhoto', 'APX 400', 400, 'bw', { body: '#d8d8e8', band: '#484848', ink: '#ffffff' }, 'mono', { aliases: ['Agfa APX 400'] }),
	c('agfacolor400', 'AgfaPhoto', 'Color 400', 400, 'c41', { body: '#b80818', band: '#e8d8c8', ink: '#b80818' }, 'kodak', { aliases: ['Agfa Color 400', 'AgfaPhoto Colour 400'] }),
	c('wolfennc400', 'ORWO', 'Wolfen NC400', 400, 'c41', { body: '#f4f4ec', band: '#f83838', ink: '#1a1a1a' }, 'color', { aliases: ['NC400', 'Wolfen NC400'] }),
	c('kosmomono100', 'Kosmo Foto', 'Mono 100', 100, 'bw', { body: '#d8d0a8', band: '#585858', ink: '#ffffff' }, 'mono', { ...both, aliases: ['Kosmo Mono'] }),
	c('agentshadow400', 'Kosmo Foto', 'Agent Shadow 400', 400, 'bw', { body: '#383838', band: '#c8b8a8', ink: '#383838' }, 'mono', { aliases: ['Agent Shadow'] }),
	c('streetpan400', 'JCH', 'StreetPan 400', 400, 'bw', { body: '#0c0c0c', band: '#e8e8e8', ink: '#0c0c0c' }, 'mono', { ...both, aliases: ['StreetPan'] }),
	c('pancro400', 'Bergger', 'Pancro 400', 400, 'bw', { body: '#781818', band: '#c8c8c8', ink: '#781818' }, 'mono', { formats: ['35mm', '120', 'sheet'], aliases: ['Pancro'] }),
	c('ferraniap30', 'Ferrania', 'P30', 80, 'bw', { body: '#0c0c0c', band: '#e8e8e8', ink: '#0c0c0c' }, 'mono', { ...both, aliases: ['P30 Alpha'] }),
	c('ektapan400', 'Kodak', 'Eastman Ektapan 400', 400, 'bw', { body: '#f6b818', band: '#281828', ink: '#f6b818' }, 'kodakMono', { aliases: ['Ektapan 400'] }),
];

/* ---------- finding a film ---------- */

/** Words that don't tell films apart: "Kodak Professional Portra 400 film" is Portra 400. */
const NOISE = /\b(professional|pro film|film|35mm|135|120|iso|color negative|colour negative|b&w|black (and|&) white|negative|36 ?exp(osures)?|24 ?exp(osures)?)\b/g;
export const normalizeStockName = (s: string) =>
	s
		.toLowerCase()
		.replace(/’/g, "'")
		.replace(NOISE, ' ')
		.replace(/[^a-z0-9']+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const BRAND_ALIASES: Record<string, string> = {
	fuji: 'fujifilm',
	fujicolor: 'fujifilm',
	fujichrome: 'fujifilm',
	lomo: 'lomography',
	'mr negative': 'mr negative',
	harman: 'harman',
	agfa: 'agfaphoto',
	orwo: 'orwo',
	wolfen: 'orwo',
};

/** Every name a stock answers to, with and without its brand, normalised. */
const KEYS: { stock: CatalogStock; key: string; brandless: boolean }[] = STOCK_CATALOG.flatMap((s) => {
	const names = [s.name, ...(s.aliases ?? [])];
	const brand = normalizeStockName(s.brand);
	return names.flatMap((n) => {
		const bare = normalizeStockName(n);
		return [
			{ stock: s, key: `${brand} ${bare}`, brandless: false },
			{ stock: s, key: bare, brandless: true },
		];
	});
});

const byId = new Map(STOCK_CATALOG.map((s) => [s.id, s]));
export const stockById = (id: string | null | undefined) => (id ? byId.get(id) ?? null : null);

/** "Kodak Portra 400" */
export const catalogLabel = (s: Pick<CatalogStock, 'brand' | 'name'>) => `${s.brand} ${s.name}`;

/**
 * The catalog's film for a stock as it was logged: by its name (with or without the brand, or any
 * alias) first, since that's what a person wrote; then by its token. "Delta 400 Collector's
 * Edition" finds the collector's edition even if its token says plain delta400. Null when the film
 * isn't one the catalog knows.
 */
export function findStock(q: { token?: string | null; brand?: string | null; name?: string | null }): CatalogStock | null {
	const brand = q.brand ? normalizeStockName(BRAND_ALIASES[q.brand.toLowerCase()] ?? q.brand) : '';
	const name = normalizeStockName(q.name ?? '');
	if (name) {
		const full = brand && !name.startsWith(brand) ? `${brand} ${name}` : name;
		// Exact, with the brand; then exact without it (if the brand agrees, or none was given).
		const exact = KEYS.find((k) => !k.brandless && k.key === full) ?? KEYS.find((k) => k.brandless && k.key === name && (!brand || normalizeStockName(k.stock.brand) === brand || brandsAgree(k.stock.brand, brand)));
		if (exact) return exact.stock;
	}
	const byToken = stockById(q.token);
	if (byToken) return byToken;
	if (!name) return null;
	// The longest catalog name the logged one contains ("Kodak Portra 400 (expired)" is Portra 400).
	const full = brand && !name.startsWith(brand) ? `${brand} ${name}` : name;
	let best: CatalogStock | null = null;
	let len = 0;
	for (const k of KEYS) {
		if (k.brandless && k.key.length < 6) continue;
		if (k.key.length > len && new RegExp(`(^| )${escape(k.key)}( |$)`).test(full)) {
			best = k.stock;
			len = k.key.length;
		}
	}
	return best;
}

const brandsAgree = (catalogBrand: string, brand: string) => {
	const a = normalizeStockName(catalogBrand);
	return a === brand || a.startsWith(brand) || brand.startsWith(a) || (BRAND_ALIASES[brand] ?? brand) === a;
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the StockView columns take, from a catalog film. */
export const PROCESS_NAME: Record<StockProcess, string> = { c41: 'C-41', bw: 'B&W', e6: 'E-6', ecn2: 'ECN-2' };
export const processKey = (process: string): StockProcess | null =>
	(({ 'c-41': 'c41', c41: 'c41', 'b&w': 'bw', bw: 'bw', 'e-6': 'e6', e6: 'e6', 'ecn-2': 'ecn2', ecn2: 'ecn2' }) as Record<string, StockProcess>)[process.toLowerCase()] ?? null;

/** Brands in the catalog, in order. */
export const CATALOG_BRANDS = [...new Set(STOCK_CATALOG.map((s) => s.brand))];

/** The catalog grouped by brand (brand order as listed; films by speed, then name). */
export function catalogByBrand(list: CatalogStock[] = STOCK_CATALOG): { brand: string; stocks: CatalogStock[] }[] {
	return CATALOG_BRANDS.map((brand) => ({
		brand,
		stocks: list.filter((s) => s.brand === brand && !s.discontinued).sort((a, b) => a.iso - b.iso || (a.name < b.name ? -1 : 1)),
	})).filter((g) => g.stocks.length);
}

/** How to develop a film at home, in a line, from its process (plus its own note). */
export function devGuide(s: CatalogStock): string {
	const base: Record<StockProcess, string> = {
		c41: 'C-41: any colour negative kit (CineStill Cs41, Bellini, Tetenal) at 38–39 °C.',
		bw: 'Black and white: developer, stop, fixer at 20 °C.',
		e6: 'E-6 slide film: a three-bath kit (Bellini, CineStill Cs6, Tetenal) at 38 °C, following the kit’s times; or cross-process in C-41.',
		ecn2: 'ECN-2: remove the rem-jet backing (pre-bath and a rub-down), then develop at 41 °C; or have a cine lab do it.',
	};
	return [base[s.process], s.dev?.note].filter(Boolean).join(' ');
}
