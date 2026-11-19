import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { executeTool, tools } from '../server/ai/tools.ts';
import { runAgent, systemPrompt } from '../server/ai/llm.ts';
import { parkCatalog } from '../src/data/park-catalog.js';
import { introductionPhotos } from '../src/data/introduction-views.js';
import { introductionLayout } from '../src/components/introduction-view.js';
import { toolEffect } from '../src/guide/tool-effects.js';
import { createStore } from '../src/guide/store.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createCallSession } from '../src/guide/call-session.js';

const trace = (id = 'view-1', poi_id = 'eiffel') => ({ id, name: 'introduce_view', status: 'done', result: executeTool('introduce_view', { poi_id }) });
const controller = (store, options = {}) => createGuideController({ store, actions: createTourActions(store), ...options });

test('introduce_view accepts only canonical mapped IDs and exposes one strict argument', () => {
  const schema = tools.find(t => t.function.name === 'introduce_view').function.parameters;
  assert.deepEqual(schema.required, ['poi_id']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(executeTool('introduce_view', { poi_id: ' eiffel ' }), { status: 'success', poi_id: 'eiffel', name: '埃菲尔铁塔', photo_count: 3 });
  for (const args of [null, {}, { poi_id: 1 }, { poi_id: '' }, { poi_id: ' ' }, { poi_id: 'x'.repeat(81) }, { poi_id: 'eiffel', url: 'https://untrusted.example' }]) assert.ok(executeTool('introduce_view', args).error);
  for (const poi_id of ['铁塔', 'unknown', '__proto__', 'constructor']) assert.equal(executeTool('introduce_view', { poi_id }).status, 'not_found');
  const unmapped = parkCatalog.find(p => !p.position);
  assert.equal(executeTool('introduce_view', { poi_id: unmapped.id }).status, 'unavailable');
});

test('introduction photos use existing local files and never resolve inherited properties', async () => {
  const photos = introductionPhotos('eiffel'); assert.equal(photos.length, 3);
  assert.equal(new Set(photos.map(photo => photo.file)).size, 3);
  for (const photo of photos) { assert.ok(photo.attribution); await access(new URL(`../public/${photo.file}`, import.meta.url)); }
  assert.deepEqual(introductionPhotos('__proto__'), []);
  assert.equal(introductionPhotos('arc').length, 1);
});

test('frontend ignores failed or forged IDs and uses trusted catalog presentation metadata', () => {
  const valid = trace();
  for (const invalid of [null, { ...valid, name: 'eval' }, { ...valid, status: 'running' }, { ...valid, status: 'error' }, { ...valid, result: { status: 'unavailable' } }, { ...valid, result: { status: 'success', poi_id: 'unknown' } }, { ...valid, result: { ...valid.result, error: 'failed' } }]) assert.equal(toolEffect(invalid), null);
  const effect = toolEffect({ ...valid, result: { ...valid.result, name: 'fake', position: { x: 0, y: 0 }, images: ['javascript:alert(1)'] } });
  assert.deepEqual(effect.introductionView, { poiId: 'eiffel' }); assert.equal(effect.view, 'map');
  assert.equal(effect.selectedPoiId, 'eiffel'); assert.equal(effect.pendingNarration, null);
  assert.equal(effect.images, undefined);
});

test('desktop and compact presentation layouts surround the landmark without overlapping its center', () => {
  for (const [width, height] of [[700, 620], [270, 430], [240, 230], [640, 200]]) {
    const layout = introductionLayout({ left: 16, top: 18, width, height });
    assert.equal(layout.slots.length, 3);
    for (const slot of layout.slots) {
      const x = layout.x + slot.x, y = layout.y + slot.y;
      assert.ok(x - layout.cardWidth / 2 >= 16);
      assert.ok(x + layout.cardWidth / 2 <= width + 16);
      assert.ok(y - layout.cardHeight / 2 >= 18);
      assert.ok(y + layout.cardHeight / 2 <= height + 18);
      assert.ok(Math.abs(slot.y) - layout.cardHeight / 2 >= 40 - 1e-8);
    }
  }
});

test('short 40:60 map panes keep photo rows and a compact landmark inside the available map',()=>{
  for(const height of [116,140,174]){
    const area={left:70,top:8,width:190,height},layout=introductionLayout(area,3);
    assert.equal(layout.compact,true);
    for(const slot of layout.slots){
      const x=layout.x+slot.x,y=layout.y+slot.y;
      assert.ok(x-layout.cardWidth/2>=area.left-1e-8 && x+layout.cardWidth/2<=area.left+area.width+1e-8);
      assert.ok(y-layout.cardHeight/2>=area.top && y+layout.cardHeight/2<=area.top+area.height);
      assert.ok(y+layout.cardHeight/2 < layout.y-16);
    }
  }
});
test('one-photo attractions also use the bounded split-pane layout, not the tall three-photo composition',()=>{
  for(const height of [150,180,220,280]){
    const area={left:12,top:8,width:270,height},layout=introductionLayout(area,1),slot=layout.slots[0];
    const y=layout.y+slot.y;
    assert.ok(y-layout.cardHeight/2>=area.top);
    assert.ok(y+layout.cardHeight/2<=area.top+area.height);
  }
});

test('text agent calls introduce_view and text controller consumes its trace before replying', async () => {
  assert.match(systemPrompt, /自然回答之前调用 introduce_view/);
  let round = 0;
  const result = await runAgent({ provider: {}, city: '深圳', messages: [{ role: 'user', content: '铁塔有什么看点' }], complete: async (_provider, body) => {
    assert.ok(body.tools.some(t => t.function.name === 'introduce_view'));
    if (!round++) return { choices: [{ message: { tool_calls: [{ id: 'view', function: { name: 'introduce_view', arguments: '{"poi_id":"eiffel"}' } }] } }] };
    assert.equal(JSON.parse(body.messages.at(-1).content).photo_count, 3);
    return { choices: [{ message: { content: '园内铁塔以巴黎埃菲尔铁塔为原型仿建。' } }] };
  } });
  const store = createStore({ view: 'panorama', interactionInput: 'text' });
  const guide = controller(store, { resolveIntent: async () => ({ type: 'answer', text: result.content, traces: result.traces }) });
  await guide.submit('铁塔有什么看点');
  assert.equal(store.get().view, 'panorama'); assert.equal(store.get().introductionView, null);
  assert.equal(store.get().cameraTour.poiId,'eiffel');assert.equal(store.get().cameraNarrationEnabled,false);
  guide.dispose();
});

test('native voice applies early introduction once, dismissals survive final traces and stale completions', async () => {
  let events, finish;
  const store = createStore({ view: 'panorama' });
  const guide = controller(store, { speech: { stop() {}, respondToAudio: (_audio, _context, options) => {
    events = options; return new Promise(resolve => { finish = resolve; });
  } } });
  const pending = guide.submitAudio('audio'); const event = trace('photo','arc');
  events.onToolEnd(event); assert.equal(store.get().introductionView.poiId, 'arc');
  store.set({ introductionView: null });
  events.onAnswer({ content: '铁塔介绍', traces: [event] });
  assert.equal(store.get().introductionView, null);
  guide.interrupt(); events.onToolEnd(trace('late'));
  assert.equal(store.get().introductionView, null);
  finish({ status: 'success' }); assert.equal((await pending).status, 'cancelled'); guide.dispose();
});

test('duplex calls share the same introduction effect and ignore duplicates and post-hangup events', () => {
  let onEvent;
  const store = createStore();
  const call = createCallSession({ store, guide: { interrupt() {} }, sounds: { play() {}, stop() {}, dispose() {} }, createTransport: options => {
    onEvent = options.onEvent; return { start() {}, stop() {} };
  } });
  call.start(); onEvent({ type: 'tool_end', trace: trace('photo','arc') });
  assert.equal(store.get().introductionView.poiId, 'arc');
  store.set({ introductionView: null }); onEvent({ type: 'tool_end', trace: trace('photo','arc') });
  assert.equal(store.get().introductionView, null);
  call.stop(); onEvent({ type: 'tool_end', trace: trace('late') });
  assert.equal(store.get().introductionView, null); call.dispose();
});

test('explicit map and panorama controls clear the introduction so it cannot reappear on return', () => {
  const store = createStore(toolEffect(trace())), actions = createTourActions(store);
  actions.enterPanorama('eiffel'); assert.equal(store.get().introductionView, null);
  actions.showMap(); assert.equal(store.get().introductionView, null);
  store.set(toolEffect(trace())); actions.selectPoi('arc'); assert.equal(store.get().introductionView, null);
});

test('local companion arrival and explicit narration also frame the current attraction', () => {
  const store = createStore({ tourMode: 'companion' }); const guide = controller(store);
  guide.narrateLocation('eiffel'); assert.equal(store.get().introductionView.poiId, 'eiffel');
  guide.openPoi('arc'); assert.equal(store.get().introductionView.poiId, 'arc');
  assert.equal(store.get().view, 'map'); guide.dispose();
});
