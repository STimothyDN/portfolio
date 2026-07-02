<template>
	<div ref="hostRef" class="globe-canvas-host" aria-hidden="true">
		<figure ref="tipRef" class="globe-tip">
			<img ref="tipImgRef" class="globe-tip__img" alt="" decoding="async" />
			<figcaption ref="tipCapRef" class="globe-tip__cap"></figcaption>
		</figure>
	</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';

type GlobePin = { lat: number; lon: number; name?: string; images: string[] };

const props = defineProps<{ pins: GlobePin[] }>();

const hostRef = ref<HTMLDivElement | null>(null);
const tipRef = ref<HTMLElement | null>(null);
const tipImgRef = ref<HTMLImageElement | null>(null);
const tipCapRef = ref<HTMLElement | null>(null);
let controller: GlobeController | null = null;

/* ---- tunables ------------------------------------------------------- */
const EARTH_R = 1;
const SPHERE_SEG = 64;
const CAM_FOV = 32; // vertical field of view (degrees)
const DEFAULT_DIST = 4.15; // camera distance for the birds-eye default view
const MIN_DIST = 1.35; // hard max-zoom cap — a state-sized cluster fills the frame here
const GENERAL_ZOOM_DIST = 2.4; // hover with no nearby pins
const NEIGHBOR_RAD = 0.62; // ~35deg: pins within this of the cursor count as "vicinity"
const FRAME_FILL = 0.72; // a cluster is framed to fill ~72% of the half-viewport
const HOVER_PX = 26; // cursor-to-pin pixel radius that counts as hovering a pin
const PIVOT_Y = -0.12; // look slightly below centre so the south pole tucks into the slit
const REV_SECONDS = 100; // museum pace: one rotation every 100s
const EARTH_ANG = (Math.PI * 2) / REV_SECONDS;
const CLOUD_FACTOR = 1.15; // clouds drift slightly faster than the surface
const SMOOTH = 5; // camera lerp responsiveness

// Half-angle (radians) from the view axis to the top of the frame, scaled by how
// much of that half we want a framed cluster to occupy.
const FRAME_HALF_ANGLE = Math.tan(((CAM_FOV / 2) * Math.PI) / 180) * FRAME_FILL;

/**
 * Distance from the cluster centre (in sphere radii) so a cluster of angular
 * radius `alpha` fills the target fraction of the frame. Tighter clusters map
 * below MIN_DIST and get clamped to the max-zoom cap by the caller.
 */
function frameDistanceForRadius(alpha: number): number {
	return alpha / FRAME_HALF_ANGLE;
}

/** lat/lon (degrees) -> unit vector on the sphere, matching an equirectangular map. */
function latLonToVec3(lat: number, lon: number, r = 1): THREE.Vector3 {
	const phi = ((90 - lat) * Math.PI) / 180;
	const theta = ((lon + 180) * Math.PI) / 180;
	return new THREE.Vector3(
		-r * Math.sin(phi) * Math.cos(theta),
		r * Math.cos(phi),
		r * Math.sin(phi) * Math.sin(theta)
	);
}

class GlobeController {
	private host: HTMLElement;
	private pins: GlobePin[];
	private reducedMotion: boolean;
	private canHover: boolean;

	private renderer!: THREE.WebGLRenderer;
	private scene!: THREE.Scene;
	private camera!: THREE.PerspectiveCamera;
	private tiltGroup!: THREE.Group; // fixed axial tilt
	private earthGroup!: THREE.Group; // spins on its polar axis
	private cloudMesh!: THREE.Mesh;
	private earthMesh!: THREE.Mesh;

	private textures: THREE.Texture[] = [];
	private disposables: { dispose: () => void }[] = [];
	private pinDirs: THREE.Vector3[] = []; // pin positions as local unit vectors
	private pinLocalPos: THREE.Vector3[] = []; // pin positions (local, lifted off surface)
	private pinImages: string[][] = []; // sample photo urls per pin

	// pin-hover tooltip
	private tipEl: HTMLElement | null;
	private tipImg: HTMLImageElement | null;
	private tipCap: HTMLElement | null;
	private activePin = -1;
	private pointerPx = new THREE.Vector2();

	private raf = 0;
	private last = 0;
	private running = false;
	private visible = true;
	private hostW = 1;
	private hostH = 1;

	// camera rig state
	private pivot = new THREE.Vector3(0, PIVOT_Y, 0);
	private defaultDir = new THREE.Vector3(0, 0.42, 1).normalize();
	private curDir = new THREE.Vector3();
	private targetDir = new THREE.Vector3();
	private curDist = DEFAULT_DIST;
	private targetDist = DEFAULT_DIST;

	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2();

	private ro: ResizeObserver | null = null;
	private io: IntersectionObserver | null = null;

	constructor(
		host: HTMLElement,
		pins: GlobePin[],
		tip: { el: HTMLElement | null; img: HTMLImageElement | null; cap: HTMLElement | null }
	) {
		this.host = host;
		this.pins = pins;
		this.tipEl = tip.el;
		this.tipImg = tip.img;
		this.tipCap = tip.cap;
		this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		this.canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
		this.curDir.copy(this.defaultDir);
		this.targetDir.copy(this.defaultDir);

		this.initRenderer();
		this.initScene();
		this.loadTextures();
		this.buildPins();
		this.placeCamera();

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(host);

		this.io = new IntersectionObserver((entries) => {
			this.visible = entries[0]?.isIntersecting ?? true;
			if (this.visible) this.start();
			else this.stop();
		});
		this.io.observe(host);

		document.addEventListener('visibilitychange', this.onVisibility);

		if (this.canHover && !this.reducedMotion) {
			host.addEventListener('pointermove', this.onPointerMove);
			host.addEventListener('pointerleave', this.onPointerLeave);
		}
	}

	private initRenderer() {
		const canvas = document.createElement('canvas');
		this.host.appendChild(canvas);
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.05;
		this.renderer = renderer;
		this.resize();
	}

	private initScene() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(32, this.aspect(), 0.1, 100);

		this.tiltGroup = new THREE.Group();
		this.tiltGroup.rotation.z = 0.41; // ~23.5deg axial lean
		this.scene.add(this.tiltGroup);

		this.earthGroup = new THREE.Group();
		this.tiltGroup.add(this.earthGroup);

		// Earth — classic three.js Phong globe (shiny oceans via specular map)
		const geo = new THREE.SphereGeometry(EARTH_R, SPHERE_SEG, SPHERE_SEG);
		this.disposables.push(geo);
		const mat = new THREE.MeshPhongMaterial({
			specular: new THREE.Color(0x2a2a2a),
			shininess: 12,
		});
		this.disposables.push(mat);
		this.earthMesh = new THREE.Mesh(geo, mat);
		this.earthGroup.add(this.earthMesh);

		// Clouds — a slightly larger translucent shell
		const cloudGeo = new THREE.SphereGeometry(EARTH_R * 1.006, SPHERE_SEG, SPHERE_SEG);
		this.disposables.push(cloudGeo);
		const cloudMat = new THREE.MeshLambertMaterial({
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
		});
		this.disposables.push(cloudMat);
		this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
		this.earthGroup.add(this.cloudMesh);

		// Atmosphere — additive fresnel rim
		this.addAtmosphere();

		// Lights
		const sun = new THREE.DirectionalLight(0xfff4e6, 1.5);
		sun.position.set(5, 2.5, 4);
		this.scene.add(sun);
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.36));
		const hemi = new THREE.HemisphereLight(0xbcd3ff, 0x3a2e1f, 0.2);
		this.scene.add(hemi);
	}

	private addAtmosphere() {
		const geo = new THREE.SphereGeometry(EARTH_R * 1.18, SPHERE_SEG, SPHERE_SEG);
		this.disposables.push(geo);
		const mat = new THREE.ShaderMaterial({
			transparent: true,
			blending: THREE.AdditiveBlending,
			side: THREE.BackSide,
			depthWrite: false,
			uniforms: {
				uColor: { value: new THREE.Color(0x6ea8ff) },
				uPower: { value: 3.2 },
				uIntensity: { value: 0.9 },
			},
			vertexShader: `
				varying vec3 vNormal;
				varying vec3 vView;
				void main() {
					vNormal = normalize(normalMatrix * normal);
					vec4 mv = modelViewMatrix * vec4(position, 1.0);
					vView = normalize(-mv.xyz);
					gl_Position = projectionMatrix * mv;
				}
			`,
			fragmentShader: `
				varying vec3 vNormal;
				varying vec3 vView;
				uniform vec3 uColor;
				uniform float uPower;
				uniform float uIntensity;
				void main() {
					float f = pow(1.0 - abs(dot(vNormal, vView)), uPower);
					gl_FragColor = vec4(uColor, f * uIntensity);
				}
			`,
		});
		this.disposables.push(mat);
		const mesh = new THREE.Mesh(geo, mat);
		this.tiltGroup.add(mesh);
	}

	private loadTextures() {
		const manager = new THREE.LoadingManager();
		manager.onLoad = () => {
			// fade the canvas in once everything is ready, hiding the texture pop
			this.host.classList.add('is-ready');
			this.renderOnce();
		};
		const loader = new THREE.TextureLoader(manager);
		const base = import.meta.env.BASE_URL.replace(/\/$/, '');

		// Desktop zooms in, so it needs the sharp 8K map; touch devices never zoom
		// (and want a lighter payload), so they get the 2K one. three.js clamps the
		// 8K down automatically on GPUs whose max texture size is smaller.
		const dayFile = this.canHover ? 'earth-day-8k.jpg' : 'earth-day-2k.jpg';
		const day = loader.load(`${base}/globe/${dayFile}`);
		day.colorSpace = THREE.SRGBColorSpace;
		day.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
		const normal = loader.load(`${base}/globe/earth-normal.jpg`);
		const specular = loader.load(`${base}/globe/earth-specular.jpg`);
		const clouds = loader.load(`${base}/globe/clouds.png`);
		clouds.colorSpace = THREE.SRGBColorSpace;

		this.textures.push(day, normal, specular, clouds);

		const earthMat = this.earthMesh.material as THREE.MeshPhongMaterial;
		earthMat.map = day;
		earthMat.normalMap = normal;
		earthMat.normalScale = new THREE.Vector2(0.85, 0.85);
		earthMat.specularMap = specular;
		earthMat.needsUpdate = true;

		const cloudMat = this.cloudMesh.material as THREE.MeshLambertMaterial;
		cloudMat.map = clouds;
		cloudMat.alphaMap = clouds;
		cloudMat.needsUpdate = true;
	}

	private buildPins() {
		const pinsGroup = new THREE.Group();
		this.earthGroup.add(pinsGroup);

		const dotGeo = new THREE.SphereGeometry(0.013, 12, 12);
		this.disposables.push(dotGeo);
		const dotMat = new THREE.MeshBasicMaterial({ color: 0xffcf70 });
		this.disposables.push(dotMat);
		const haloGeo = new THREE.SphereGeometry(0.026, 12, 12);
		this.disposables.push(haloGeo);
		const haloMat = new THREE.MeshBasicMaterial({
			color: 0xffcf70,
			transparent: true,
			opacity: 0.28,
			depthWrite: false,
		});
		this.disposables.push(haloMat);

		for (const pin of this.pins) {
			const dir = latLonToVec3(pin.lat, pin.lon, 1);
			this.pinDirs.push(dir.clone());
			const pos = dir.clone().multiplyScalar(EARTH_R * 1.008);
			this.pinLocalPos.push(pos.clone());
			this.pinImages.push(pin.images ?? []);
			const dot = new THREE.Mesh(dotGeo, dotMat);
			dot.position.copy(pos);
			pinsGroup.add(dot);
			const halo = new THREE.Mesh(haloGeo, haloMat);
			halo.position.copy(pos);
			pinsGroup.add(halo);
		}
	}

	private lookTarget = new THREE.Vector3();
	private surfTmp = new THREE.Vector3();

	private placeCamera() {
		// At rest, look at the low pivot so the south pole tucks into the slit; as we
		// zoom in, slide the look-at toward the aimed surface point so the cluster centres.
		const zoomT = THREE.MathUtils.clamp(
			(DEFAULT_DIST - this.curDist) / (DEFAULT_DIST - MIN_DIST),
			0,
			1
		);
		this.surfTmp.copy(this.curDir).multiplyScalar(EARTH_R);
		this.lookTarget.lerpVectors(this.pivot, this.surfTmp, zoomT);
		this.camera.position.copy(this.lookTarget).addScaledVector(this.curDir, this.curDist);
		this.camera.lookAt(this.lookTarget);
	}

	/* ---- pointer / hover-zoom --------------------------------------- */
	private onPointerMove = (e: PointerEvent) => {
		const rect = this.host.getBoundingClientRect();
		this.pointerPx.set(e.clientX - rect.left, e.clientY - rect.top);
		this.pointer.x = (this.pointerPx.x / rect.width) * 2 - 1;
		this.pointer.y = -(this.pointerPx.y / rect.height) * 2 + 1;
		this.selectPinAtPointer();
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObject(this.earthMesh, false);
		if (hits.length === 0) {
			this.resetTarget();
			return;
		}
		const worldPoint = hits[0].point;
		const localHit = this.earthGroup.worldToLocal(worldPoint.clone()).normalize();

		// Collect the pins in the hovered vicinity (earth's current local frame).
		const centroid = new THREE.Vector3();
		let count = 0;
		for (const dir of this.pinDirs) {
			if (Math.acos(THREE.MathUtils.clamp(localHit.dot(dir), -1, 1)) <= NEIGHBOR_RAD) {
				centroid.add(dir);
				count++;
			}
		}

		if (count === 0) {
			// nothing nearby: gently zoom toward the cursor point
			const aim = worldPoint.clone().normalize();
			this.clampElevation(aim);
			this.targetDir.copy(aim);
			this.targetDist = GENERAL_ZOOM_DIST;
			return;
		}

		// Aim at the cluster centre and pull back just enough to frame every pin in it.
		centroid.normalize();
		let radius = 0;
		for (const dir of this.pinDirs) {
			const ang = Math.acos(THREE.MathUtils.clamp(localHit.dot(dir), -1, 1));
			if (ang <= NEIGHBOR_RAD) {
				radius = Math.max(radius, Math.acos(THREE.MathUtils.clamp(centroid.dot(dir), -1, 1)));
			}
		}
		const aim = this.earthGroup.localToWorld(centroid.clone()).normalize();
		this.clampElevation(aim);
		this.targetDir.copy(aim);
		this.targetDist = THREE.MathUtils.clamp(frameDistanceForRadius(radius), MIN_DIST, DEFAULT_DIST);
	};

	private onPointerLeave = () => {
		this.pointerInside = false;
		this.setActivePin(-1);
		this.resetTarget();
	};

	private resetTarget() {
		this.targetDir.copy(this.defaultDir);
		this.targetDist = DEFAULT_DIST;
	}

	/** Keep the camera from orbiting so low it exposes the tucked-away pole. */
	private clampElevation(dir: THREE.Vector3) {
		const minY = 0.02;
		const maxY = 0.62;
		if (dir.y < minY) dir.y = minY;
		else if (dir.y > maxY) dir.y = maxY;
		dir.normalize();
	}

	/* ---- pin hover tooltip ------------------------------------------ */
	private worldTmp = new THREE.Vector3();
	private ndcTmp = new THREE.Vector3();

	/** Project a pin to host pixels; returns null if it's on the far hemisphere. */
	private pinScreen(i: number): { x: number; y: number } | null {
		this.worldTmp.copy(this.pinLocalPos[i]);
		this.earthGroup.localToWorld(this.worldTmp);
		this.ndcTmp.copy(this.worldTmp).sub(this.camera.position);
		if (this.worldTmp.dot(this.ndcTmp) >= 0) return null; // normal faces away
		this.ndcTmp.copy(this.worldTmp).project(this.camera);
		if (this.ndcTmp.z > 1) return null;
		return {
			x: ((this.ndcTmp.x + 1) / 2) * this.hostW,
			y: ((1 - this.ndcTmp.y) / 2) * this.hostH,
		};
	}

	/**
	 * Decide which pin (if any) the cursor is over. Called only on real pointer
	 * movement, so rotation/zoom never yanks the preview away from a still cursor.
	 */
	private selectPinAtPointer() {
		if (!this.canHover || !this.tipEl) return;
		let best = -1;
		let bestDist = HOVER_PX;
		for (let i = 0; i < this.pinLocalPos.length; i++) {
			const s = this.pinScreen(i);
			if (!s) continue;
			const d = Math.hypot(s.x - this.pointerPx.x, s.y - this.pointerPx.y);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		this.setActivePin(best);
	}

	private setActivePin(idx: number) {
		if (idx === this.activePin) return;
		this.activePin = idx;
		if (idx < 0 || !this.tipEl) {
			this.tipEl?.classList.remove('is-visible');
			return;
		}
		const imgs = this.pinImages[idx];
		if (imgs && imgs.length && this.tipImg) {
			this.tipImg.src = imgs[Math.floor(Math.random() * imgs.length)];
		}
		if (this.tipCap) this.tipCap.textContent = this.pins[idx]?.name ?? '';
		this.tipEl.classList.add('is-visible');
	}

	/** Keep the preview stuck above its pin as the globe turns (called each frame). */
	private followActivePin() {
		if (this.activePin < 0 || !this.tipEl) return;
		const s = this.pinScreen(this.activePin);
		if (!s) {
			this.tipEl.classList.remove('is-visible'); // pin spun to the back
			return;
		}
		this.tipEl.classList.add('is-visible');
		this.tipEl.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, calc(-100% - 16px))`;
	}

	/* ---- loop -------------------------------------------------------- */
	start() {
		if (this.running || this.reducedMotion || document.hidden) return;
		this.running = true;
		this.last = performance.now();
		this.raf = requestAnimationFrame(this.tick);
	}

	stop() {
		this.running = false;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private onVisibility = () => {
		if (document.hidden) this.stop();
		else if (this.visible) this.start();
	};

	private tick = (now: number) => {
		if (!this.running) return;
		const dt = Math.min((now - this.last) / 1000, 0.05);
		this.last = now;

		this.earthGroup.rotation.y += EARTH_ANG * dt;
		this.cloudMesh.rotation.y += EARTH_ANG * (CLOUD_FACTOR - 1) * dt;

		// frame-rate independent easing toward the camera target
		const k = 1 - Math.exp(-SMOOTH * dt);
		this.curDist += (this.targetDist - this.curDist) * k;
		this.curDir.lerp(this.targetDir, k).normalize();
		this.placeCamera();

		this.renderer.render(this.scene, this.camera);
		this.followActivePin();
		this.raf = requestAnimationFrame(this.tick);
	};

	private renderOnce() {
		this.placeCamera();
		this.renderer.render(this.scene, this.camera);
	}

	/* ---- sizing ------------------------------------------------------ */
	private aspect() {
		const { width, height } = this.host.getBoundingClientRect();
		return height > 0 ? width / height : 1;
	}

	private resize() {
		const { width, height } = this.host.getBoundingClientRect();
		if (width === 0 || height === 0) return;
		this.hostW = width;
		this.hostH = height;
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setSize(width, height, false);
		if (this.camera) {
			this.camera.aspect = width / height;
			this.camera.updateProjectionMatrix();
			if (!this.running) this.renderOnce();
		}
	}

	/* ---- teardown ---------------------------------------------------- */
	dispose() {
		this.stop();
		this.ro?.disconnect();
		this.io?.disconnect();
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.host.removeEventListener('pointermove', this.onPointerMove);
		this.host.removeEventListener('pointerleave', this.onPointerLeave);
		for (const t of this.textures) t.dispose();
		for (const d of this.disposables) d.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
	}
}

function boot() {
	if (!hostRef.value || controller) return;
	try {
		controller = new GlobeController(hostRef.value, props.pins, {
			el: tipRef.value,
			img: tipImgRef.value,
			cap: tipCapRef.value,
		});
		controller.start();
	} catch (err) {
		// A WebGL failure should never take down the rest of the page.
		console.error('[globe] initialisation failed:', err);
		controller?.dispose();
		controller = null;
	}
}

function teardown() {
	controller?.dispose();
	controller = null;
}

const onBeforeSwap = () => teardown();

onMounted(() => {
	boot();
	document.addEventListener('astro:before-swap', onBeforeSwap);
});

onBeforeUnmount(() => {
	document.removeEventListener('astro:before-swap', onBeforeSwap);
	teardown();
});
</script>

<style scoped>
.globe-canvas-host {
	position: absolute;
	inset: 0;
	z-index: 0;
	opacity: 0;
	transition: opacity 900ms ease;
}

.globe-canvas-host.is-ready {
	opacity: 1;
}

.globe-canvas-host :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
}

/* Photo preview that pops above a pin on hover */
.globe-tip {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 3;
	margin: 0;
	padding: 6px;
	width: 168px;
	background: var(--gray-999);
	border: 1px solid var(--gray-700, rgba(255, 255, 255, 0.15));
	border-radius: 8px;
	box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
	pointer-events: none;
	opacity: 0;
	visibility: hidden;
	transition: opacity 180ms ease;
	will-change: transform;
}

.globe-tip.is-visible {
	opacity: 1;
	visibility: visible;
}

.globe-tip__img {
	display: block;
	width: 100%;
	height: 108px;
	object-fit: cover;
	border-radius: 4px;
	background: var(--gray-800, #1a1a1a);
}

.globe-tip__cap {
	margin-top: 5px;
	font-size: 0.72rem;
	line-height: 1.25;
	color: var(--gray-300, #9a9a9a);
	text-align: center;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
	.globe-canvas-host {
		transition: none;
	}
}
</style>
