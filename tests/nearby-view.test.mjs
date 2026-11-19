import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { executeTool, tools } from '../server/ai/tools.ts';
import { runAgent, systemPrompt } from '../server/ai/llm.ts';
import { guidePayload } from '../server/guide.ts';
import { guideRequestContext } from '../src/services/guide-context.js';
import { nearbyAttractions } from '../src/data/nearby-attractions.js';
import { toolEffect } from '../src/guide/tool-effects.js';
import { createStore } from '../src/guide/store.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createCallSession } from '../src/guide/call-session.js';
import { toCoordinates } from '../src/guide/location.js';
import { getPoi } from '../src/data/pois.js';
import { nearbyMapLayout } from '../src/components/nearby-view.js';

const trace = (id = 'nearby') => ({ id, name: 'look_around', status: 'done', result: executeTool('look_around', { poi_id: 'eiffel' }) });

test('look_around has a strict bounded schema, handles unknown centers and never invents positioning', () => {
  const schema = tools.find(tool => tool.function.name === 'look_around').function.parameters;
  assert.equal(schema.additionalProperties, false);
  assert.equal(executeTool('look_around', {}).status, 'unavailable');
  for (const args of [null, { poi_id: '铁塔' }, { poi_id: '__proto__' }, { poi_id: 'unknown' }, { radius_meters: 49 }, { radius_meters: 1501 }, { limit: 9 }, { limit: 0 }, { limit: 1.5 }, { photos: ['https://evil.test'] }]) assert.ok(executeTool('look_around', args).error);
});

test('nearby results are coordinate-based, sorted, radius-limited and carry existing local photos', async () => {
  const result = executeTool('look_around', { poi_id: 'eiffel' });
  assert.equal(result.status, 'success'); assert.equal(result.origin.kind, 'poi');
  assert.ok(result.items.length > 1); assert.ok(!result.items.some(item => item.poiId === 'eiffel'));
  for (const [i, item] of result.items.entries()) {
    assert.ok(item.distanceMeters <= result.radius);
    if (i) assert.ok(item.distanceMeters >= result.items[i - 1].distanceMeters);
    for (const photo of item.photos) await access(new URL(`../public/${photo.file}`, import.meta.url));
  }
  assert.match(result.disclaimer, /非步行距离/);
  assert.deepEqual(nearbyAttractions({ visitorPosition: { latitude: 0, longitude: 0 } }).items, []);
  assert.equal(nearbyAttractions({ poiId: 'unknown' }), null);
});

test('default lookup prefers sanitized visitor coordinates; explicit center overrides and invalid locations do not leak', () => {
  const visitorOrigin = toCoordinates(getPoi('taj').position);
  const payload = guidePayload({ context: guideRequestContext({ selectedPoiId: 'eiffel', visitorOrigin }) });
  assert.deepEqual(payload.pageContext.visitorPosition, visitorOrigin);
  assert.equal(executeTool('look_around', {}, payload.pageContext).origin.kind, 'visitor');
  assert.equal(executeTool('look_around', { poi_id: 'arc' }, payload.pageContext).origin.poiId, 'arc');
  const fallback = guidePayload({ context: { selectedPoiId: 'eiffel', visitorOrigin: { latitude: 'bad', longitude: 0 } } });
  assert.equal(fallback.pageContext.visitorPosition, null);
  assert.equal(executeTool('look_around', {}, fallback.pageContext).origin.poiId, 'eiffel');
});

test('presentation validates the entire result and rebuilds names and photos from trusted metadata', () => {
  const event = trace(), result = event.result;
  for (const invalid of [{ ...event, status: 'running' }, { ...event, result: { ...result, status: 'unavailable' } }, { ...event, result: { ...result, error: 'no' } }, { ...event, result: { ...result, origin: { kind: 'poi', poiId: 'unknown' } } }, { ...event, result: { ...result, items: [{ poiId: 'fake' }] } }, { ...event, result: { ...result, radius: 9999 } }]) assert.equal(toolEffect(invalid), null);
  const forged = structuredClone(event); forged.result.items[0].name = '<script>'; forged.result.items[0].photos = [{ file: 'javascript:evil' }];
  const effect = toolEffect(forged);
  assert.equal(effect.view, 'map'); assert.equal(effect.introductionView, null); assert.equal(effect.plannedRoute, null);
  assert.notEqual(effect.nearbyView.items[0].name, '<script>'); assert.ok(!JSON.stringify(effect).includes('javascript:'));
});

test('text agent passes page context to the tool, controller presents map annotations, navigation clears them', async () => {
  assert.match(systemPrompt, /必须调用 look_around/);
  let round = 0;
  const { traces, content } = await runAgent({ provider: {}, city: '深圳', pageContext: guidePayload({ context: { selectedPoiId: 'eiffel' } }).pageContext,
    messages: [{ role: 'user', content: '周围有什么' }], complete: async () => !round++
      ? { choices: [{ message: { tool_calls: [{ id: 'nearby', function: { name: 'look_around', arguments: '{}' } }] } }] }
      : { choices: [{ message: { content: '以铁塔为中心，附近有这些景点。' } }] } });
  assert.equal(traces[0].result.status, 'success');
  const store = createStore({ view: 'photo', interactionInput: 'text' }), actions = createTourActions(store);
  const guide = createGuideController({ store, actions, resolveIntent: async () => ({ type: 'answer', text: content, traces }) });
  await guide.submit('周围有什么'); assert.ok(store.get().nearbyView.items.length);
  actions.showMap(); assert.equal(store.get().nearbyView, null); guide.dispose();
});

test('map annotations separate coincident anchors and keep photos and labels within the usable area', () => {
  for (const area of [{ left: 10, top: 36, width: 265, height: 220 }, { left: 10, top: 36, width: 800, height: 440 }]) {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: String(i), x: area.width / 2, y: area.height / 2, photo: i === 0 }));
    const slots = nearbyMapLayout(items, area);
    assert.deepEqual(slots.map(slot => slot.id), items.map(item => item.id));
    for (const [i, slot] of slots.entries()) {
      assert.ok(slot.x >= area.left && slot.x + slot.width <= area.left + area.width);
      assert.ok(slot.y >= area.top && slot.y + slot.height <= area.top + area.height);
      for (const other of slots.slice(i + 1)) assert.ok(slot.x + slot.width <= other.x || other.x + other.width <= slot.x || slot.y + slot.height <= other.y || other.y + other.height <= slot.y);
    }
  }
});

test('native voice and duplex reuse nearby effects, ignore duplicated results and post-interruption tools', async () => {
  let events, finish;
  const store = createStore(), actions = createTourActions(store);
  const guide = createGuideController({ store, actions, speech: { stop() {}, respondToAudio: (_audio, _context, options) => {
    events = options; return new Promise(resolve => { finish = resolve; });
  } } });
  const pending = guide.submitAudio('audio'); events.onToolEnd(trace()); assert.ok(store.get().nearbyView);
  store.set({ nearbyView: null }); events.onAnswer({ content: '附近的景点', traces: [trace()] }); assert.equal(store.get().nearbyView, null);
  guide.interrupt(); events.onToolEnd(trace('late')); assert.equal(store.get().nearbyView, null);
  finish({ status: 'success' }); await pending; guide.dispose();
  let onEvent;
  const call = createCallSession({ store, guide: { interrupt() {} }, sounds: { play() {}, stop() {}, dispose() {} }, createTransport: options => {
    onEvent = options.onEvent; return { start() {}, stop() {} };
  } });
  call.start(); onEvent({ type: 'tool_end', trace: trace() }); assert.ok(store.get().nearbyView);
  store.set({ nearbyView: null }); onEvent({ type: 'tool_end', trace: trace() }); assert.equal(store.get().nearbyView, null);
  call.stop(); onEvent({ type: 'tool_end', trace: trace('late') }); assert.equal(store.get().nearbyView, null); call.dispose();
});
