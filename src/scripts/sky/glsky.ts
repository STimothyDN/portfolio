/**
 * The observatory's night sky on the GPU (WebGL2), on its own canvas under
 * the 2D one (which keeps the Moon, planets, meteors and daytime sky).
 *
 * Stars: the Bright Star Catalogue plus a few tens of thousands of fainter
 * background stars crowded toward the galactic plane — the Milky Way
 * resolves into stars. Each is one instanced quad. Their equatorial unit
 * vectors are uploaded once; every frame the vertex shader turns the sky
 * (one 3×3 matrix: sidereal time × latitude × view), projects
 * stereographically to match realsky.ts pixel for pixel, and applies the
 * twinkle, the pointer's gravity-well lens and the scroll-warp streak. The
 * CPU does no per-star work at all.
 *
 * Milky Way: a texture in galactic coordinates (banded, cloudy, with a
 * dark rift through Cygnus–Aquila), generated once on the GPU, then sampled
 * per pixel through the inverse projection.
 */
import catalog from './bright-stars.json';
import { DEG, julian, lstHours } from './astro';
import type { SkyCanvas } from './surface';

/** J2000 equatorial → galactic rotation (rows: toward the centre, l = 90°, north galactic pole). */
const GALACTIC = [
	[-0.0548755604, -0.8734370902, -0.4838350155],
	[0.4941094279, -0.44482963, 0.7469822445],
	[-0.867666149, -0.1980763734, 0.4559837762],
];

const LENS_RADIUS = 180;
const LENS_PUSH = 34;
const MILKY_WAY_W = 1024;
const MILKY_WAY_H = 256;
/** Half-height of the Milky Way texture in galactic latitude (radians). */
const MILKY_WAY_B = 0.6;

type Mat3 = number[][];
const mul = (a: Mat3, b: Mat3): Mat3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
/** GLSL wants column-major. */
const columnMajor = (m: Mat3) => new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);

export type GLView = { r: number[]; u: number[]; f: number[]; K: number };
export type GLFrame = {
	view: GLView;
	width: number;
	height: number;
	time: number;
	lens: { x: number; y: number; amount: number };
	warp: number;
};

const STAR_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aDir;
layout(location = 2) in float aMag;
layout(location = 3) in vec3 aColor;
layout(location = 4) in vec2 aTwinkle;
uniform mat3 uEqToView;
uniform vec3 uUpView;
uniform vec2 uViewport;
uniform float uK;
uniform float uTime;
uniform vec3 uLens;
uniform float uWarp;
uniform float uLimitMag;
out vec2 vUv;
out vec3 vColor;
out float vAlpha;

void main() {
	vec3 v = uEqToView * aDir;
	float up = dot(v, uUpView);
	if (aMag > uLimitMag || up < -0.01 || v.z < -0.5) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec2 s = uK * v.xy / (1.0 + v.z);
	vec2 p = uViewport * 0.5 + vec2(s.x, -s.y);

	float alpha = aMag < 1.0 ? 1.0 : max(0.06, 1.0 - (aMag - 1.0) / 8.5);
	if (uLens.z > 0.01) {
		vec2 d = p - uLens.xy;
		float dist = length(d);
		if (dist < ${LENS_RADIUS.toFixed(1)} && dist > 0.001) {
			float f = 1.0 - dist / ${LENS_RADIUS.toFixed(1)};
			p += d / dist * ${LENS_PUSH.toFixed(1)} * f * f * uLens.z;
			alpha = min(1.0, alpha * (1.0 + 0.8 * f * uLens.z));
		}
	}

	float scintillation = 0.1 + 0.3 * (1.0 - up);
	alpha *= 1.0 - scintillation * (0.5 + 0.5 * sin(aTwinkle.x + uTime * aTwinkle.y));
	alpha *= smoothstep(-0.01, 0.2, up);

	float bright = clamp((7.0 - aMag) / 8.5, 0.0, 1.0);
	float radius = 1.5 + 5.5 * pow(bright, 1.6);
	float depth = clamp(1.0 - aMag / 7.0, 0.0, 1.0);
	float streak = min(70.0, abs(uWarp) * 0.014 * (0.15 + depth));
	alpha *= 1.0 - min(0.6, streak / 120.0);
	// Scrolling down moves the sky up: the trail hangs below the star.
	vec2 centre = p + vec2(0.0, sign(uWarp) * streak * 0.5);
	vec2 pos = centre + aCorner * vec2(radius, radius + streak * 0.5);

	vUv = aCorner;
	vColor = aColor;
	vAlpha = alpha;
	gl_Position = vec4(pos.x / uViewport.x * 2.0 - 1.0, 1.0 - pos.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const STAR_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
	float d2 = dot(vUv, vUv);
	if (d2 > 1.0) discard;
	// A broad core and a soft halo — the 2D sprites' profile.
	float a = vAlpha * (exp(-d2 * 7.0) + 0.35 * exp(-d2 * 2.5));
	outColor = vec4(vColor * a, a);
}`;

const FULLSCREEN_VS = /* glsl */ `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
	vec2 c = corners[gl_VertexID];
	vUv = c * 0.5 + 0.5;
	gl_Position = vec4(c, 0.0, 1.0);
}`;

/** One-time pass: the Milky Way's surface brightness in galactic (l, b). */
const MILKY_GEN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
const float TAU = 6.283185307;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}
float fbm(vec3 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
	return v;
}
float wrapped(float a) { return atan(sin(a), cos(a)); }

void main() {
	float l = vUv.x * TAU;
	float b = (vUv.y - 0.5) * 2.0 * ${MILKY_WAY_B.toFixed(3)};
	vec3 dir = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
	float toCentre = pow(max(cos(l), 0.0), 1.5);
	// Thicker toward the bulge.
	float sigma = 0.1 + 0.11 * pow(max(cos(l), 0.0), 3.0);
	float band = exp(-(b * b) / (sigma * sigma));
	float cygnus = exp(-pow(wrapped(l - 1.361) / 0.384, 2.0));
	float along = 0.35 + 0.65 * toCentre + 0.35 * cygnus;
	float clouds = 0.35 + 1.25 * fbm(dir * 3.2);
	// The Great Rift: a dusty lane just north of the plane, Cygnus to the centre.
	float riftSpan = smoothstep(-0.35, -0.1, wrapped(l)) * (1.0 - smoothstep(1.35, 1.6, wrapped(l)));
	float rift = exp(-pow((b - 0.035) / 0.035, 2.0)) * riftSpan * smoothstep(0.35, 0.65, fbm(dir * 7.0 + 3.7));
	// Stored at 0.45× so the bright core fits 8-bit; the sky pass scales back up.
	float bright = band * along * clouds * (1.0 - 0.75 * rift) * 0.45;
	vec3 colour = mix(vec3(0.72, 0.78, 1.0), vec3(1.0, 0.88, 0.74), toCentre * band);
	outColor = vec4(colour * bright, 1.0);
}`;

/** Per frame: each pixel back through the projection into galactic (l, b). */
const MILKY_SKY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform mat3 uViewToGal;
uniform vec3 uUpView;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uK;
uniform float uIntensity;
uniform sampler2D uMilky;
out vec4 outColor;
const float TAU = 6.283185307;
void main() {
	vec2 s = (gl_FragCoord.xy / uDpr - uViewport * 0.5) / uK;
	float ss = dot(s, s);
	vec3 v = vec3(2.0 * s, 1.0 - ss) / (1.0 + ss);
	float up = dot(v, uUpView);
	if (up < -0.02) discard;
	vec3 g = uViewToGal * v;
	float b = asin(clamp(g.z, -1.0, 1.0));
	if (abs(b) > ${MILKY_WAY_B.toFixed(3)}) discard;
	float l = atan(g.y, g.x);
	vec2 uv = vec2(l / TAU + 1.0, b / ${(2 * MILKY_WAY_B).toFixed(3)} + 0.5);
	vec3 c = texture(uMilky, uv).rgb * uIntensity * smoothstep(-0.02, 0.25, up);
	outColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
	const program = gl.createProgram()!;
	for (const [type, source] of [
		[gl.VERTEX_SHADER, vs],
		[gl.FRAGMENT_SHADER, fs],
	] as const) {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
		gl.attachShader(program, shader);
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
	return program;
}

/** Subtle B−V tints, blue-white → orange-red (matches realsky.ts), as 0–1 RGB. */
const TINTS = [
	[205, 220, 255],
	[236, 241, 255],
	[255, 251, 242],
	[255, 242, 218],
	[255, 226, 192],
	[255, 208, 178],
].map((c) => c.map((v) => v / 255));
const tintFor = (bv: number) => TINTS[bv < -0.1 ? 0 : bv < 0.25 ? 1 : bv < 0.55 ? 2 : bv < 0.9 ? 3 : bv < 1.35 ? 4 : 5];

const FLOATS_PER_STAR = 9; // dir.xyz, mag, rgb, phase, speed

/** Catalogue stars, then background stars crowded toward the galactic plane. */
function buildStars(backgroundCount: number) {
	const data = catalog.data as number[];
	const catalogCount = data.length / 4;
	const out = new Float32Array((catalogCount + backgroundCount) * FLOATS_PER_STAR);
	let seed = 1337;
	const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
	const put = (i: number, dir: number[], mag: number, tint: number[]) => {
		const o = i * FLOATS_PER_STAR;
		out.set([dir[0], dir[1], dir[2], mag, tint[0], tint[1], tint[2], rand() * Math.PI * 2, 0.6 + rand() * 1.6], o);
	};

	for (let i = 0; i < catalogCount; i++) {
		const ra = (data[i * 4] / 100) * DEG;
		const dec = (data[i * 4 + 1] / 100) * DEG;
		put(i, [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], data[i * 4 + 2] / 10, tintFor(data[i * 4 + 3] / 10));
	}

	const toEquatorial = transpose(GALACTIC);
	for (let k = 0; k < backgroundCount; k++) {
		let l: number;
		let b: number;
		if (rand() < 0.6) {
			// In the disc: thin in latitude, densest toward the centre.
			b = gauss() * 0.16;
			l = rand() < 0.4 ? gauss() * 0.7 : rand() * Math.PI * 2;
		} else {
			// Spread over the whole sphere.
			b = Math.asin(rand() * 2 - 1);
			l = rand() * Math.PI * 2;
		}
		const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
		const eq = toEquatorial.map((row) => row[0] * g[0] + row[1] * g[1] + row[2] * g[2]);
		const mag = 6.5 + 2.6 * Math.pow(rand(), 0.55);
		put(catalogCount + k, eq, mag, TINTS[1 + Math.floor(rand() * 4)]);
	}
	return { stars: out, count: catalogCount + backgroundCount };
}

export class GLSky {
	private gl: WebGL2RenderingContext;
	private starProgram: WebGLProgram;
	private skyProgram: WebGLProgram;
	private starVao: WebGLVertexArrayObject;
	private emptyVao: WebGLVertexArrayObject;
	private milky: WebGLTexture;
	private count: number;
	private uniforms: Record<string, WebGLUniformLocation | null> = {};
	private dpr = 1;
	private width = 1;
	private height = 1;
	private lost = false;
	drawn = 0;

	constructor(
		private canvas: SkyCanvas,
		private latDeg: number,
		private lonDeg: number
	) {
		const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false }) as WebGL2RenderingContext | null;
		if (!gl) throw new Error('webgl2 unavailable');
		this.gl = gl;
		canvas.addEventListener('webglcontextlost', (event) => {
			event.preventDefault();
			this.lost = true;
		});

		this.starProgram = compile(gl, STAR_VS, STAR_FS);
		this.skyProgram = compile(gl, FULLSCREEN_VS, MILKY_SKY_FS);
		for (const [program, names] of [
			[this.starProgram, ['uEqToView', 'uUpView', 'uViewport', 'uK', 'uTime', 'uLens', 'uWarp', 'uLimitMag']],
			[this.skyProgram, ['uViewToGal', 'uUpView', 'uViewport', 'uDpr', 'uK', 'uIntensity', 'uMilky']],
		] as const) {
			for (const name of names) this.uniforms[`${program === this.starProgram ? 's' : 'm'}.${name}`] = gl.getUniformLocation(program, name);
		}

		// Stars: a unit quad per instance.
		const { stars, count } = buildStars(42000);
		this.count = count;
		this.starVao = gl.createVertexArray()!;
		gl.bindVertexArray(this.starVao);
		const corners = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, corners);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const instances = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instances);
		gl.bufferData(gl.ARRAY_BUFFER, stars, gl.STATIC_DRAW);
		const stride = FLOATS_PER_STAR * 4;
		for (const [loc, size, offset] of [
			[1, 3, 0],
			[2, 1, 3],
			[3, 3, 4],
			[4, 2, 7],
		]) {
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
			gl.vertexAttribDivisor(loc, 1);
		}
		gl.bindVertexArray(null);
		this.emptyVao = gl.createVertexArray()!;

		this.milky = this.generateMilkyWay();
	}

	/** Render the Milky Way's galactic-coordinate texture once, on the GPU. */
	private generateMilkyWay() {
		const gl = this.gl;
		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MILKY_WAY_W, MILKY_WAY_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		const program = compile(gl, FULLSCREEN_VS, MILKY_GEN_FS);
		gl.viewport(0, 0, MILKY_WAY_W, MILKY_WAY_H);
		gl.useProgram(program);
		gl.bindVertexArray(this.emptyVao);
		gl.disable(gl.BLEND);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteProgram(program);
		return texture;
	}

	get ok() {
		return !this.lost;
	}

	get starCount() {
		return this.count;
	}

	resize(width: number, height: number, dpr: number) {
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		this.canvas.width = Math.ceil(width * dpr);
		this.canvas.height = Math.ceil(height * dpr);
	}

	clear() {
		if (this.lost) return;
		const gl = this.gl;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	render(frame: GLFrame) {
		if (this.lost) return;
		const gl = this.gl;
		const { view } = frame;
		this.clear();

		// Equatorial → horizon (east, north, up) for the current sidereal time.
		const lst = lstHours(julian(Date.now()), this.lonDeg) * 15 * DEG;
		const lat = this.latDeg * DEG;
		const [sl, cl, sp, cp] = [Math.sin(lst), Math.cos(lst), Math.sin(lat), Math.cos(lat)];
		const eqToHorizon: Mat3 = [
			[-sl, cl, 0],
			[-sp * cl, -sp * sl, cp],
			[cp * cl, cp * sl, sp],
		];
		const eqToView = mul([view.r, view.u, view.f], eqToHorizon);
		const upView = [view.r[2], view.u[2], view.f[2]];
		const viewToGal = mul(GALACTIC, transpose(eqToView));
		const area = frame.width * frame.height;

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);

		// Milky Way.
		gl.useProgram(this.skyProgram);
		gl.bindVertexArray(this.emptyVao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.milky);
		const m = (name: string) => this.uniforms[`m.${name}`];
		gl.uniformMatrix3fv(m('uViewToGal'), false, columnMajor(viewToGal));
		gl.uniform3fv(m('uUpView'), upView);
		gl.uniform2f(m('uViewport'), frame.width, frame.height);
		gl.uniform1f(m('uDpr'), this.dpr);
		gl.uniform1f(m('uK'), view.K);
		gl.uniform1f(m('uIntensity'), 0.32);
		gl.uniform1i(m('uMilky'), 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		// Stars.
		gl.useProgram(this.starProgram);
		gl.bindVertexArray(this.starVao);
		const s = (name: string) => this.uniforms[`s.${name}`];
		gl.uniformMatrix3fv(s('uEqToView'), false, columnMajor(eqToView));
		gl.uniform3fv(s('uUpView'), upView);
		gl.uniform2f(s('uViewport'), frame.width, frame.height);
		gl.uniform1f(s('uK'), view.K);
		gl.uniform1f(s('uTime'), frame.time);
		gl.uniform3f(s('uLens'), frame.lens.x, frame.lens.y, frame.lens.amount);
		gl.uniform1f(s('uWarp'), frame.warp);
		// Smaller screens show fewer of the faintest stars.
		gl.uniform1f(s('uLimitMag'), area >= 1.1e6 ? 9.1 : area >= 5e5 ? 8.6 : 8.2);
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
		gl.bindVertexArray(null);
		this.drawn = this.count;
	}
}
