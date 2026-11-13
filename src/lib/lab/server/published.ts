/**
 * What the owner's logbook shares with the public film desk: per scan, the
 * frame's public details (exposure, lens, place, notes, for rolls that share
 * them); the owner's grease-pencil marks; and what's loaded now. Film Labs
 * works all of it out and sends it with the desk (GET /v1/public/desk, read
 * once per build by src/utils/film.ts); these are views of that one answer.
 */
import type { PublicExposure } from '../alignment';
import { getFilmDesk, type LoadedNow } from '../../../utils/film';

export type { LoadedNow };

const nested = <V>(o: Record<string, Record<string, V>>) => new Map(Object.entries(o).map(([k, v]) => [k, new Map(Object.entries(v))]));

/** Desk roll id → scan filename → the frame's public details. */
export type PublishedExposures = Map<string, Map<string, PublicExposure>>;

export const publishedExposures = async (_desk?: { id: string; files: string[] }[]): Promise<PublishedExposures> => nested((await getFilmDesk()).exposures);

/** Desk roll id → scan filename → the owner's grease-pencil mark (1–5, -1 a reject). */
export type PublishedMarks = Map<string, Map<string, number>>;

/** The owner's marks from the lab's contact sheets: they set each print's place in the desk's pile. */
export const publishedMarks = async (): Promise<PublishedMarks> => nested((await getFilmDesk()).marks);

/** What's in the owner's cameras, if they chose to show it on the desk. */
export const publishedLoaded = async (): Promise<LoadedNow[]> => (await getFilmDesk()).loaded;
