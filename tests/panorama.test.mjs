import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPanorama, normalizePanoramaView, projectPanoramaHotspot, PANORAMA_LIMITS, PANORAMA_RENDER_LIMITS } from '../src/components/panorama.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('panorama clamps zoom and pitch, wraps yaw and rejects non-finite angles', () => {
  const view = normalizePanoramaView({ yaw: Math.PI * 6 + 0.3, pitch: 10, fov: -10 });
  near(view.yaw, 0.3);
  assert.equal(view.pitch, PANORAMA_LIMITS.maxPitch);
  assert.equal(view.fov, PANORAMA_LIMITS.minFov);
  assert.equal(normalizePanoramaView({ fov: 500 }).fov, PANORAMA_LIMITS.maxFov);
  assert.deepEqual(normalizePanoramaView({ yaw: NaN, pitch: Infinity, fov: undefined }), { yaw: 0, pitch: 0.08, fov: 65 });
});

test('spherical hotspots track camera rotation and viewport aspect, hiding the back hemisphere', () => {
  const viewport = { width: 400, height: 800 };
  const camera = { yaw: 0.7, pitch: 0.2, fov: 65 };
  const center = projectPanoramaHotspot({ yaw: 0.7, pitch: 0.2 }, camera, viewport);
  assert.equal(center.visible, true);
  near(center.x, 200);
  near(center.y, 400);
  const right = projectPanoramaHotspot({ yaw: 0.9, pitch: 0.2 }, camera, viewport);
  assert.ok(right.x > center.x);
  const above = projectPanoramaHotspot({ yaw: 0.7, pitch: 0.4 }, camera, viewport);
  assert.ok(above.y < center.y);
  const behind = projectPanoramaHotspot({ yaw: 0.7 + Math.PI, pitch: -0.2 }, camera, viewport);
  assert.equal(behind.visible, false);
  assert.equal(behind.x, null);
  assert.equal(projectPanoramaHotspot({ yaw: 1.4, pitch: 0 }, { yaw: 0, pitch: 0, fov: 35 }, viewport).visible, false);
  assert.equal(projectPanoramaHotspot({ yaw: 0, pitch: 0 }, camera, { width: 0, height: 0 }).visible, false);
  assert.equal(projectPanoramaHotspot({ yaw: NaN, pitch: 0 }, camera, viewport).visible, false);
});

function fixture(t, supported = true, source = '/test-sphere.png', textureLimit = 8192) {
  const calls = [];
  const gl = new Proxy({ NO_ERROR: 0 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return (...args) => {
        calls.push({ name, args });
        if (name.startsWith('create') || name === 'getUniformLocation') return {};
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'getError' || name === 'getAttribLocation') return 0;
        if (name === 'getParameter') return textureLimit;
      };
    },
  });
  class Canvas extends EventTarget {
    style = { touchAction: 'pan-y' };
    attributes = new Map();
    captures = new Set();
    measurements = 0;
    rect = { width: 400, height: 600 };
    getContext(...args) { calls.push({ name: 'getContext', args }); return supported ? gl : null; }
    getBoundingClientRect() { this.measurements++; return this.rect; }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    focus() {}
  }
  let image;
  const images = [];
  let observer;
  class TestImage { constructor() { image = this; images.push(this); } }
  class TestResizeObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'Image', { configurable: true, writable: true, value: TestImage });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: TestResizeObserver });
  t.after(() => {
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else delete globalThis.Image;
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver); else delete globalThis.ResizeObserver;
  });
  const canvas = new Canvas();
  const statuses = [];
  const control = mountPanorama(canvas, source, (status, info) => statuses.push({ status, info }));
  t.after(control);
  return {
    canvas, control, statuses, calls, images,
    get image() { return image; },
    get observer() { return observer; },
    dispatch(type, properties = {}) {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, properties);
      canvas.dispatchEvent(event);
      return event;
    },
  };
}

test('touch drag, two-pointer pinch and keyboard controls share bounded view state', (t) => {
  const f = fixture(t);
  assert.equal(typeof f.control, 'function');
  assert.equal(f.statuses.at(-1).status, 'loading');
  f.image.onload();
  assert.equal(f.control.getView().ready, true);
  assert.ok(f.calls.some(call => call.name === 'drawArrays'));
  let updates = 0;
  f.control.setOnViewChange(() => updates++);
  f.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'touch' });
  f.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 130 });
  assert.ok(f.control.getView().yaw < 0);
  assert.ok(f.control.getView().pitch > 0.08);
  f.dispatch('pointerdown', { pointerId: 2, clientX: 300, clientY: 130, pointerType: 'touch' });
  f.dispatch('pointermove', { pointerId: 2, clientX: 400, clientY: 130 });
  assert.equal(f.control.getView().fov, PANORAMA_LIMITS.minFov);
  f.dispatch('pointerup', { pointerId: 2 });
  const before = f.control.getView().yaw;
  f.dispatch('pointermove', { pointerId: 1, clientX: 210, clientY: 130 });
  assert.ok(Math.abs(f.control.getView().yaw - before) < 0.02, 'one-finger drag resumes without a jump');
  f.dispatch('pointercancel', { pointerId: 1 });
  const released = f.control.getView();
  f.dispatch('pointermove', { pointerId: 1, clientX: 300, clientY: 300 });
  assert.deepEqual(f.control.getView(), released);
  assert.equal(f.dispatch('keydown', { key: 'Home' }).defaultPrevented, true);
  assert.equal(f.control.getView().yaw, 0);
  assert.equal(f.control.getView().fov, 65);
  f.dispatch('keydown', { key: '+' });
  assert.equal(f.control.getView().fov, 60);
  f.dispatch('wheel', { deltaY: 10000, deltaMode: 0 });
  assert.equal(f.control.getView().fov, PANORAMA_LIMITS.maxFov);
  const hotspot = f.control.projectHotspot({ yaw: 0, pitch: 0.08 });
  near(hotspot.x, 200);
  near(hotspot.y, 300);
  assert.ok(updates >= 6);
  f.observer.callback();
  assert.ok(updates >= 7);
});

test('lost WebGL contexts rebuild resources, and cleanup prevents stale callbacks and releases resources', (t) => {
  const f = fixture(t);
  f.image.onload();
  assert.equal(f.dispatch('webglcontextlost').defaultPrevented, true);
  assert.equal(f.statuses.at(-1).info.reason, 'webgl-context-lost');
  assert.equal(f.control.getView().ready, false);
  f.dispatch('webglcontextrestored');
  assert.equal(f.statuses.at(-1).status, 'ready');
  assert.equal(f.calls.filter(call => call.name === 'createProgram').length, 2);
  const lateImageCallback = f.image.onload;
  const updateCount = f.statuses.length;
  f.control();
  f.control();
  lateImageCallback();
  f.dispatch('webglcontextrestored');
  assert.equal(f.statuses.length, updateCount);
  assert.equal(f.calls.filter(call => call.name === 'deleteProgram').length, 1);
  assert.equal(f.control.getView().ready, false);
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.canvas.style.touchAction, 'pan-y');
  assert.equal(f.canvas.hasAttribute('tabindex'), false);
});

test('image failure and absent WebGL produce explicit states with compatible cleanup APIs', (t) => {
  const f = fixture(t);
  f.image.onerror();
  assert.equal(f.statuses.at(-1).status, 'error');
  assert.equal(f.statuses.at(-1).info.reason, 'image-load-failed');
  assert.equal(f.control.getView().ready, false);
  const unsupported = fixture(t, false);
  assert.equal(unsupported.statuses.at(-1).status, 'unsupported');
  assert.equal(unsupported.control.zoomBy(-100).fov, PANORAMA_LIMITS.minFov);
  unsupported.control.reset();
  assert.equal(unsupported.control.getView().fov, 65);
});

test('programmatic camera takes shortest yaw path and cancels on input, replacement and disposal', async t => {
  let frame = null, id = 0;
  const raf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const caf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, writable: true, value: callback => { frame = callback; return ++id; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => { frame = null; } });
  t.after(() => {
    if (raf) Object.defineProperty(globalThis, 'requestAnimationFrame', raf); else delete globalThis.requestAnimationFrame;
    if (caf) Object.defineProperty(globalThis, 'cancelAnimationFrame', caf); else delete globalThis.cancelAnimationFrame;
  });
  const tick = time => { const callback = frame; frame = null; callback?.(time); };
  const f = fixture(t);
  assert.equal(await f.control.moveTo({ yaw: 1 }), false, 'not ready');
  f.image.onload();
  await f.control.moveTo({ yaw: 3.1, pitch: 0, fov: 65 }, { duration: 0 });
  const flight = f.control.moveTo({ yaw: -3.1, pitch: .5, fov: 50 }, { duration: 1000 });
  tick(0); tick(500);
  near(Math.abs(f.control.getView().yaw), Math.PI);
  near(f.control.getView().pitch, .25);
  tick(1000); assert.equal(await flight, true);
  near(f.control.getView().yaw, -3.1);
  const interrupted = f.control.moveTo({ yaw: 1 });
  f.dispatch('pointerdown', { pointerId: 1, clientX: 20, clientY: 20, pointerType: 'touch' });
  assert.equal(await interrupted, false);
  assert.equal(frame, null);
  const old = f.control.moveTo({ yaw: 2 });
  const latest = f.control.moveTo({ yaw: 0 });
  assert.equal(await old, false);
  f.control(); assert.equal(await latest, false);
  assert.equal(frame, null);
});

function frameQueue(t) {
  let id = 0;
  const frames = new Map();
  for (const [name, value] of Object.entries({
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  return { frames, tick(time = 0) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); } };
}

test('pointer bursts render once per frame without layout reads or idle redraws', t => {
  const queue = frameQueue(t);
  const f = fixture(t);
  f.image.onload(); queue.tick();
  let updates = 0;
  f.control.setOnViewChange(() => updates++);
  const draws = () => f.calls.filter(call => call.name === 'drawArrays').length;
  const before = draws(), measurements = f.canvas.measurements;
  f.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
  for (let i = 0; i < 120; i++) f.dispatch('pointermove', { pointerId: 1, clientX: 100 + i, clientY: 110 });
  assert.equal(queue.frames.size, 1);
  assert.equal(draws(), before);
  assert.ok(f.control.getView().yaw < 0, 'input state changes immediately');
  f.control.projectHotspot({ yaw: 0, pitch: 0 });
  assert.equal(f.canvas.measurements, measurements);
  queue.tick();
  assert.equal(draws(), before + 1);
  assert.equal(updates, 2, 'one initial snapshot and one batched update');
  assert.equal(queue.frames.size, 0, 'static panorama has no rendering loop');
  f.control.zoomBy(5);
  assert.equal(queue.frames.size, 1);
  f.control();
  assert.equal(queue.frames.size, 0, 'disposal cancels pending render');
});

test('resize observer caches geometry and caps the render buffer on high-DPI screens', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 4 });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'devicePixelRatio', original); else delete globalThis.devicePixelRatio; });
  const f = fixture(t);
  f.image.onload();
  assert.deepEqual(f.calls.find(call => call.name === 'getContext').args[1], { antialias: false, alpha: false, depth: false, stencil: false });
  assert.equal(f.canvas.width, 400 * PANORAMA_RENDER_LIMITS.maxDpr);
  const measurements = f.canvas.measurements;
  f.observer.callback([{ contentRect: { width: 4000, height: 2000 } }]);
  assert.equal(f.canvas.measurements, measurements);
  assert.equal(f.control.getView().width, 4000);
  assert.ok(f.canvas.width * f.canvas.height <= PANORAMA_RENDER_LIMITS.maxPixels);
});

test('cubemaps use mobile derivatives, upload once and restore without refetching', t => {
  const source = { kind: 'cubemap', faces: Array.from({ length: 6 }, (_, i) => `/desktop-${i}.jpg`),
    mobileFaces: Array.from({ length: 6 }, (_, i) => `/mobile-${i}.jpg`) };
  const f = fixture(t, true, source);
  assert.deepEqual(f.images.map(image => image.src), source.mobileFaces);
  for (const image of f.images) { image.complete = true; image.naturalWidth = image.naturalHeight = 1024; }
  const uploads = () => f.calls.filter(call => call.name === 'texImage2D').length;
  for (const image of f.images) image.onload();
  assert.equal(uploads(), 6);
  f.dispatch('webglcontextlost');
  f.dispatch('webglcontextrestored');
  assert.equal(uploads(), 12);
  assert.equal(f.images.length, 6);
  f.control();
  assert.ok(f.images.every(image => image.src === '' && image.onload === null));
});

test('source initial view is the default and Home/reset restore it rather than generic horizon',t=>{
  const initialView={yaw:0,pitch:.66,fov:90};
  const f=fixture(t,true,{kind:'cubemap',faces:Array(6).fill('/face.jpg'),initialView});
  near(f.control.getView().pitch,.66);assert.equal(f.control.getView().fov,90);
  f.dispatch('keydown',{key:'ArrowDown'});f.control.zoomBy(-10);assert.notEqual(f.control.getView().pitch,.66);
  f.control.reset();near(f.control.getView().pitch,.66);assert.equal(f.control.getView().fov,90);
  f.dispatch('keydown',{key:'ArrowUp'});f.dispatch('keydown',{key:'Home'});near(f.control.getView().pitch,.66);
});

test('oversized cubemaps are resized to the GPU limit before upload', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const scaled = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() {
      const canvas = { getContext: () => ({ drawImage() {} }) }; scaled.push(canvas); return canvas;
    },
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  const f = fixture(t, true, { kind: 'cubemap', faces: Array(6).fill('/original.jpg') }, 1024);
  for (const image of f.images) { image.complete = true; image.naturalWidth = image.naturalHeight = 4352; }
  f.images[0].onload();
  assert.equal(f.control.getView().ready, true);
  assert.equal(scaled.length, 6);
  assert.ok(scaled.every(canvas => canvas.width === 1024 && canvas.height === 1024));
});
