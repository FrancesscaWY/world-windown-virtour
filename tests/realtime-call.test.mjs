import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import WebSocket from 'ws';
import { createRealtimeBridge } from '../server/ai/realtime.ts';
import { createProxy } from '../server/proxy.ts';
import { createRealtimeCall } from '../src/services/realtime-call.js';
import { createPcmPlayback } from '../src/services/native-audio.js';
import { createCallSession } from '../src/guide/call-session.js';
import { createStore } from '../src/guide/store.js';
import { callPresentation } from '../src/components/call-status.js';

test('an ended call is not presented as listening, even when voice remains selected',()=>{
  const presentation=callPresentation({callState:'idle',interactionMode:'realtime',guideStatus:'idle'});
  assert.equal(presentation.state,'idle');assert.equal(presentation.duration,'');
  assert.doesNotMatch(presentation.label,/在听|正在说/);
  assert.match(presentation.hint,/耳麦.*交流/);
});
import { createCallSounds } from '../src/services/call-sounds.js';
import { createSpeechGate } from '../src/services/call-vad-state.js';
import { createCallVad } from '../src/services/call-vad.js';
import { guidePayload } from '../server/guide.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const audio = Buffer.alloc(48000).toString('base64'); // one second of 24 kHz PCM
const provider = { apiKey: 'test-only', baseUrl: 'wss://example.test', model: 'qwen-audio-3.1-realtime-flash', voice: 'test' };
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = []; ended = false;
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  terminate() { this.ended = true; this.readyState = 3; this.emit('close'); }
  close() { this.terminate(); }
}
async function bridgeFixture(t, journal, context = {}) {
  const client = new Socket(), upstream = new Socket(); let connects = 0, closes = 0;
  const bridge = createRealtimeBridge({ client, provider, validateUrl: async url => new URL(url),
    connect: () => { connects++; return upstream; }, onClose: () => closes++, journal });
  t.after(() => bridge.close());
  client.receive({ type: 'start', context }); await tick();
  upstream.receive({ type: 'session.created' }); upstream.receive({ type: 'session.updated' });
  return { client, upstream, bridge, connects: () => connects, closes: () => closes,
    start(id) { upstream.receive({ type: 'response.created', response: { id } }); },
    pcm(id, itemId = 'item-'+id) { upstream.receive({ type: 'response.audio.delta', response_id: id, item_id: itemId, content_index: 0, delta: audio }); },
  };
}

test('companion arrivals create grounded interruptible application events, not visitor transcripts',async t=>{
  const {getPoi}=await import('../src/data/pois.js');
  const {toCoordinates}=await import('../src/guide/location.js');
  const context={tourMode:'companion',visitorOriginSource:'手机定位',visitorOrigin:toCoordinates(getPoi('eiffel').position)};
  const f=await bridgeFixture(t,undefined,context);
  f.client.receive({type:'arrival',poiId:'eiffel',context});
  assert.equal(f.client.sent.at(-1).status,'started');
  assert.equal(f.upstream.sent.at(-1).type,'response.create');
  assert.equal(f.upstream.sent.at(-1).response.tool_choice,'none');
  assert.match(f.upstream.sent.at(-1).response.instructions,/埃菲尔铁塔/);
  assert.match(f.upstream.sent.at(-1).response.instructions,/不要主动、反复说/);
  assert.match(f.upstream.sent.at(-1).response.instructions,/围绕一个值得看的细节/);
  assert.doesNotMatch(f.upstream.sent.at(-1).response.instructions,/这是园内仿建景观，不是海外原建筑/);
  const event=f.upstream.sent.find(e=>e.item?.role==='user');
  assert.match(event.item.content[0].text,/应用位置通知，并非游客发言/);
  assert.ok(!f.client.sent.some(e=>e.type==='transcript'));
  f.start('arrival');f.pcm('arrival');
  f.client.emit('message',Buffer.alloc(640),true);
  assert.equal(f.upstream.sent.at(-1).type,'input_audio_buffer.append');
  f.upstream.receive({type:'input_audio_buffer.speech_started'});
  assert.equal(f.upstream.sent.at(-1).type,'response.cancel');
  f.client.receive({type:'arrival',poiId:'eiffel',context});assert.equal(f.client.sent.at(-1).status,'skipped');
});
test('arrival requests cannot speak over a question, reuse a landmark or invent a distant position',async t=>{
  const {getPoi}=await import('../src/data/pois.js');
  const {toCoordinates}=await import('../src/guide/location.js');
  const context={tourMode:'companion',visitorOrigin:toCoordinates(getPoi('eiffel').position)};
  const f=await bridgeFixture(t,undefined,context);
  f.client.receive({type:'arrival',poiId:'sydney',context});assert.equal(f.client.sent.at(-1).status,'skipped');
  f.upstream.receive({type:'input_audio_buffer.speech_started'});
  f.upstream.receive({type:'input_audio_buffer.speech_stopped'});
  f.client.receive({type:'arrival',poiId:'eiffel',context});assert.equal(f.client.sent.at(-1).status,'skipped');
  assert.ok(!f.upstream.sent.some(e=>e.type==='response.create'));
  const interactive=await bridgeFixture(t);
  interactive.client.receive({type:'arrival',poiId:'eiffel',context});assert.equal(interactive.client.sent.at(-1).status,'skipped');
});

test('interactive landmark taps are explicit application events that cancel stale responses without fabricating tourist speech',async t=>{
  const context={tourMode:'interactive'};
  const f=await bridgeFixture(t,undefined,context);
  const greetings=f.upstream.sent.filter(event=>event.type==='response.create').length;
  f.start('old');f.pcm('old');
  f.client.receive({type:'selection',poiId:'eiffel',context});
  assert.equal(f.client.sent.at(-1).type,'selection');assert.equal(f.client.sent.at(-1).status,'started');
  assert.ok(f.upstream.sent.some(event=>event.type==='response.cancel'));
  const item=f.upstream.sent.find(event=>event.item?.content?.[0]?.text.includes('页面点击事件'));
  assert.match(item.item.content[0].text,/不是游客语音/);
  assert.ok(!f.client.sent.some(event=>event.type==='transcript'));
  assert.equal(f.upstream.sent.filter(event=>event.type==='response.create').length,greetings,'selection adds no model speech over the fixed sentence player');
  const before=f.client.sent.length;f.pcm('old');assert.equal(f.client.sent.length,before);
  f.client.receive({type:'selection',poiId:'unknown',context});assert.equal(f.client.sent.at(-1).status,'skipped');
});

test('interactive connection actively greets once, never replays on context refresh or session update',async t=>{
  const f=await bridgeFixture(t,undefined,{tourMode:'interactive'});
  const count=()=>f.upstream.sent.filter(e=>e.type==='response.create').length;
  assert.equal(count(),1);
  assert.match(f.upstream.sent.find(e=>e.type==='response.create').response.instructions,/只问候这一次/);
  assert.ok(!f.client.sent.some(e=>e.type==='transcript'));
  f.client.receive({type:'context',context:{tourMode:'interactive'}});
  f.upstream.receive({type:'session.updated'});
  assert.equal(count(),1);
});

test('root-level supplier access denial is a permission problem, not a misleading network disconnect',async t=>{
  const f=await bridgeFixture(t);
  f.upstream.receive({code:'AccessDenied.Unpurchased',message:'Access to model denied.'});
  const error=f.client.sent.find(e=>e.type==='error');
  assert.equal(error.code,'provider-access');assert.match(error.message,/开通权限或额度/);
});

test('persistent call streams microphone during playback and cancels stale audio, text and tools on barge-in', async t => {
  const f = await bridgeFixture(t);
  assert.deepEqual(f.upstream.sent[0].session.turn_detection, { type: 'server_vad', threshold: .5, prefix_padding_ms: 300, silence_duration_ms: 450 });
  assert.equal(f.client.sent.at(-1).type, 'ready');
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.start('old'); f.pcm('old');
  f.client.emit('message', Buffer.alloc(640), true);
  assert.equal(f.upstream.sent.at(-1).type, 'input_audio_buffer.append');
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  assert.equal(f.upstream.sent.at(-1).type, 'response.cancel');
  const count = f.client.sent.length;
  f.pcm('old');
  f.upstream.receive({ type: 'response.text.delta', response_id: 'old', delta: 'stale' });
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'old', call_id: 'stale-tool', name: 'plan_route', arguments: '{}' });
  f.upstream.receive({ type: 'response.done', response: { id: 'old', status: 'cancelled' } });
  assert.equal(f.client.sent.length, count);
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.start('next'); f.pcm('next');
  assert.equal(f.client.sent.at(-1).responseId, 'next');
  assert.equal(f.connects(), 1);
  f.bridge.close(); assert.equal(f.closes(), 1); assert.equal(f.upstream.ended, true);
});

test('late playout acknowledgements truncate old audio to heard time without cancelling the new response', async t => {
  const f = await bridgeFixture(t);
  f.start('old'); f.pcm('old');
  f.upstream.receive({ type: 'response.done', response: { id: 'old', status: 'completed' } });
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.start('new');
  const count = f.upstream.sent.length;
  f.client.receive({ type: 'interrupt', responseId: 'old', played: [{ itemId: 'item-old', audioEndMs: 247.9 }] });
  assert.equal(f.upstream.sent.length, count + 1);
  assert.deepEqual({ ...f.upstream.sent.at(-1), event_id: undefined }, { event_id: undefined, type: 'conversation.item.truncate', item_id: 'item-old', content_index: 0, audio_end_ms: 247 });
  f.pcm('new'); assert.equal(f.client.sent.at(-1).responseId, 'new');
  f.client.receive({ type: 'interrupt', responseId: 'old', played: [] });
  assert.equal(f.upstream.sent.length, count + 1, 'truncation is idempotent');
});

test('call tool results run on the backend and continue the same turn without reconnecting', async t => {
  const f = await bridgeFixture(t); f.start('tool-response');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'tool-response', call_id: 'lookup', name: 'search_knowledge_base', arguments: '{"query":"世界之窗 铁塔"}' });
  f.upstream.receive({ type: 'response.done', response: { id: 'tool-response', status: 'completed' } });
  assert.ok(f.client.sent.find(e => e.type === 'tool_end' && e.trace.name === 'search_knowledge_base'));
  assert.ok(f.upstream.sent.find(e => e.item?.type === 'function_call_output'));
  assert.equal(f.upstream.sent.at(-1).type, 'response.create');
  assert.equal(f.connects(), 1);
});

test('hangup tool ends both sockets normally, logs the reason and never asks for another response', async t => {
  const reasons = [];
  const f = await bridgeFixture(t, { record() {}, close(reason) { reasons.push(reason); } });
  assert.ok(f.upstream.sent[0].session.tools.some(tool => tool.function.name === 'hang_up'));
  assert.match(f.upstream.sent[0].session.instructions, /"callActive":true/);
  f.client.receive({ type: 'context', context: { callActive: false } });
  assert.match(f.upstream.sent.at(-1).session.instructions, /"callActive":true/);
  f.start('bye');
  for (const [id, name] of [['hangup', 'hang_up'], ['later-tool', 'search_knowledge_base']]) {
    f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'bye', call_id: id, name, arguments: '{}' });
  }
  f.upstream.receive({ type: 'response.done', response: { id: 'bye', status: 'completed' } });
  assert.deepEqual(f.client.sent.filter(event => event.type === 'tool_end').map(event => event.trace.name), ['hang_up']);
  assert.deepEqual(f.client.sent.at(-1), { type: 'call_ended', responseId: 'bye', turn: 0, reason: 'visitor-request' });
  assert.equal(f.client.ended, true); assert.equal(f.upstream.ended, true); assert.equal(f.closes(), 1);
  assert.deepEqual(reasons, ['visitor-request']);
  assert.ok(!f.upstream.sent.some(event => event.type === 'response.create'));
  assert.ok(!f.client.sent.some(event => event.type === 'error'));
});

test('invalid or cancelled hangup calls cannot end a live call and page input cannot forge call context', async t => {
  assert.equal(guidePayload({ context: { callActive: true } }).pageContext.callActive, undefined);
  const f = await bridgeFixture(t); f.start('invalid');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'invalid', call_id: 'bad', name: 'hang_up', arguments: '{"extra":true}' });
  f.upstream.receive({ type: 'response.done', response: { id: 'invalid', status: 'completed' } });
  assert.equal(f.client.sent.find(event => event.type === 'tool_end').trace.status, 'error');
  assert.equal(f.closes(), 0);
  f.start('cancelled');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'cancelled', call_id: 'old', name: 'hang_up', arguments: '{}' });
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ type: 'response.done', response: { id: 'cancelled', status: 'completed' } });
  assert.equal(f.closes(), 0);
  assert.ok(!f.client.sent.some(event => event.type === 'call_ended'));
});

test('duplex tool phase cannot speak its function metadata and the final answer remains streaming', async t => {
  for (const marker of ['item', 'arguments']) {
    const f = await bridgeFixture(t); f.start('tool');
    const instructions = f.upstream.sent[0].session.instructions;
    assert.match(instructions, /工具调用前和执行期间保持安静/);
    f.client.receive({ type: 'context', context: {} });
    assert.match(f.upstream.sent.at(-1).session.instructions, /工具调用前和执行期间保持安静/);
    if (marker === 'item') f.upstream.receive({ type: 'response.output_item.added', response_id: 'tool', item: { type: 'function_call' } });
    else f.upstream.receive({ type: 'response.function_call_arguments.delta', response_id: 'tool', delta: '{"query":' });
    f.pcm('tool');
    f.upstream.receive({ type: 'response.audio_transcript.delta', response_id: 'tool', item_id: 'tool-item', delta: '我现在调用 search_knowledge_base。' });
    f.upstream.receive({ type: 'response.text.done', response_id: 'tool', item_id: 'tool-item', text: '{"query":"铁塔"}' });
    assert.ok(!f.client.sent.some(e => ['audio', 'answer'].includes(e.type)));
    f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'tool', call_id: 'lookup', name: 'search_knowledge_base', arguments: '{"query":"世界之窗 铁塔"}' });
    f.upstream.receive({ type: 'response.done', response: { id: 'tool', status: 'completed' } });
    assert.equal(f.client.sent.find(e => e.type === 'tool_end').trace.status, 'done');
    assert.equal(f.upstream.sent.at(-1).type, 'response.create');
    f.start('answer'); f.pcm('answer');
    f.upstream.receive({ type: 'response.audio_transcript.delta', response_id: 'answer', item_id: 'spoken', delta: '园内铁塔是仿建景观。' });
    assert.equal(f.client.sent.find(e => e.type === 'audio').responseId, 'answer');
    assert.equal(f.client.sent.at(-1).text, '园内铁塔是仿建景观。');
    assert.equal(f.connects(), 1);
  }
});

test('duplex route tool retains full road geometry for the map and sends only its summary upstream', async t => {
  const f = await bridgeFixture(t); f.start('route-response');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'route-response', call_id: 'route', name: 'plan_route', arguments: JSON.stringify({ title: '沿路建筑游', summary: '欣赏欧洲建筑', stops: [{ poi_id: 'arc', reason: '看拱门' }, { poi_id: 'eiffel', reason: '看塔身' }] }) });
  f.upstream.receive({ type: 'response.done', response: { id: 'route-response', status: 'completed' } });
  const trace = f.client.sent.find(e => e.type === 'tool_end').trace;
  assert.equal(trace.status, 'done'); assert.equal(trace.result.route.geometry.kind, 'artwork-traced');
  assert.ok(trace.result.route.geometry.points.length > 2);
  const summary = JSON.parse(f.upstream.sent.find(e => e.item?.type === 'function_call_output').item.output);
  assert.equal(summary.route.geometry.points, undefined);
  assert.equal(summary.route.distanceMeters, trace.result.route.distanceMeters);
  assert.deepEqual(summary.route.stops.map(stop => stop.poiId), ['arc', 'eiffel']);
});

test('duplex detailed guidance and camera tools use the shared allowlist and stop on barge-in', async t => {
  const f = await bridgeFixture(t);
  for (const name of ['get_detailed_attraction_guidance', 'move_camera']) assert.ok(f.upstream.sent[0].session.tools.some(tool => tool.function.name === name));
  f.start('detail');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'detail', call_id: 'detail-tool', name: 'get_detailed_attraction_guidance', arguments: '{"poi_id":"eiffel"}' });
  f.upstream.receive({ type: 'response.done', response: { id: 'detail', status: 'completed' } });
  const details = f.client.sent.find(event => event.type === 'tool_end').trace.result;
  assert.equal(details.status, 'success');
  assert.equal(details.hotspot_ids.length, 4);
  f.start('camera');
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'camera', call_id: 'camera-tool', name: 'move_camera', arguments: JSON.stringify({ poi_id: 'eiffel', hotspot_ids: details.hotspot_ids }) });
  f.upstream.receive({ type: 'response.done', response: { id: 'camera', status: 'completed' } });
  const camera = f.client.sent.find(event => event.type === 'tool_end' && event.trace.name === 'move_camera');
  assert.deepEqual(camera.trace.result.hotspot_ids, details.hotspot_ids);
  assert.equal(camera.trace.status, 'done');
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  const count = f.client.sent.filter(event => event.type === 'tool_end').length;
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'camera', call_id: 'stale-camera', name: 'move_camera', arguments: '{"poi_id":"eiffel","hotspot_ids":["tower-feet"]}' });
  assert.equal(f.client.sent.filter(event => event.type === 'tool_end').length, count);
});

test('errors are sanitized and a cancelled pending connection never opens upstream', async t => {
  const f = await bridgeFixture(t);
  f.upstream.receive({ type: 'error', error: { message: 'Bearer secret-upstream-detail' } });
  assert.equal(f.client.sent.at(-1).type, 'error');
  assert.ok(!JSON.stringify(f.client.sent).includes('secret-upstream-detail'));
  let resolveUrl, connections = 0;
  const client = new Socket();
  const bridge = createRealtimeBridge({ client, provider, validateUrl: () => new Promise(r => { resolveUrl = r; }), connect: () => { connections++; return new Socket(); } });
  client.receive({ type: 'start' }); bridge.close(); resolveUrl(new URL(provider.baseUrl)); await tick();
  assert.equal(connections, 0);
});

const noActiveResponse = { type: 'invalid_request_error', code: 'invalid_value',
  message: 'Conversation has no active response.', param: 'response.cancel' };

test('cloud cancellation winning a local barge-in race without error.event_id keeps the call alive', async t => {
  const rows = [];
  const f = await bridgeFixture(t, { record(source, event, context = {}) { rows.push({ source, event, context }); }, input() {}, close() {} });
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.client.receive({ type: 'barge_in', turn: 1 });
  f.start('pending-old');
  const cancellationId = f.upstream.sent.at(-1).event_id;
  assert.equal(f.upstream.sent.at(-1).type, 'response.cancel');
  f.upstream.receive({ type: 'response.done', response: { id: 'pending-old', status: 'cancelled',
    status_details: { type: 'cancelled', reason: 'turn_detected' } } });
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ event_id: 'provider-race', type: 'error', error: noActiveResponse });
  assert.equal(f.closes(), 0);
  assert.equal(f.client.ended, false);
  assert.ok(!f.client.sent.some(event => event.type === 'error'));
  assert.ok(rows.some(row => row.event.type === 'cancel.race_ignored'
    && row.event.eventId === cancellationId && row.event.providerEventId === 'provider-race'));
  f.client.emit('message', Buffer.alloc(640), true);
  assert.equal(f.upstream.sent.at(-1).type, 'input_audio_buffer.append');
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.start('next'); f.pcm('next');
  assert.equal(f.client.sent.at(-1).responseId, 'next');
  assert.equal(f.connects(), 1);
});

test('a correlated no-active-response cancellation error is consumed only once', async t => {
  const f = await bridgeFixture(t); f.start('old');
  f.client.receive({ type: 'interrupt', responseId: 'old', played: [] });
  const eventId = f.upstream.sent.at(-1).event_id;
  f.upstream.receive({ type: 'error', error: { ...noActiveResponse, event_id: eventId } });
  assert.equal(f.closes(), 0);
  f.upstream.receive({ type: 'error', error: noActiveResponse });
  assert.equal(f.closes(), 1);
  assert.equal(f.client.sent.at(-1).code, 'provider-error');
});

test('unrelated provider errors are fatal even with a recent cancellation', async t => {
  for (const variant of ['no-cancel', 'wrong-id', 'wrong-param', 'wrong-code', 'wrong-type', 'wrong-message', 'expired']) {
    await t.test(variant, async t => {
      let now = Date.now(); t.mock.method(Date, 'now', () => now);
      const f = await bridgeFixture(t);
      const error = { ...noActiveResponse };
      if (variant !== 'no-cancel') {
        f.start('old'); f.client.receive({ type: 'interrupt', responseId: 'old', played: [] });
        if (variant === 'wrong-id') error.event_id = 'unrelated-request';
        if (variant === 'wrong-param') error.param = 'session.update';
        if (variant === 'wrong-code') error.code = 'permission_denied';
        if (variant === 'wrong-type') error.type = 'server_error';
        if (variant === 'wrong-message') {
          error.event_id = f.upstream.sent.at(-1).event_id;
          error.message = 'Invalid cancellation configuration';
        }
        if (variant === 'expired') now += 10001;
      }
      f.upstream.receive({ type: 'error', error });
      assert.equal(f.closes(), 1);
      assert.equal(f.client.sent.at(-1).code, 'provider-error');
    });
  }
});

test('single public proxy supports duplex WebSockets, arbitrary Origins and shutdown', { timeout: 5000 }, async t => {
  let upstream;
  const { proxy, backend } = await createProxy({ backendOptions: { env: { DASHSCOPE_API_KEY: 'test-only' },
    realtimeBridge: options => createRealtimeBridge({ ...options, validateUrl: async url => new URL(url), connect: () => {
      upstream = new Socket(); const send = upstream.send.bind(upstream);
      upstream.send = data => { send(data); if (JSON.parse(data).type === 'session.update') queueMicrotask(() => upstream.receive({ type: 'session.updated' })); };
      queueMicrotask(() => upstream.receive({ type: 'session.created' })); return upstream;
    } }),
  } });
  t.after(() => proxy.close());
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  const socket = new WebSocket(origin.replace('http:', 'ws:')+'/api/voice/realtime', { origin });
  await once(socket, 'open');
  const ready = once(socket, 'message'); socket.send(JSON.stringify({ type: 'start' }));
  assert.equal(JSON.parse((await ready)[0]).type, 'ready');
  socket.send(Buffer.alloc(640));
  await new Promise(resolve => { const check = () => upstream.sent.some(e => e.type === 'input_audio_buffer.append') ? resolve() : setImmediate(check); check(); });
  for (const options of [{ origin: 'https://other.example' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, {}]) {
    const crossSite = new WebSocket(`ws://127.0.0.1:${backend.server.address().port}/api/voice/realtime`, options);
    await once(crossSite, 'open');
    const ended = once(crossSite, 'close'); crossSite.close(); await ended; await tick();
  }
  const ended = once(socket, 'close'); await proxy.close(); await ended;
  assert.equal(upstream.ended, true);
});

test('AudioWorklet packetizer retains sample-clock phase at 44.1 and 48 kHz', async () => {
  const source = await readFile(new URL('../src/services/call-capture-worklet.js', import.meta.url), 'utf8');
  for (const rate of [44100, 48000]) {
    let Processor; const packets = [];
    vm.runInNewContext(source, { sampleRate: rate, AudioWorkletProcessor: class { port = { postMessage: data => packets.push(data) }; },
      registerProcessor: (_name, value) => { Processor = value; } });
    const processor = new Processor();
    for (let at = 0; at < rate * 2; at += 128) processor.process([[new Float32Array(Math.min(128, rate * 2 - at)).fill(.5)]]);
    assert.equal(packets.length, 100); assert.ok(packets.every(p => p.byteLength === 640));
    assert.equal(new DataView(packets[0]).getInt16(0, true), 16384);
  }
});

function browserFixture({ pendingPermission = false } = {}) {
  const nodes = [], captures = [], sockets = [], contexts = [], events = [];
  const track = { enabled: true, stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let grant;
  const scope = { isSecureContext: true, location: { href: 'http://localhost/tour.html' }, atob, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { mediaDevices: { getUserMedia: async () => pendingPermission ? new Promise(r => { grant = r; }) : stream } },
    AudioContext: class {
      state = 'running'; currentTime = 0; outputLatency = .02; destination = {};
      audioWorklet = { addModule: async () => {} };
      constructor() { contexts.push(this); }
      async resume() {} async close() { this.closed = true; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
      createBuffer(_c, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
      createBufferSource() { const node = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } }; nodes.push(node); return node; }
    },
    AudioWorkletNode: class { port = { close() {} }; constructor() { captures.push(this); } connect() {} disconnect() {} },
    WebSocket: class {
      readyState = 1; bufferedAmount = 0; sent = [];
      constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
      send(data) { this.sent.push(typeof data === 'string' ? JSON.parse(data) : data); }
      close() { this.closed = true; this.onclose?.(); }
      receive(event) { this.onmessage({ data: JSON.stringify(event) }); }
    },
  };
  const detector = { ready: Promise.resolve(true), packets: [], resets: 0, stops: 0,
    push(pcm) { this.packets.push(pcm); }, reset() { this.resets++; }, stop() { this.stops++; } };
  const call = createRealtimeCall({ scope, onEvent: e => events.push(e), createDetector: options => { detector.options = options; return detector; } });
  return { call, scope, events, track, stream, nodes, sockets, captures, contexts, detector, grant: () => grant(stream) };
}

test('browser capture stays live during playback, barge-in clears all sources and late audio never restarts', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0], capture = f.captures[0];
  socket.receive({ type: 'ready' }); socket.receive({ type: 'response_started', responseId: 'a', turn: 0 });
  socket.receive({ type: 'audio', responseId: 'a', turn: 0, itemId: 'i', audio });
  f.contexts[0].currentTime = .5;
  capture.port.onmessage({ data: new ArrayBuffer(640) });
  assert.equal(socket.sent.at(-1).byteLength, 640); assert.equal(f.track.stops, 0);
  socket.receive({ type: 'speech_started', turn: 1 });
  assert.equal(f.nodes[0].stopped, true);
  const interruption = socket.sent.find(e => e.type === 'interrupt');
  assert.equal(interruption.responseId, 'a'); assert.equal(interruption.played[0].audioEndMs, 449);
  socket.receive({ type: 'audio', responseId: 'a', turn: 0, itemId: 'i', audio });
  assert.equal(f.nodes.length, 1);
  socket.receive({ type: 'speech_stopped', turn: 1 }); socket.receive({ type: 'response_started', responseId: 'b', turn: 1 });
  socket.receive({ type: 'audio', responseId: 'b', turn: 1, itemId: 'j', audio });
  assert.equal(f.nodes.length, 2); assert.ok(f.nodes[1].at < 1, 'cancelled playout must not leave a silent queue gap');
  f.call.stop(); assert.equal(f.track.stops, 1); assert.equal(f.nodes[1].stopped, true); assert.equal(socket.closed, true); assert.equal(f.contexts[0].closed, true);
});

test('server hangup releases browser capture and audio without a disconnect error, even after local cancellation', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0];
  socket.receive({ type: 'ready' }); socket.receive({ type: 'response_started', responseId: 'bye', turn: 0 });
  socket.receive({ type: 'audio', responseId: 'bye', turn: 0, itemId: 'bye-item', audio });
  f.detector.options.onSpeech('speech_started');
  socket.receive({ type: 'call_ended', responseId: 'bye', turn: 0, reason: 'visitor-request' });
  assert.equal(f.call.active, false); assert.equal(f.track.stops, 1); assert.equal(f.detector.stops, 1);
  assert.equal(socket.closed, true); assert.equal(f.contexts[0].closed, true); assert.equal(f.nodes[0].stopped, true);
  assert.equal(f.events.at(-1).type, 'call_ended'); assert.ok(!f.events.some(event => event.type === 'error'));
  socket.receive({ type: 'audio', responseId: 'bye', turn: 0, itemId: 'late', audio });
  assert.equal(f.nodes.length, 1);
});

test('sentence-guided call suppresses model summary audio for that turn but keeps capture and later answers', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0]; socket.receive({ type: 'ready' });
  socket.receive({ type: 'response_started', responseId: 'tools', turn: 0 });
  socket.receive({ type: 'tool_end', responseId: 'tools', turn: 0, trace: { id: 'move', name: 'move_camera', status: 'done',
    result: { status: 'success', poi_id: 'eiffel', hotspot_ids: ['tower-feet'], sync_mode: 'sentence', dwell_seconds: 8 } } });
  socket.receive({ type: 'response_started', responseId: 'summary', turn: 0 });
  socket.receive({ type: 'answer', responseId: 'summary', turn: 0, text: '未播放的模型总结' });
  assert.equal(f.events.at(-1).audioSuppressed, true, 'the session must not archive this as heard narration');
  socket.receive({ type: 'audio', responseId: 'summary', turn: 0, itemId: 'summary-item', audio });
  assert.equal(f.nodes.length, 0, 'dedicated fixed narration owns the speaker');
  f.captures[0].port.onmessage({ data: new ArrayBuffer(640) });
  assert.equal(socket.sent.at(-1).byteLength, 640);
  assert.equal(f.call.active, true);
  socket.receive({ type: 'speech_started', turn: 1 });
  socket.receive({ type: 'speech_stopped', turn: 1 });
  socket.receive({ type: 'response_started', responseId: 'next', turn: 1 });
  socket.receive({ type: 'answer', responseId: 'next', turn: 1, text: '下一轮正常回答' });
  assert.equal(f.events.at(-1).audioSuppressed, undefined);
  socket.receive({ type: 'audio', responseId: 'next', turn: 1, itemId: 'next-item', audio });
  assert.equal(f.nodes.length, 1, 'later user turns keep normal native audio');
});

test('a long answer generated faster than realtime stays connected until actual playout drains', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0], context = f.contexts[0];
  socket.receive({ type: 'ready' }); socket.receive({ type: 'response_started', responseId: 'long', turn: 0 });
  // Reproduce a provider burst: 45 seconds generated while only five seconds play.
  for (let i = 0; i < 45; i++) {
    context.currentTime = i / 9;
    socket.receive({ type: 'audio', responseId: 'long', turn: 0, itemId: 'long-item', audio });
  }
  socket.receive({ type: 'response_done', responseId: 'long', turn: 0 }); await tick();
  assert.equal(f.call.active, true); assert.equal(f.nodes.length, 45);
  assert.ok(!f.events.some(event => event.type === 'error' || event.type === 'playback_done'));
  f.captures[0].port.onmessage({ data: new ArrayBuffer(640) });
  assert.equal(socket.sent.at(-1).byteLength, 640); assert.equal(f.track.stops, 0);
  context.currentTime = 46;
  for (const node of f.nodes.slice(0, -1)) node.onended();
  await tick(); assert.ok(!f.events.some(event => event.type === 'playback_done'));
  f.nodes.at(-1).onended(); await tick();
  assert.equal(f.events.at(-1).type, 'playback_done'); assert.equal(f.call.active, true);
});

test('barge-in clears a long completed-generation queue and the next answer plays without a silent gap', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0], context = f.contexts[0];
  socket.receive({ type: 'ready' }); socket.receive({ type: 'response_started', responseId: 'long', turn: 0 });
  for (let i = 0; i < 45; i++) socket.receive({ type: 'audio', responseId: 'long', turn: 0, itemId: 'long-item', audio });
  socket.receive({ type: 'response_done', responseId: 'long', turn: 0 });
  context.currentTime = 5;
  f.detector.options.onSpeech('speech_started'); await tick();
  assert.equal(f.call.active, true); assert.ok(f.nodes.every(node => node.stopped));
  const interruption = socket.sent.find(event => event.type === 'interrupt');
  assert.equal(interruption.responseId, 'long');
  assert.ok(Math.abs(interruption.played[0].audioEndMs - 4950) <= 1);
  assert.ok(!f.events.some(event => event.type === 'playback_done'));
  socket.receive({ type: 'speech_started', turn: 1 }); socket.receive({ type: 'speech_stopped', turn: 1 });
  socket.receive({ type: 'response_started', responseId: 'next', turn: 1 });
  socket.receive({ type: 'audio', responseId: 'next', turn: 1, itemId: 'next-item', audio });
  assert.equal(f.nodes.length, 46); assert.ok(f.nodes.at(-1).at < 5.1);
  socket.receive({ type: 'audio', responseId: 'long', turn: 0, itemId: 'long-item', audio });
  assert.equal(f.nodes.length, 46);
});

test('playout still bounds excessive queued audio across responses and releases call resources', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0]; socket.receive({ type: 'ready' });
  for (const id of ['first', 'continuation']) {
    socket.receive({ type: 'response_started', responseId: id, turn: 0 });
    for (let i = 0; i < 60; i++) socket.receive({ type: 'audio', responseId: id, turn: 0, itemId: id, audio });
    if (id === 'first') {
      socket.receive({ type: 'response_done', responseId: id, turn: 0, continuing: true });
      assert.equal(f.call.active, true);
    }
  }
  await tick();
  assert.equal(f.call.active, false); assert.equal(f.events.at(-1).code, 'audio-error');
  assert.equal(f.track.stops, 1); assert.equal(socket.closed, true); assert.equal(f.contexts[0].closed, true);
  assert.ok(f.nodes.filter(node => node.at !== undefined).every(node => node.stopped));
});

test('failed local VAD initialization still connects and streams with cloud VAD', async t => {
  const f = browserFixture(); t.after(() => f.call.stop());
  f.detector.ready = Promise.resolve(false);
  f.call.start({}); await tick();
  assert.equal(f.sockets.length, 1);
  f.sockets[0].receive({ type: 'ready' });
  f.captures[0].port.onmessage({ data: new ArrayBuffer(640) });
  assert.equal(f.sockets[0].sent.at(-1).byteLength, 640);
  assert.equal(f.events.at(-1).type, 'ready');
  assert.equal(f.track.stops, 0);
});

test('local VAD runtime failure does not hang up a connected call', async t => {
  const f = browserFixture(); t.after(() => f.call.stop());
  f.call.start({}); await tick(); f.sockets[0].receive({ type: 'ready' });
  f.detector.options.onError('WASM inference failed');
  f.captures[0].port.onmessage({ data: new ArrayBuffer(640) });
  assert.equal(f.call.active, true);
  assert.equal(f.track.stops, 0);
  assert.ok(!f.events.some(event => event.type === 'error'));
});

test('mute sends silence without reopening hardware; cancelling permission releases a late stream', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  f.sockets[0].receive({ type: 'ready' }); f.call.setMuted(true);
  f.captures[0].port.onmessage({ data: new Uint8Array(640).fill(7).buffer });
  assert.equal(f.track.enabled, false); assert.ok(new Uint8Array(f.sockets[0].sent.at(-1)).every(x => x === 0));
  assert.equal(f.detector.packets.length, 0); assert.equal(f.detector.resets, 1);
  f.detector.options.onSpeech('speech_started');
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'barge_in').length, 0);
  f.call.setMuted(false); assert.equal(f.track.enabled, true); assert.equal(f.captures.length, 1);
  const waiting = browserFixture({ pendingPermission: true }); waiting.call.start({}); waiting.call.stop(); waiting.grant(); await tick();
  assert.equal(waiting.track.stops, 1); assert.equal(waiting.sockets.length, 0);
});

test('local speech stops audio synchronously before any cloud onset and blocks an unseen old response', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0];
  socket.receive({ type: 'ready' });
  socket.receive({ type: 'response_started', responseId: 'old', turn: 0 });
  socket.receive({ type: 'audio', responseId: 'old', turn: 0, itemId: 'i', audio });
  f.detector.options.onSpeech('speech_started');
  assert.equal(f.nodes[0].stopped, true, 'stop in the VAD callback, no network round trip');
  assert.deepEqual(socket.sent.at(-1), { type: 'barge_in', turn: 0 });
  socket.receive({ type: 'response_started', responseId: 'late-old', turn: 0 });
  socket.receive({ type: 'audio', responseId: 'late-old', turn: 0, audio });
  assert.equal(f.nodes.length, 1);
  socket.receive({ type: 'speech_started', turn: 1 }); socket.receive({ type: 'speech_stopped', turn: 1 });
  socket.receive({ type: 'response_started', responseId: 'new', turn: 1 });
  socket.receive({ type: 'audio', responseId: 'new', turn: 1, audio });
  assert.equal(f.nodes.length, 2);
  socket.receive({ type: 'response_cancelled', responseId: 'old', turn: 0 });
  assert.notEqual(f.nodes[1].stopped, true);
  f.call.stop(); assert.equal(f.detector.stops, 1);
  f.detector.options.onSpeech('speech_started'); assert.equal(socket.sent.at(-1).type, 'hangup');
});

test('cloud-first onset does not let local confirmation cancel the answer to the same speech', async t => {
  const f = browserFixture(); t.after(() => f.call.stop()); f.call.start({}); await tick();
  const socket = f.sockets[0]; socket.receive({ type: 'ready' }); socket.receive({ type: 'speech_started', turn: 1 });
  f.detector.options.onSpeech('speech_started');
  assert.equal(socket.sent.filter(e => e.type === 'barge_in').length, 0);
  socket.receive({ type: 'speech_stopped', turn: 1 }); socket.receive({ type: 'response_started', turn: 1, responseId: 'a' });
  socket.receive({ type: 'audio', turn: 1, responseId: 'a', audio }); assert.equal(f.nodes.length, 1);
});

test('local barge-in cancels pending generation and cannot poison a later cloud turn', async t => {
  const f = await bridgeFixture(t);
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' });
  f.client.receive({ type: 'barge_in', turn: 1 });
  f.start('pending-old'); f.pcm('pending-old');
  assert.equal(f.upstream.sent.at(-1).type, 'response.cancel');
  assert.ok(!f.client.sent.some(e => e.responseId === 'pending-old'));
  f.upstream.receive({ type: 'response.function_call_arguments.done', response_id: 'pending-old', call_id: 'old-tool', name: 'plan_route', arguments: '{}' });
  f.upstream.receive({ type: 'response.done', response: { id: 'pending-old', status: 'completed' } });
  assert.ok(!f.client.sent.some(e => e.type === 'tool_end'));
  f.upstream.receive({ type: 'input_audio_buffer.speech_started' });
  f.client.receive({ type: 'barge_in', turn: 2 }); // cloud-first confirmation of the same speech
  f.upstream.receive({ type: 'input_audio_buffer.speech_stopped' }); f.start('new');
  const before = f.upstream.sent.length;
  f.client.receive({ type: 'barge_in', turn: 1 });
  assert.equal(f.upstream.sent.length, before);
  f.pcm('new'); assert.equal(f.client.sent.at(-1).responseId, 'new');
});

test('speech gate rejects clicks and brief noise while confirming sustained speech in 96ms', () => {
  const gate = createSpeechGate();
  for (const p of [.99, .1, .9, .9, .1, .3]) assert.equal(gate.process(p), null);
  assert.equal(gate.process(.8), null); assert.equal(gate.process(.9), null);
  assert.equal(gate.process(.95), 'speech_started');
  for (let i = 0; i < 7; i++) assert.equal(gate.process(.1), null);
  assert.equal(gate.process(.8), null, 'short pause keeps speech active');
  for (let i = 0; i < 7; i++) assert.equal(gate.process(.1), null);
  assert.equal(gate.process(.1), 'speech_stopped');
  gate.process(.9); gate.process(.9); gate.reset(); assert.equal(gate.process(.9), null);
});

test('worker detector drops pre-mute events, bounds backlog and cleans up initialization', async () => {
  let worker; const speech = [], errors = [];
  const scope = { setTimeout, clearTimeout, Worker: class {
    constructor() { worker = this; } sent = []; postMessage(e) { this.sent.push(e); } terminate() { this.stopped = true; }
  } };
  const detector = createCallVad({ scope, onSpeech: e => speech.push(e), onError: e => errors.push(e) });
  worker.onmessage({ data: { type: 'ready' } }); assert.equal(await detector.ready, true);
  const pcm = new ArrayBuffer(640); detector.push(pcm); assert.equal(pcm.byteLength, 640, 'upstream still owns capture');
  detector.reset(); worker.onmessage({ data: { type: 'speech_started', epoch: 0 } }); assert.deepEqual(speech, []);
  worker.onmessage({ data: { type: 'speech_started', epoch: 1 } }); assert.deepEqual(speech, ['speech_started']);
  for (let i = 0; i < 17; i++) detector.push(pcm);
  assert.equal(errors.length, 1); assert.equal(worker.stopped, true);
  const loading = createCallVad({ scope }); loading.stop(); assert.equal(await loading.ready, false);
});

test('duplex start and context updates omit large map geometry from outbound frames', async t => {
  const f = browserFixture(); t.after(() => f.call.stop());
  const state = { plannedRoute: { stops: [{ poiId: 'eiffel' }, { poiId: 'arc' }], geometry: { points: Array(6000).fill({ x: 50.12345, y: 60.12345 }) } } };
  f.call.start(state); await tick(); f.sockets[0].receive({ type: 'ready' }); f.call.updateContext(state);
  for (const event of f.sockets[0].sent.filter(e => e.context)) {
    assert.ok(JSON.stringify(event).length < 1000);
    assert.deepEqual(event.context.plannedRoute.stops, [{ poiId: 'eiffel' }, { poiId: 'arc' }]);
    assert.equal(event.context.plannedRoute.geometry, undefined);
  }
});

test('playout reports audio actually heard, excluding jitter gaps and device latency', async () => {
  const f = browserFixture(); const context = new f.scope.AudioContext();
  const player = createPcmPlayback(context, { scope: f.scope });
  player.append(audio, { itemId: 'i' }); context.currentTime = 2;
  player.append(audio, { itemId: 'i' }); context.currentTime = 2.55;
  assert.equal(player.played[0].audioEndMs, 1500);
  player.stop(); await player.done;
});

test('call state tracks true connection, sound cues, interruptions and redial without stale errors', async () => {
  const store = createStore(), cues = []; let emit, stops = 0;
  const call = createCallSession({ store, guide: { interrupt() {} }, sounds: { play: name => cues.push(name), stop() {}, dispose() {} },
    createTransport: ({ onEvent }) => { emit = onEvent; return { start() {}, stop() { stops++; }, interrupt() {}, setMuted() {} }; } });
  call.start(); assert.equal(store.get().callState, 'connecting'); assert.deepEqual(cues, ['dial']);
  emit({ type: 'ready', model: 'actual-model' }); assert.equal(store.get().callState, 'connected'); assert.equal(cues.at(-1), 'connected');
  emit({ type: 'answer', responseId: 'r', text: '尚未听完的内容' }); emit({ type: 'interrupted', responseId: 'r' });
  assert.equal(store.get().messages.at(-1).interrupted, true);
  call.toggleMute(); assert.equal(store.get().callMuted, true);
  assert.equal(callPresentation(store.get()).label, '麦克风已静音');
  call.stop(); emit({ type: 'ready' }); assert.equal(store.get().callState, 'idle'); assert.equal(cues.at(-1), 'ended');
  call.start(); assert.equal(store.get().callMuted, false); emit({ type: 'error', code: 'network', message: '网络已断开' });
  assert.equal(store.get().callState, 'error'); assert.equal(store.get().voiceSession, false);
  assert.equal(callPresentation(store.get()).hint, '网络已断开'); assert.ok(stops > 0); call.dispose();
});

test('a late arrival rejection cannot override thinking about the visitor question',()=>{
  const store=createStore({tourMode:'companion'});let emit;
  const call=createCallSession({store,guide:{interrupt(){}},sounds:{play(){},stop(){},dispose(){}},
    createTransport:({onEvent})=>{emit=onEvent;return{start(){},stop(){},updateContext(){},narrateLocation(){return true;}};}});
  call.start();emit({type:'ready'});assert.equal(call.narrateLocation('eiffel'),true);
  emit({type:'speech_started'});emit({type:'speech_stopped'});
  emit({type:'arrival',status:'skipped'});
  assert.equal(store.get().guideStatus,'thinking');call.dispose();
});

test('delayed sample loading cannot play a connected cue after hangup', async () => {
  const pending = [], played = [];
  const scope = {
    fetch: path => new Promise(resolve => pending.push(() => resolve({ ok: true, arrayBuffer: async () => path }))),
    AudioContext: class {
      destination = {}; async resume() {} async close() {} async decodeAudioData(path) { return { path }; }
      createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
      createBufferSource() { return { connect() {}, disconnect() {}, stop() {}, start() { played.push(this.buffer.path); } }; }
    },
  };
  const sounds = createCallSounds({ scope });
  const dial = sounds.play('dial'), connected = sounds.play('connected'), ended = sounds.play('ended');
  pending.forEach(resolve => resolve()); await Promise.all([dial, connected, ended]);
  assert.deepEqual(played, ['/assets/audio/call-ended.wav']); sounds.dispose();
});

test('model-requested hangup resets call state, plays ended once and permits redial', () => {
  const store = createStore(), cues = []; let emit, stops = 0;
  const call = createCallSession({ store, guide: { interrupt() {} }, sounds: { play: name => cues.push(name), stop() {}, dispose() {} },
    createTransport: ({ onEvent }) => { emit = onEvent; return { start() {}, stop() { stops++; }, interrupt() {}, setMuted() {} }; } });
  call.start(); emit({ type: 'ready' }); call.toggleMute();
  const trace = { id: 'hangup', name: 'hang_up', status: 'done', result: { status: 'success', action: 'hang_up' } };
  emit({ type: 'tool_end', trace }); emit({ type: 'call_ended', reason: 'visitor-request' });
  assert.equal(call.active, false); assert.equal(stops, 1);
  for (const [key, value] of Object.entries({ callState: 'idle', callMuted: false, callInput: 'off', voiceSession: false, guideStatus: 'idle', guideError: null, voiceErrorCode: null, cameraTour: null })) assert.equal(store.get()[key], value);
  assert.equal(store.get().guideTraces.at(-1).name, 'hang_up');
  emit({ type: 'call_ended' }); emit({ type: 'error', code: 'network', message: 'late' });
  assert.equal(cues.filter(cue => cue === 'ended').length, 1); assert.equal(store.get().guideError, null);
  call.start(); emit({ type: 'ready' }); assert.equal(call.active, true); assert.equal(store.get().callState, 'connected');
  call.dispose();
});

test('call cue files contain real non-clipping PCM samples with short tails', async () => {
  for (const name of ['dial', 'connected', 'ended']) {
    const wav = await readFile(new URL(`../public/assets/audio/call-${name}.wav`, import.meta.url));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    let data, bits, channels, sampleRate;
    for (let at = 12; at + 8 <= wav.length;) {
      const id = wav.toString('ascii', at, at + 4), length = wav.readUInt32LE(at + 4);
      if (id === 'fmt ') {
        sampleRate = wav.readUInt32LE(at + 12); bits = wav.readUInt16LE(at + 22); channels = wav.readUInt16LE(at + 10);
        assert.equal(sampleRate, 48000); assert.equal(channels, 2); assert.equal(bits, 24);
      }
      if (id === 'data') data = wav.subarray(at + 8, at + 8 + length);
      at += 8 + length + length % 2;
    }
    const width = bits / 8, fullScale = 2 ** (bits - 1);
    const samples = Array.from({ length: data.length / width }, (_, index) => data.readIntLE(index * width, width) / fullScale);
    const duration = samples.length / channels / sampleRate;
    assert.ok(duration > .25 && duration <= 1.1);
    let peak = 0, energy = 0, differenceEnergy = 0;
    for (let i = 0; i < samples.length; i++) {
      peak = Math.max(peak, Math.abs(samples[i])); energy += samples[i] ** 2;
      if (i >= channels) differenceEnergy += (samples[i] - samples[i - channels]) ** 2;
    }
    assert.ok(peak > .03 && peak < .7);
    assert.equal(duration, { dial: .72, connected: 1.05, ended: .9 }[name]);
    assert.ok(samples.some((value, i) => i % channels === 0 && value !== samples[i + 1]), 'retain real stereo recordings');
    assert.ok(differenceEnergy / energy < .02, 'upper harmonics must stay subdued, including the initial call-button cue');
    for (const edge of [samples.slice(0, 192), samples.slice(-192)]) {
      assert.ok(edge.every(value => Math.abs(value) < .002), 'soft entry and exit without clicks');
    }
  }
});

test('call-button dial recording plays at a restrained level, below the other cues', async () => {
  const levels = [];
  const scope = {
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    AudioContext: class {
      destination = {}; async resume() {} async close() {} async decodeAudioData() { return {}; }
      createGain() { return { gain: {}, connect() { levels.push(this.gain.value); }, disconnect() {} }; }
      createBufferSource() { return { connect() {}, disconnect() {}, stop() {}, start() {} }; }
    },
  };
  const sounds = createCallSounds({ scope });
  for (const name of ['dial', 'connected', 'ended']) await sounds.play(name);
  assert.deepEqual(levels, [.22, .32, .28]); sounds.dispose();
});

test('playback completion suppresses a late speaking notification after main-thread congestion', async () => {
  const f = browserFixture(); const context = new f.scope.AudioContext(); const callbacks = []; let starts = 0;
  const player = createPcmPlayback(context, { scope: { atob, setTimeout: fn => { callbacks.push(fn); return 1; }, clearTimeout() {} }, onStart: () => starts++ });
  player.append(audio); player.seal(); context.currentTime = 2;
  f.nodes[0].onended(); await player.done;
  callbacks[0](); assert.equal(starts, 0);
});
