import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, tools } from '../server/ai/tools.ts';
import { runAgent, systemPrompt } from '../server/ai/llm.ts';
import { panoramaHotspots } from '../src/data/pois.js';
import { toolEffect } from '../src/guide/tool-effects.js';
import { createStore } from '../src/guide/store.js';
import { mountPanoramaTour } from '../src/components/panorama-tour.js';
import { createConversationHistory, parseConversations, HISTORY_KEY } from '../src/guide/conversation-history.js';
import { guidePayload } from '../server/guide.ts';
import { guideRequestContext } from '../src/services/guide-context.js';
import { panoramaNarration } from '../src/guide/panorama-narration.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';

const detailed = () => executeTool('get_detailed_attraction_guidance', { poi_id: 'eiffel' });
const move = (ids = ['tower-feet', 'tower-arch'], sync_mode = 'timed') => executeTool('move_camera', { poi_id: 'eiffel', hotspot_ids: ids, sync_mode });
const trace = (name, result) => ({ id: name, name, status: 'done', result });

test('simple and detailed guidance share trusted, distinct presentation paths', () => {
  assert.match(executeTool('get_attraction_guidance', { poi_id: 'eiffel' }).guidance, /简单讲解/);
  const result = detailed();
  assert.equal(result.status, 'success');
  assert.equal(result.hotspots.length, 4);
  assert.deepEqual(result.hotspot_ids, panoramaHotspots.eiffel.map(p => p.id));
  assert.equal(new Set(result.hotspot_ids).size, 4);
  for (const point of panoramaHotspots.eiffel) {
    for (const key of ['yaw', 'pitch', 'fov']) assert.ok(Number.isFinite(point[key]));
    assert.ok(point.title && point.body);
  }
  const patch = toolEffect(trace('get_detailed_attraction_guidance', result));
  assert.equal(patch.view, 'panorama');
  assert.equal(patch.introductionView, null);
  assert.equal(patch.selectedPoiId, 'eiffel');
  assert.equal(toolEffect(trace('get_detailed_attraction_guidance', { ...result, show_panorama: false })), null);
  assert.equal(executeTool('get_detailed_attraction_guidance', { poi_id: 'arc' }).status, 'unavailable');
  assert.equal(executeTool('get_detailed_attraction_guidance', { poi_id: '__proto__' }).status, 'not_found');
});

test('camera tools and frontend reject unknown points, arbitrary angles and failed traces', () => {
  for (const name of ['get_detailed_attraction_guidance', 'move_camera']) {
    assert.equal(tools.find(t => t.function.name === name).function.parameters.additionalProperties, false);
    assert.ok(executeTool(name, {}).error);
  }
  for (const args of [
    { poi_id: 'eiffel', hotspot_ids: [] }, { poi_id: 'eiffel', hotspot_ids: ['unknown'] },
    { poi_id: 'arc', hotspot_ids: ['tower-feet'] }, { poi_id: 'eiffel', hotspot_ids: ['tower-feet', 'tower-feet'] },
    { poi_id: 'eiffel', hotspot_ids: ['tower-feet'], yaw: 1 },
    { poi_id: 'eiffel', hotspot_ids: ['tower-feet'], dwell_seconds: 100 },
  ]) assert.ok(executeTool('move_camera', args).error);
  const result = move();
  const patch = toolEffect(trace('move_camera', result));
  assert.deepEqual(patch.cameraTour, { poiId: 'eiffel', hotspotIds: ['tower-feet', 'tower-arch'], dwellMs: 8000 });
  for (const invalid of [{ ...result, hotspot_ids: ['bad'] }, { ...result, dwell_seconds: -1 }, { ...result, poi_id: 'arc' }, { ...result, status: 'unavailable' }]) {
    assert.equal(toolEffect(trace('move_camera', invalid)), null);
  }
  assert.equal(toolEffect({ ...trace('move_camera', result), status: 'error' }), null);
});

test('camera sequence waits for scene ready, visits points in order, and cancels on user interruption', async () => {
  const store = createStore({ ...toolEffect(trace('move_camera', move())) });
  let ready = false, timer = null;
  const visits = [];
  const camera = { getView: () => ({ ready }), cancelMove() {}, async moveTo(point) { visits.push(point.id); return true; } };
  const tour = mountPanoramaTour({ store, getPanorama: () => camera,
    setTimer(callback, delay) { assert.equal(delay, 8000); timer = callback; return callback; }, clearTimer() { timer = null; } });
  assert.deepEqual(visits, []);
  ready = true; tour.refresh(); await Promise.resolve();
  assert.deepEqual(visits, ['tower-feet']);
  assert.equal(store.get().activeHotspotId, 'tower-feet');
  timer(); await Promise.resolve();
  assert.deepEqual(visits, ['tower-feet', 'tower-arch']);
  assert.equal(store.get().cameraTour, null);
  store.set(toolEffect(trace('move_camera', move()))); await Promise.resolve();
  assert.ok(timer);
  store.set({ cameraTour: null });
  assert.equal(timer, null);
  store.set(toolEffect(trace('move_camera', move()))); await Promise.resolve();
  store.set({ view: 'map' });
  assert.equal(timer, null);
  assert.equal(store.get().cameraTour, null);
  tour.dispose();
});

test('camera sequence ignores stale flights and clears commands on scene failure', async () => {
  const store = createStore(toolEffect(trace('move_camera', move())));
  let finish;
  const camera = { getView: () => ({ ready: true }), cancelMove() {}, moveTo: () => new Promise(resolve => { finish = resolve; }) };
  let scheduled = false;
  const tour = mountPanoramaTour({ store, getPanorama: () => camera, setTimer() { scheduled = true; } });
  store.set({ cameraTour: null }); finish(true); await Promise.resolve();
  assert.equal(scheduled, false);
  camera.getView = () => ({ ready: false, status: 'error' });
  store.set(toolEffect(trace('move_camera', move())));
  assert.equal(store.get().cameraTour, null);
  tour.dispose();
});

test('follow-up context exposes only the trusted active panorama point', () => {
  const state = createStore({ view: 'panorama', activeHotspotId: 'tower-arch' }).get();
  const context = guidePayload({ context: guideRequestContext(state) }).pageContext;
  assert.deepEqual(context.panorama, { poiId: 'eiffel', activeHotspot: { id: 'tower-arch', title: '拱形与钢架' } });
  assert.equal(guidePayload({ context: { ...state, activeHotspotId: '<script>' } }).pageContext.panorama.activeHotspot, null);
});

test('agent can discover detailed points then emit one ordered camera command', async () => {
  assert.match(systemPrompt, /改用 get_detailed_attraction_guidance/);
  let round = 0;
  const result = await runAgent({ provider: {}, city: '深圳', messages: [{ role: 'user', content: '详细讲解铁塔，带我看几个点' }], complete: async (_provider, body) => {
    for (const name of ['get_attraction_guidance', 'get_detailed_attraction_guidance', 'move_camera']) assert.ok(body.tools.some(t => t.function.name === name));
    if (round++ === 0) return { choices: [{ message: { tool_calls: [{ id: 'detail', function: { name: 'get_detailed_attraction_guidance', arguments: '{"poi_id":"eiffel"}' } }] } }] };
    if (round === 2) {
      const evidence = JSON.parse(body.messages.at(-1).content);
      return { choices: [{ message: { tool_calls: [{ id: 'camera', function: { name: 'move_camera', arguments: JSON.stringify({ poi_id: 'eiffel', hotspot_ids: evidence.hotspot_ids }) } }] } }] };
    }
    return { choices: [{ message: { content: '先看舒展的塔脚，宽阔的底部衬托出逐渐收拢的轮廓。' } }] };
  } });
  assert.deepEqual(result.traces.map(t => t.name), ['get_detailed_attraction_guidance', 'move_camera']);
  assert.ok(result.traces.every(t => t.status === 'done'));
});

test('sentence tour follows real playback boundaries, not timers or text receipt', async () => {
  const result = executeTool('move_camera', { poi_id: 'eiffel', hotspot_ids: ['tower-feet', 'tower-arch'] });
  assert.equal(result.sync_mode, 'sentence');
  const patch = toolEffect(trace('move_camera', result));
  const script = panoramaNarration(patch.cameraTour);
  const store = createStore(patch), visits = [];
  let events, finish, stops = 0, ready = false;
  const camera = { getView: () => ({ ready }), cancelMove() {}, async moveTo(point) { visits.push(point.id); return true; } };
  const speech = { speak(text, options) { assert.equal(text, script.text); events = options; return new Promise(resolve => { finish = resolve; }); }, stopSpeaking() { stops++; } };
  const tour = mountPanoramaTour({ store, getPanorama: () => camera, speech,
    setTimer() { assert.fail('sentence mode must not advance by wall-clock timers'); } });
  assert.equal(events, undefined);
  ready = true; tour.refresh();
  assert.deepEqual(visits, []);
  events.onStart(); assert.deepEqual(visits, []);
  const first = script.sentences[0], second = script.sentences[1];
  events.onBoundary(first.charIndex);
  assert.deepEqual(visits, ['tower-feet']);
  assert.equal(store.get().cameraSentence.text, first.text);
  events.onBoundary(second.charIndex);
  assert.equal(store.get().cameraSentence.text, second.text);
  assert.deepEqual(visits, ['tower-feet'], 'same point does not restart camera flight');
  const next = script.sentences.find(s => s.hotspotId === 'tower-arch');
  events.onBoundary(next.charIndex);
  assert.deepEqual(visits, ['tower-feet', 'tower-arch']);
  events.onBoundary(0); assert.equal(store.get().cameraSentence.text, next.text, 'stale cue ignored');
  store.set({ cameraTour: null });
  assert.equal(stops, 1);
  assert.equal(store.get().cameraSentence, null);
  events.onBoundary(script.sentences.at(-1).charIndex);
  assert.equal(store.get().cameraSentence, null);
  finish({ status: 'success' }); await Promise.resolve();
  assert.equal(store.get().guideStatus, 'idle');
  tour.dispose();
});

test('muted tours require an explicit play gesture and synthesis failures stop camera movement', async () => {
  const store = createStore({ ...toolEffect(trace('move_camera', move(['tower-feet'], 'sentence'))), interactionInput: 'text' });
  let calls = 0;
  const camera = { getView: () => ({ ready: true }), cancelMove() {}, moveTo() { assert.fail('no boundary means no move'); } };
  const tour = mountPanoramaTour({ store, getPanorama: () => camera,
    speech: { speak() { calls++; return Promise.resolve({ status: 'error' }); }, stopSpeaking() {} } });
  assert.equal(calls, 0);
  store.set({ cameraNarrationEnabled: true }); await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(store.get().cameraTour, null);
  assert.match(store.get().guideError, /停止自动带看/);
  tour.dispose();
});

test('text guide hands sentence narration to the tour without starting a competing model summary', async () => {
  const store = createStore();
  let events, stopped = 0;
  const result = move(['tower-feet'], 'sentence');
  const guide = createGuideController({ store, actions: createTourActions(store),
    speech: { stop() {}, speak() { assert.fail('summary narration must not overlap the fixed script'); } },
    resolveIntent: async () => ({ type: 'answer', text: '简短确认', traces: [trace('move_camera', result)] }) });
  const tour = mountPanoramaTour({ store,
    getPanorama: () => ({ getView: () => ({ ready: true }), cancelMove() {}, async moveTo() { return true; } }),
    speech: { speak(_text, options) { events = options; return new Promise(() => {}); }, stopSpeaking() { stopped++; } } });
  await guide.submit('详细讲解铁塔');
  assert.equal(store.get().guideStatus, 'preparing');
  events.onBoundary(0);
  assert.equal(store.get().guideStatus, 'speaking');
  assert.match(store.get().guideText, /先看画面左侧/);
  guide.interrupt();
  assert.equal(stopped, 1);
  assert.equal(store.get().cameraTour, null);
  assert.equal(store.get().cameraSentence, null);
  tour.dispose(); guide.dispose();
});

function recordedTour(mode = 'voice') {
  const store = createStore({ interactionInput: mode === 'text' ? 'text' : 'voice',
    interactionMode: mode === 'text' ? 'text' : 'realtime', tourMode: mode === 'companion' ? 'companion' : 'interactive' });
  const saved = new Map(), timers = new Set();
  const history = createConversationHistory({ store,
    storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    scope: { setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); } } });
  const id = history.start(mode);
  let events, complete;
  const tour = mountPanoramaTour({ store,
    getPanorama: () => ({ getView: () => ({ ready: true }), cancelMove() {}, async moveTo() { return true; } }),
    speech: { speak(_text, options) { events = options; return new Promise(resolve => { complete = resolve; }); }, stopSpeaking() {} } });
  const patch = toolEffect(trace('move_camera', move(['tower-feet', 'tower-arch'], 'sentence')));
  store.set({ ...patch, cameraNarrationEnabled: true });
  return { store, history, saved, id, tour, script: panoramaNarration(patch.cameraTour),
    get events() { return events; }, complete: result => complete(result),
    dispose() { tour.dispose(); history.dispose(); } };
}

test('all modes archive only completed panorama sentences, then finalize the full actual script on playout success', async () => {
  for (const mode of ['text', 'voice', 'companion']) {
    const f = recordedTour(mode);
    assert.equal(f.history.get(f.id).messages.length, 0, 'loading audio is not spoken content');
    f.events.onStart();
    assert.equal(f.history.get(f.id).messages.length, 0, 'the player start is not a sentence completion');
    f.events.onBoundary(0);
    assert.equal(f.history.get(f.id).messages[0].partial, true);
    assert.ok(!f.history.get(f.id).messages[0].text.includes(f.script.sentences[1].text));
    f.events.onBoundary(f.script.sentences[1].charIndex);
    assert.equal(f.history.get(f.id).messages[0].text, f.script.sentences[0].text.trimEnd());
    f.complete({ status: 'success' }); await Promise.resolve();
    const messages = f.history.get(f.id).messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, f.script.text); assert.equal(messages[0].partial, undefined);
    assert.equal(messages[0].source, mode); assert.deepEqual(messages[0].poiIds, ['eiffel']);
    f.history.flush();
    assert.equal(parseConversations(f.saved.get(HISTORY_KEY))[0].messages[0].text, f.script.text);
    f.dispose();
  }
});

test('panorama interruption trims the incomplete sentence, ignores late success, and cannot leak into a fresh conversation', async () => {
  const f = recordedTour();
  f.events.onBoundary(0); f.events.onBoundary(f.script.sentences[1].charIndex);
  f.store.set({ cameraTour: null });
  const row = f.history.get(f.id).messages[0];
  assert.equal(row.interrupted, true); assert.equal(row.partial, undefined);
  assert.ok(row.text.startsWith(f.script.sentences[0].text));
  assert.ok(!row.text.includes(f.script.sentences[1].text));
  assert.match(row.text, /未完整播完/);
  f.history.start('text');
  f.events.onBoundary(f.script.sentences.at(-1).charIndex);
  f.complete({ status: 'success' }); await Promise.resolve();
  assert.equal(f.store.get().messages.length, 0);
  assert.equal(f.history.get(f.id).messages[0].text, row.text);
  f.dispose();
});

test('TTS failure before playback creates no invented narration; mid-sentence failure records an interruption', async () => {
  for (const begun of [false, true]) {
    const f = recordedTour();
    if (begun) f.events.onBoundary(0);
    f.complete({ status: 'error' }); await Promise.resolve();
    const rows = f.history.get(f.id).messages;
    assert.equal(rows.length, begun ? 1 : 0);
    if (begun) { assert.match(rows[0].text, /已中断/); assert.equal(rows[0].interrupted, true); }
    f.dispose();
  }
});

test('a late recorded-voice summary suppressed by sentence playback never enters model context or history', async () => {
  const store = createStore({ interactionInput: 'voice', interactionMode: 'realtime' });
  const guide = createGuideController({ store, actions: createTourActions(store),
    speech: { stop() {}, async respondToAudio(_audio, _context, events) {
      events.onTranscript('详细讲解铁塔');
      events.onToolEnd(trace('move_camera', move(['tower-feet'], 'sentence')));
      store.set({ cameraTour: null }); // The visitor stopped the guided camera before the model finished.
      events.onAnswer({ content: '未播放的迟到总结', audioSuppressed: true });
      return { status: 'success' };
    } } });
  await guide.submitAudio('test');
  assert.equal(store.get().messages.length, 1);
  assert.equal(store.get().messages[0].role, 'user');
  assert.ok(!store.get().guideText.includes('迟到总结'));
  guide.dispose();
});
