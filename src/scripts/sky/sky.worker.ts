/**
 * The sky's drawing thread: owns the transferred OffscreenCanvas and renders
 * from the page state index.ts forwards (see renderer.ts for the messages).
 */
import { SkyRenderer, type SkyMessage } from './renderer';

const renderer = new SkyRenderer();

addEventListener('message', (event) => renderer.handle((event as MessageEvent<SkyMessage>).data));
