import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createProxy } from '../server/proxy.ts';
import { createRealtimeBridge } from '../server/ai/realtime.ts';
import { getPoi } from '../src/data/pois.js';
import { toCoordinates } from '../src/guide/location.js';

// Isolated protocol fixture. Production always connects to the configured real model.
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? process.env.PLAYWRIGHT_MODULE ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const upstreams = [];
class ModelSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; packets = 0; commands = [];
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw) {
    const event = JSON.parse(raw); this.commands.push(event);
    if (event.type === 'session.update') queueMicrotask(() => this.receive({ type: 'session.updated' }));
    if (event.type === 'input_audio_buffer.append') this.packets++;
    if(event.type==='response.create' && event.response?.instructions?.includes('通话接通事件'))queueMicrotask(()=>{
      this.receive({type:'response.created',response:{id:'opening'}});
      this.receive({type:'response.audio_transcript.done',response_id:'opening',item_id:'opening-text',transcript:'你好，我在！想听哪一处的故事？'});
      this.receive({type:'response.audio.delta',response_id:'opening',item_id:'opening-text',content_index:0,delta:Buffer.alloc(4800).toString('base64')});
      this.receive({type:'response.done',response:{id:'opening',status:'completed'}});
    });
  }
  terminate() { this.ended = true; this.readyState = 3; this.emit('close'); }
}
const { proxy } = await createProxy({ backendOptions: { env: { DASHSCOPE_API_KEY: 'test-only', CALL_LOG_DIR: 'agent-tmp/calls/journal-fixture' }, realtimeBridge: options =>
  createRealtimeBridge({ ...options, validateUrl: async url => new URL(url), connect: () => {
    const upstream = new ModelSocket(); upstreams.push(upstream);
    queueMicrotask(() => upstream.receive({ type: 'session.created' })); return upstream;
  } }),
} });
let browser;
const pcm = Buffer.alloc(48000);
for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 2 * 220) * 1500), i * 2);
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/calls', { recursive: true });
  const cases=[['mobile',{width:390,height:844},'interactive'],['desktop',{width:1280,height:900},'interactive'],
    ['companion-mobile',{width:390,height:844},'companion'],['companion-desktop',{width:1280,height:900},'companion']];
  for (const [label, viewport, mode] of cases.filter(row=>process.env.VIRTOUR_CALL_CASES!=='companion' || row[2]==='companion')) {
    const page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(position => {
      window.__streams = []; window.__audio = []; window.__geoWatches=0; window.__geoCleared=[];
      navigator.geolocation.watchPosition=callback=>{window.__geoWatches++;window.__geoCallback=callback;callback({coords:{...position,accuracy:5,heading:0}});return window.__geoWatches;};
      navigator.geolocation.clearWatch=id=>window.__geoCleared.push(id);
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => { const stream = await getUserMedia(options); window.__streams.push(stream); return stream; };
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function () {
        const source = createSource.call(this), row = { source, stopped: false, ended: false }; window.__audio.push(row);
        source.addEventListener('ended', () => { row.ended = true; });
        const stop = source.stop.bind(source); source.stop = (...args) => { row.stopped = true; return stop(...args); }; return source;
      };
    },toCoordinates(getPoi('eiffel').position));
    await page.goto(`${origin}/tour.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { window.__store = (await import('/src/guide/store.js')).store; });
    assert.equal(await page.evaluate(() => window.__streams.length), 0, 'entry must not request microphone access');
    assert.equal(await page.evaluate(()=>window.__geoWatches),0,'entry does not silently request GPS');
    assert.equal(await page.locator('#app').getAttribute('data-interaction'),'realtime');
    assert.equal(await page.locator('#live-call-button').isVisible(),false);
    await page.locator('#call-retry').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    assert.equal(await page.locator('#voice-form').isVisible(),false);
    assert.equal(await page.locator('#text-mode-button').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#live-call-button').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#call-info').evaluate(e=>getComputedStyle(e).position),'relative','voice status is inline, never a floating card');
    assert.equal(await page.locator('#call-info').evaluate(e=>Boolean(e.closest('.communication-surface'))),true);
    if(mode==='interactive') await page.waitForFunction(()=>getComputedStyle(document.querySelector('.call-wave i')).animationName!=='none');
    const sceneSize = await page.locator('.map-viewport').boundingBox();
    assert.ok(sceneSize.height > viewport.height * .6, 'real-time exchange must retain a full-height map');
    assert.equal(await page.locator('.app-header').isVisible(), true);
    const model = upstreams.at(-1);
    if(mode==='companion') {
      await page.waitForFunction(()=>window.__store.get().guideStatus==='thinking');
      assert.equal(await page.evaluate(()=>window.__geoWatches),0,'companion defaults to simulation, not a device permission request');
      assert.ok(model.commands.some(e=>e.type==='response.create' && /自由女神像/.test(e.response?.instructions)));
      await page.waitForFunction(()=>document.querySelector('.movement-trail .trail-line')?.getAttribute('d').includes('L'));
      assert.equal(await page.evaluate(()=>window.__store.get().visitorOriginSource),'模拟定位');
      assert.equal(await page.locator('#companion-listen,.companion-route-status').count(),0);
    }
    assert.match(model.commands.find(event => event.type === 'session.update').session.instructions, /不说“根据后台文档”/);
    await page.waitForFunction(() => window.__streams.length === 1 && window.__streams[0].getAudioTracks()[0].readyState === 'live');
    model.receive({ type: 'input_audio_buffer.speech_started' }); model.receive({ type: 'input_audio_buffer.speech_stopped' });
    const question='介绍一下凯旋门';
    model.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: question });
    model.receive({type:'response.created',response:{id:'image-tool'}});
    const photoPoi='arc';
    model.receive({type:'response.function_call_arguments.done',response_id:'image-tool',call_id:'simple-guidance',name:'introduce_view',arguments:JSON.stringify({poi_id:photoPoi})});
    model.receive({type:'response.done',response:{id:'image-tool',status:'completed'}});
    await page.waitForFunction(id=>window.__store.get().introductionView?.poiId===id,photoPoi);
    assert.equal(await page.locator('.introduction-photo').count(),1,'non-panorama guidance restores matched photographs');
    if(mode==='interactive')assert.equal(model.commands.filter(e=>e.type==='response.create'&&e.response?.instructions?.includes('通话接通事件')).length,1);
    model.receive({ type: 'response.created', response: { id: 'response-1' } });
    model.receive({ type: 'response.audio_transcript.done', response_id: 'response-1', item_id: 'answer-1', transcript: '从四个塔脚往上看，钢架线条逐渐向塔尖收拢。' });
    const before = model.packets;
    // Faster-than-realtime generation must not trip the old 30-second playout cap.
    // Drain each transport batch so this tests playback buffering, not network backpressure.
    for (let batch = 0; batch < 9; batch++) {
      for (let i = 0; i < 5; i++) model.receive({ type: 'response.audio.delta', response_id: 'response-1', item_id: 'answer-1', content_index: 0, delta: pcm.toString('base64') });
      await page.waitForFunction(count => window.__audio.filter(row => row.source.buffer?.sampleRate === 24000).length >= count, (batch + 1) * 5);
    }
    model.receive({ type: 'response.done', response: { id: 'response-1', status: 'completed' } });
    await page.waitForFunction(() => window.__store.get().guideStatus === 'speaking');
    assert.notEqual(await page.locator('.call-wave i').first().evaluate(e=>getComputedStyle(e).animationName),'none');
    assert.equal(await page.evaluate(() => window.__store.get().callState), 'connected');
    await page.screenshot({ path: `agent-tmp/calls/${label}-speaking.png` });
    assert.ok(model.packets > before, 'mic must continue sending while the model plays');
    model.receive({ type: 'input_audio_buffer.speech_started' });
    await page.waitForFunction(() => window.__audio.filter(row => row.source.buffer?.sampleRate === 24000).every(row => row.stopped || row.ended));
    assert.ok(model.commands.some(e => e.type === 'conversation.item.truncate' && e.item_id === 'answer-1'));
    await page.waitForFunction(() => window.__store.get().callInput === 'speaking');
    model.receive({ type: 'response.audio.delta', response_id: 'response-1', item_id: 'answer-1', content_index: 0, delta: pcm.toString('base64') });
    await page.locator('#call-options-button').click();
    await page.locator('#call-mute').click();
    assert.equal(await page.locator('#call-mute').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__streams[0].getAudioTracks()[0].enabled), false);
    await page.screenshot({ path: `agent-tmp/calls/${label}-muted.png` });
    await page.locator('#call-mute').click();
    assert.equal(await page.evaluate(() => window.__streams[0].getAudioTracks()[0].enabled), true);
    const hitTargets = await page.locator('#call-end, #call-mute').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && node.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
    }));
    assert.ok(hitTargets.every(Boolean), `${label}: call controls must be visible and tappable`);
    await page.locator('#call-end').click();
    await page.waitForFunction(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    await page.locator('#call-retry').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    assert.equal(await page.evaluate(() => window.__streams.length), 2);
    upstreams.at(-1).terminate();
    await page.waitForFunction(() => window.__store.get().callState === 'error');
    assert.equal(await page.locator('#call-retry').isVisible(), true);
    await page.screenshot({ path: `agent-tmp/calls/${label}-disconnected.png` });
    await page.locator('#call-retry').click();
    await page.waitForFunction(() => window.__store.get().callState === 'connected');
    if(mode==='interactive'){
      await page.locator('#text-mode-button').click();
      await page.waitForFunction(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
      assert.equal(await page.locator('#app').getAttribute('data-workspace'),'split');
      assert.equal(await page.locator('#voice-input').evaluate(e=>e===document.activeElement),false);
      assert.equal(await page.locator('#live-call-button').getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('#call-info').isVisible(),false);
      assert.equal(await page.locator('#conversation-log .conversation-message').count(),0,'opening text creates a new conversation');
      await page.locator('#conversation-history').click();
      assert.match(await page.locator('#history-list').innerText(),/语音/);
      await page.locator('[data-history-id]').filter({hasText:'凯旋门'}).first().click();
      assert.equal(await page.locator('#conversation-log').getByText(question,{exact:true}).isVisible(),true);
      await page.locator('#live-call-button').click();
      await page.waitForFunction(() => window.__store.get().callState==='connected');
    }else{
      assert.equal(await page.locator('#text-mode-button').isVisible(),false);
      assert.equal(await page.locator('#voice-form').isVisible(),false);
      await page.locator('#call-options-button').click();
      await page.locator('#call-history').click();
      assert.match(await page.locator('#history-list').innerText(),/伴游/);
      await page.locator('[data-history-id]').filter({hasText:'凯旋门'}).first().click();
      assert.equal(await page.locator('#conversation-log').getByText(question,{exact:true}).isVisible(),true);
      assert.equal(await page.locator('#app').getAttribute('data-tour-mode'),'interactive','history opens the normal interactive conversation');
      assert.equal(await page.locator('#history-continue').count(),0);
      await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
      await page.locator('#call-retry').click();
      await page.waitForFunction(()=>window.__store.get().callState==='connected');
      await page.locator('#map-settings-button').click();
      await page.locator('select[data-source]').selectOption('device');
      assert.equal(await page.evaluate(()=>window.__geoWatches),1,'only explicit device selection requests GPS');
      await page.locator('[data-done]').click();
    }
    assert.equal(await page.locator('#app').getAttribute('data-workspace'), 'map');
    assert.equal(await page.locator('#conversation-panel').isVisible(), false);
    if(mode==='companion') {
      const last=upstreams.at(-1);
      last.receive({type:'input_audio_buffer.speech_started'});last.receive({type:'input_audio_buffer.speech_stopped'});
      last.receive({type:'response.created',response:{id:'bye'}});
      last.receive({type:'response.function_call_arguments.done',response_id:'bye',call_id:'hangup',name:'hang_up',arguments:'{}'});
      last.receive({type:'response.done',response:{id:'bye',status:'completed'}});
    } else await page.locator('#call-end').click();
    await page.waitForFunction(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    if(mode==='companion') {
      await page.waitForFunction(()=>window.__store.get().companionPaused);
      assert.equal(await page.evaluate(()=>window.__geoCleared.length>=window.__geoWatches),true,'spoken ending also releases GPS');
    }
    assert.equal(await page.locator('#app').getAttribute('data-interaction'), 'realtime','ending a call does not silently change the selected input mode');
    // WAV decoding and cue playback are exercised by real Web Audio, without autoplay bypass.
    assert.ok(await page.evaluate(() => window.__audio.some(row => row.source.buffer?.duration > .5 && row.source.buffer?.sampleRate !== 24000)), 'connected sample was decoded and played');
    assert.deepEqual(errors, []); await page.close();
    console.log(`${label}: silent entry, tourist-facing prompt, full-duplex packets, 45-second burst, interruption, mute, samples, hangup, redial, failure recovery and voice/text transitions OK`);
  }
} finally { await browser?.close(); await proxy.close(); }
