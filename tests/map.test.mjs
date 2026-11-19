import test from 'node:test';
import assert from 'node:assert/strict';
import { clampMapTransform, zoomMapAt, pinchMapTransform, MAP_LIMITS } from '../src/components/map-controller.js';
import { pois } from '../src/data/pois.js';
import { externalAssets } from '../src/data/external-assets.js';
import { mapMarkup, mountMap } from '../src/components/map.js';
import { mapLayout, mapPlane } from '../src/components/map-layout.js';

test('zoom permits a smaller overview but pan cannot lose the scene', () => {
  assert.deepEqual(clampMapTransform({ scale: 2, x: 900, y: -900 }, 400, 300), { scale: 2, x: 200, y: -150, rotation:0 });
  assert.deepEqual(clampMapTransform({ scale: 0.1, x: 10, y: -10 }, 400, 300), { scale: .65, x: 0, y: 0, rotation:0 });
  assert.equal(clampMapTransform({ scale: 100, x: 0, y: 0 }, 400, 300).scale, 5.5);
});

test('zoom preserves the cursor anchor until a viewport edge is reached', () => {
  const before = { scale: 2, x: 30, y: -20 };
  const after = zoomMapAt(before, 1.25, 70, 40, 400, 300);
  assert.equal((70 - before.x) / before.scale, (70 - after.x) / after.scale);
  assert.equal((40 - before.y) / before.scale, (40 - after.y) / after.scale);
  assert.deepEqual(zoomMapAt(before, 0.01, 70, 40, 400, 300), { scale:.65, x:0, y:0, rotation:0 });
});

test('pinch combines two-finger scaling with midpoint panning', () => {
  const start = [{ x: 150, y: 150 }, { x: 250, y: 150 }];
  const current = [{ x: 120, y: 170 }, { x: 320, y: 170 }];
  assert.deepEqual(pinchMapTransform({ scale: 1, x: 0, y: 0 }, start, current, { left: 0, top: 0 }, 400, 300), { scale:2, x:20, y:20, rotation:0 });
});

test('pinch rotates around its midpoint and zoom retains that rotation',()=>{
  const start=[{x:150,y:150},{x:250,y:150}], current=[{x:200,y:100},{x:200,y:200}];
  const after=pinchMapTransform({scale:2,x:0,y:0},start,current,{left:0,top:0},400,300);
  assert.equal(after.rotation,90);assert.equal(after.scale,2);
  assert.equal(zoomMapAt(after,1.2,0,0,400,300).rotation,90);
  assert.equal(clampMapTransform({scale:1,x:0,y:0,rotation:725},400,300).rotation,5);
});

test('pinch preserves its anchor when scaling and moving back from a map edge', () => {
  const state = { scale: 3, x: 400, y: 0 };
  const start = [{ x: 50, y: 150 }, { x: 150, y: 150 }];
  const current = [{ x: -100 / 3, y: 150 }, { x: 100 / 3, y: 150 }];
  const after = pinchMapTransform(state, start, current, { left: 0, top: 0 }, 400, 300);
  assert.equal(after.scale, 2);
  assert.ok(Math.abs(after.x - 400 / 3) < 1e-8);
  // Compare the map coordinate under the initial and final finger midpoint.
  assert.ok(Math.abs((100 - 200 - state.x) / state.scale - (0 - 200 - after.x) / after.scale) < 1e-8);
  assert.equal(after.y, 0);
});

test('pinch still respects minimum and maximum zoom and viewport coverage', () => {
  const start = [{ x: 150, y: 150 }, { x: 250, y: 150 }];
  const rect = { left: 0, top: 0 };
  const large = pinchMapTransform({ scale: 2, x: 0, y: 0 }, start, [{ x: 300, y: 500 }, { x: 1300, y: 500 }], rect, 400, 300);
  assert.equal(large.scale, 5.5);
  assert.equal(large.x, 600); assert.equal(large.y, 350);
  const small = pinchMapTransform({ scale: 2, x: 150, y: -100 }, start, [{ x: 100, y: 100 }, { x: 101, y: 100 }], rect, 400, 300);
  assert.deepEqual(small, { scale:.65, x:0, y:0, rotation:0 });
});

test('coincident touches and zero-size viewport remain finite', () => {
  const point = [{ x: 100, y: 100 }, { x: 100, y: 100 }];
  assert.deepEqual(pinchMapTransform({ scale: 1, x: 0, y: 0 }, point, point, { left: 0, top: 0 }, 0, 0), { scale:1, x:0, y:0, rotation:0 });
  assert.deepEqual(clampMapTransform({ scale: NaN, x: Infinity, y: NaN }, 0, 0), { scale:1, x:0, y:0, rotation:0 });
});

test('all POIs and accessible controls remain in native markup', () => {
  const markup = mapMarkup();
  for (const id of ['eiffel', 'arc', 'pyramid']) assert.ok(markup.includes(`data-poi="${id}"`));
  for (const action of ['zoom-in', 'zoom-out', 'reset']) assert.ok(markup.includes(`data-map-action="${action}"`));
  assert.ok(markup.includes('tabindex="0"'));
  assert.ok(markup.includes('非实时导航'));
  assert.equal((markup.match(/class="map-poi-pin" aria-hidden="true"><svg class="landmark /g) ?? []).length, pois.filter(p => p.position).length);
  assert.ok(markup.includes('class="map-zoom"'));
  assert.ok(markup.includes('id="map-help" class="sr-only"'));
  assert.equal((markup.match(/data-map-view="relief"/g) ?? []).length, 1);
  assert.ok(!markup.includes('map-view-toggle'));
  assert.ok(!markup.includes('data-map-preview'));
  assert.ok(!markup.includes('map-photo-preview'));
  assert.ok(markup.includes(externalAssets.map ? '© OpenStreetMap' : 'class="map-caption">示意地图</span>'));
  if (externalAssets.map) assert.ok(markup.includes(externalAssets.map.file));
  assert.ok(!markup.includes('演示起点'));
});

// A minimal event harness exercises the controller, without copying its math.
function mapHarness() {
  class Node {
    constructor() { this.listeners = new Map(); this.style = { setProperty(key, value) { this[key] = value; } }; this.dataset = {}; this.classes = new Set(); this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) }; }
    addEventListener(name, callback) { const callbacks = this.listeners.get(name) || []; callbacks.push(callback); this.listeners.set(name, callbacks); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback)); }
    emit(name, data = {}) {
      const event = { type: name, target: this, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
      for (const callback of this.listeners.get(name) || []) { callback(event); if (event.stopped) break; }
      return event;
    }
    closest() { return null; }
    querySelectorAll() { return []; }
  }
  const view = new Node(); const viewport = new Node(); const art = new Node(); const controls = new Node(); const output = new Node();
  let resizeCallback = null;
  view.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { resizeCallback = null; }
  };
  const zoomIn = new Node(); const zoomOut = new Node(); const reset = new Node(); const poi = new Node();
  const nodes = { '.map-art': art, '.map-controls': controls, '.map-zoom': output, '[data-map-action="zoom-in"]': zoomIn, '[data-map-action="zoom-out"]': zoomOut };
  viewport.clientWidth = 400; viewport.clientHeight = 300; viewport.ownerDocument = { defaultView: view };
  viewport.matches = (selector) => selector === '.map-viewport'; viewport.querySelector = (selector) => nodes[selector];
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  viewport.style.touchAction = 'pan-y'; art.style.transform = ''; art.style.transformOrigin = '';
  const captures = new Set(); viewport.setPointerCapture = (id) => captures.add(id); viewport.hasPointerCapture = (id) => captures.has(id); viewport.releasePointerCapture = (id) => captures.delete(id);
  viewport.contains = (node) => node === poi;
  poi.dataset.poi = 'eiffel'; poi.closest = (selector) => selector === 'button[data-poi]' ? poi : null;
  for (const [button, action] of [[zoomIn, 'zoom-in'], [zoomOut, 'zoom-out'], [reset, 'reset']]) {
    button.dataset.mapAction = action;
    button.closest = (selector) => selector.startsWith('.map-controls') ? controls : selector === '[data-map-action]' ? button : null;
  }
  return { view, viewport, art, controls, output, zoomIn, zoomOut, reset, poi, resize: () => resizeCallback?.(), nodes: [view, viewport, controls] };
}

function flightHarness() {
  const harness = mapHarness();
  const frames = new Map(); let id = 0;
  harness.view.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  harness.view.cancelAnimationFrame = id => frames.delete(id);
  const tick = now => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
  return { ...harness, frames, tick };
}

const cameraRoute = {
  stops: [{ poiId: 'eiffel' }, { poiId: 'arc' }],
  geometry: { points: [{ x: 40, y: 30 }, { x: 48, y: 38 }] },
};

test('route framing interpolates from the current camera instead of jumping, including introduction offsets', () => {
  const { viewport, art, tick, frames } = flightHarness();
  const map = mountMap(viewport); let completed = 0;
  map.flyToPoi('eiffel', { x: 40, y: 40, immediate: true });
  const before = art.style.transform;
  map.focusRoute(cameraRoute, { onComplete: () => completed++ });
  assert.equal(art.style.transform, before, 'starting a route must not replace the current transform');
  tick(0); assert.equal(art.style.transform, before, 'first frame must preserve off-center presentation coordinates');
  tick(225); const early = art.style.transform;
  assert.notEqual(early, before);
  tick(450); const middle = art.style.transform;
  assert.notEqual(middle, early); assert.equal(completed, 0);
  tick(900); const after = art.style.transform;
  assert.notEqual(after, middle); assert.equal(completed, 1); assert.equal(frames.size, 0);
  const values = transform => transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/).slice(1).map(Number);
  const start = values(before), end = values(after);
  values(middle).forEach((value, i) => assert.ok(Math.abs(value - (start[i] + end[i]) / 2) < 1e-8));
  values(early).forEach((value, i) => assert.ok(Math.abs(value - (start[i] + (end[i] - start[i]) * .15625)) < 1e-8));
  map();
});

test('route flights restart without jumping, survive route-control bubbling and stop on manual gestures or disposal', () => {
  const { viewport, view, art, controls, zoomIn, frames, tick } = flightHarness();
  const map = mountMap(viewport); let completed = 0;
  map.focusRoute(cameraRoute, { onComplete: () => completed++ });
  tick(0); tick(300);
  const before = art.style.transform;
  map.focusRoute({ ...cameraRoute, geometry: { points: [{ x: 10, y: 20 }, { x: 80, y: 60 }] } });
  tick(300); assert.equal(art.style.transform, before); assert.equal(frames.size, 1);
  controls.emit('click', { target: { closest: () => null } });
  assert.equal(frames.size, 1, 'bubbling route-fit click must not cancel its own flight');
  viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150 });
  assert.equal(frames.size, 0);
  view.emit('pointermove', { pointerId: 1, clientX: 215, clientY: 150 });
  const dragged = art.style.transform;
  tick(1200); assert.equal(art.style.transform, dragged); assert.equal(completed, 0);
  view.emit('pointerup', { pointerId: 1 });
  map.focusRoute(cameraRoute); controls.emit('click', { target: zoomIn }); assert.equal(frames.size, 0);
  map.focusRoute(cameraRoute); viewport.emit('wheel', { deltaY: 40, deltaMode: 0, clientX: 200, clientY: 150 }); assert.equal(frames.size, 0);
  map.focusRoute(cameraRoute); viewport.emit('keydown', { key: 'ArrowRight' }); assert.equal(frames.size, 0);
  map.focusRoute(cameraRoute); map(); assert.equal(frames.size, 0);
});

test('route framing skips animation for reduced motion, hidden documents and explicit immediate mode', () => {
  for (const mode of ['reduce', 'hidden', 'immediate']) {
    const { viewport, view, art, frames } = flightHarness();
    view.matchMedia = () => ({ matches: mode === 'reduce' });
    view.document = { hidden: mode === 'hidden' };
    const map = mountMap(viewport); let completed = 0;
    const before = art.style.transform;
    map.focusRoute(cameraRoute, { immediate: mode === 'immediate', onComplete: () => completed++ });
    assert.notEqual(art.style.transform, before); assert.equal(completed, 1); assert.equal(frames.size, 0);
    map();
  }
});

test('drag suppresses its accidental click; a new tap and keyboard activation still select', () => {
  const harness = mapHarness(); const selected = [];
  const { view, viewport, art, poi } = harness;
  const cleanup = mountMap(viewport, { onSelect: (id) => selected.push(id) });
  viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 220, clientY: 150 });
  view.emit('pointerup', { pointerId: 1 });
  assert.notEqual(art.style.transform, 'translate(0px, 0px) scale(1.3)');
  assert.equal(viewport.emit('click', { target: poi, detail: 1 }).defaultPrevented, true);
  assert.deepEqual(selected, []);
  viewport.emit('click', { target: poi, detail: 0 });
  assert.deepEqual(selected, ['eiffel']);
  viewport.emit('pointerdown', { pointerId: 2, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointerup', { pointerId: 2 });
  viewport.emit('click', { target: poi, detail: 1 });
  assert.deepEqual(selected, ['eiffel', 'eiffel']);
  cleanup(); cleanup();
  assert.equal(art.style.transform, ''); assert.equal(viewport.style.touchAction, 'pan-y');
  assert.equal(harness.nodes.reduce((count, node) => count + [...node.listeners.values()].flat().length, 0), 0);
  cleanup.focusPoi('arc'); cleanup.reset(); assert.equal(art.style.transform, '');
});

test('control buttons clamp zoom, reset, and remove listeners on disposal', () => {
  const { viewport, controls, output, zoomIn, zoomOut, reset } = mapHarness();
  const cleanup = mountMap(viewport);
  for (let count = 0; count < 30; count += 1) controls.emit('click', { target: zoomIn });
  assert.equal(output.textContent, '550%'); assert.equal(zoomIn.disabled, true);
  for (let count = 0; count < 30; count += 1) controls.emit('click', { target: zoomOut });
  assert.equal(output.textContent, '65%'); assert.equal(zoomOut.disabled, true);
  controls.emit('click', { target: reset }); assert.equal(output.textContent, '100%');
  cleanup(); controls.emit('click', { target: zoomIn }); assert.equal(output.textContent, '100%');
});

test('hiding a map preserves its pan; restoring only clamps to the actual visible size', () => {
  const { viewport, art, resize } = mapHarness();
  const cleanup = mountMap(viewport);
  cleanup.focusPoi('pyramid');
  const before = art.style.transform;
  const cameraBefore=cleanup.getTransform();
  assert.ok(!before.startsWith('translate(0px, 0px)'));
  viewport.clientWidth = 0; viewport.clientHeight = 0; resize();
  assert.equal(art.style.transform, before);
  viewport.clientWidth = 400; viewport.clientHeight = 300; resize();
  assert.equal(art.style.transform, before);
  // If the device layout changed while hidden, the restored viewport gets its
  // real bounds instead of either keeping invalid bounds or centering the map.
  viewport.clientWidth = 0; viewport.clientHeight = 0; resize();
  viewport.clientWidth = 200; viewport.clientHeight = 150; resize();
  const values = art.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/).slice(1).map(Number);
  const layout=mapLayout(184,150);
  const xLimit = Math.max(0,(layout.boundsWidth*2.2-200)/2);
  const yLimit = Math.max(0,(layout.boundsHeight*2.2-150)/2);
  assert.ok(Math.abs(cleanup.getTransform().x - Math.max(-xLimit, Math.min(xLimit, cameraBefore.x))) < 1e-8);
  assert.ok(Math.abs(cleanup.getTransform().y - Math.max(-yLimit, Math.min(yLimit, cameraBefore.y))) < 1e-8);
  assert.equal(values[2], 2.2);
  cleanup();
});

test('keyboard closing cannot briefly clamp the camera to the short visible viewport',()=>{
  const {viewport,art,resize}=mapHarness();const map=mountMap(viewport);
  map.flyToPoi('eiffel',{x:70,y:90,immediate:true});
  const before=art.style.transform;
  map.freezeLayout();viewport.clientHeight=120;resize();assert.equal(art.style.transform,before);
  viewport.clientHeight=300;map.resumeLayout();assert.equal(art.style.transform,before);map();
});

test('removed 3D actions cannot change the fixed 2D camera, including while editing',()=>{
  const {viewport,art,controls}=mapHarness(),map=mountMap(viewport);
  map.freezeLayout();const before=art.style.transform;
  controls.emit('click',{target:{closest:()=>({dataset:{mapAction:'view'}})}});
  assert.equal(map.getTransform().pitch,0);assert.equal(art.style.transform,before);
  assert.ok(art.style.transform.includes(mapPlane({angle:14,tiltY:1,shear:0}).transform));
  map();
});

test('a child losing pointer capture does not end the viewport drag', () => {
  const { viewport, view, art, poi } = mapHarness();
  const cleanup = mountMap(viewport);
  viewport.emit('keydown', { key: '+' });
  viewport.emit('keydown', { key: '+' });
  viewport.emit('keydown', { key: '+' });
  viewport.emit('pointerdown', { pointerId: 1, button: 0, clientX: 200, clientY: 150, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 210, clientY: 150 });
  assert.equal(cleanup.getTransform().x,10);
  viewport.emit('lostpointercapture', { pointerId: 1, target: poi });
  view.emit('pointermove', { pointerId: 1, clientX: 220, clientY: 150 });
  assert.equal(cleanup.getTransform().x,20);
  // Losing the viewport's own capture must still end the gesture.
  viewport.emit('lostpointercapture', { pointerId: 1, target: viewport });
  view.emit('pointermove', { pointerId: 1, clientX: 225, clientY: 150 });
  assert.equal(cleanup.getTransform().x,20);
  cleanup();
});

test('portrait geometry clamps to the real artwork bounds and keeps zoom anchors stable', () => {
  const state={scale:1,x:0,y:0};
  const moved=clampMapTransform({...state,x:999,y:999},360,600,MAP_LIMITS,624,600);
  assert.deepEqual(moved,{scale:1,x:132,y:0,rotation:0});
  const zoomed=zoomMapAt(state,2,70,40,360,600,624,600);
  assert.equal((70-zoomed.x)/zoomed.scale,70);
  assert.equal((40-zoomed.y)/zoomed.scale,40);
});

test('presentation flight follows the projected landmark, notifies overlays and cancels on manual control', () => {
  const { view, viewport, controls, reset } = mapHarness();
  const frames = new Map(); let id = 0;
  view.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  view.cancelAnimationFrame = id => frames.delete(id);
  const tick = now => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  const map = mountMap(viewport); let updates = 0, completed = 0;
  const unsubscribe = map.onTransform(() => updates++);
  const before = map.poiPoint('eiffel');
  map.flyToPoi('eiffel', { x: 160, y: 120, onComplete: () => completed++ });
  tick(0); tick(450);
  assert.notDeepEqual(map.poiPoint('eiffel'), before); assert.equal(completed, 0);
  tick(900); assert.equal(completed, 1);
  assert.ok(Math.abs(map.poiPoint('eiffel').x - 160) < 1e-8);
  assert.ok(Math.abs(map.poiPoint('eiffel').y - 120) < 1e-8);
  assert.equal(updates, 3);
  map.flyToPoi('arc', { onComplete: () => completed++ });
  controls.emit('click', { target: reset }); assert.equal(frames.size, 1,'reset replaces the old flight with an animated return');
  tick(1000); tick(2000); assert.equal(completed, 1); assert.equal(frames.size,0);
  map.flyToPoi('eiffel', { x: 140, y: 90, immediate: true, onComplete: () => completed++ });
  assert.equal(completed, 2); assert.equal(frames.size, 0);
  unsubscribe(); map.flyToPoi('arc'); map(); assert.equal(frames.size, 0);
});

test('POI and facility focus publish a shared continuous progress; interruption and home replace the target',()=>{
  const {viewport,art,tick,frames,view}=flightHarness();const map=mountMap(viewport),snapshots=[];
  map.onTransform(s=>snapshots.push({...s,focus:s.focus?{...s.focus}:null}));
  const before=art.style.transform;map.focusPoi('eiffel');assert.equal(art.style.transform,before);
  tick(0);tick(450);assert.equal(snapshots.at(-1).focus.progress,.5);assert.equal(snapshots.at(-1).scale,1.6);
  const mid=art.style.transform;map.focusFacility('node-4809251648');tick(500);assert.equal(art.style.transform,mid,'new target preserves the current frame');
  tick(950);assert.ok(snapshots.at(-1).focus.progress>0);assert.notEqual(art.style.transform,mid);
  viewport.emit('pointerdown',{pointerId:1,button:0,clientX:100,clientY:100});
  assert.equal(frames.size,0);assert.equal(snapshots.at(-1).focus.cancelled,true);assert.equal(snapshots.at(-1).moving,false);
  view.emit('pointerup',{pointerId:1});map.reset();tick(1000);tick(1900);
  assert.equal(snapshots.at(-1).focus.home,true);assert.equal(snapshots.at(-1).focus.progress,1);assert.equal(snapshots.at(-1).scale,1);map();
});
