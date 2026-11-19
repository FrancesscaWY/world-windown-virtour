import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { runAgent } from '../server/ai/llm.ts';
import { narrationSegments } from '../server/ai/tts.ts';
import { panoramaHotspots } from '../src/data/panorama-hotspots.js';
import { panoramaNarration } from '../src/guide/panorama-narration.js';

const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const { proxy } = await createProxy({ backendOptions: { env: { CHAT_API_KEY: 'test-only', DASHSCOPE_API_KEY: 'test-only' },
  titleAgent:async()=> '铁塔全景细节',
  // Deliberately return all PCM at once. Only speaker time may advance the camera.
  ttsAgent: async ({ text, onEvent }) => {
    for (const segment of narrationSegments(text)) onEvent({ type: 'audio_delta', audio: Buffer.alloc(57600).toString('base64'), sampleRate: 24000, charIndex: segment.charIndex });
  }, agent: input => {
  let round = 0;
  return runAgent({ ...input, complete: async () => {
    const name = round++ === 0 ? 'get_detailed_attraction_guidance' : round === 2 ? 'move_camera' : null;
    if (name) return { choices: [{ message: { tool_calls: [{ id: `tool-${round}`, function: { name,
      arguments: JSON.stringify(name === 'move_camera' ? { poi_id: 'eiffel', hotspot_ids: ['tower-feet', 'tower-arch', 'tower-spire', 'garden-shade'], dwell_seconds: 3 } : { poi_id: 'eiffel' }) } }] } }] };
    return { choices: [{ message: { content: '先看铁塔舒展的塔脚，宽阔的底部衬托出逐渐收拢的轮廓。' } }] };
  } });
} } });
let browser;
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/panorama-guidance', { recursive: true });
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
    await page.locator('#text-mode-button').click();
    await page.locator('#voice-input').waitFor();
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); window.__tourStore = store; store.set({ interactionInput: 'text' }); });
    await page.locator('#voice-input').fill('详细讲解铁塔，带我看不同的点');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector('#panorama-scene').hidden && document.querySelector('#panorama-canvas').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('[data-hotspot]').count(), 4);
    await page.locator('#panorama-narration-start').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(async () => (await import('/src/guide/store.js')).store.get().cameraSentence), null);
    await page.evaluate(async () => {
      window.sentenceLog = [];
      window.transcriptLog = [];
      const { store } = await import('/src/guide/store.js');
      store.subscribe(state => {
        const row = state.messages.at(-1);
        window.transcriptLog.push({ tour: Boolean(state.cameraTour), status: state.guideStatus,
          chars: row?.text.length, partial: row?.partial, interrupted: row?.interrupted });
        if (state.cameraSentence && window.sentenceLog.at(-1)?.charIndex !== state.cameraSentence.charIndex)
          window.sentenceLog.push({ ...state.cameraSentence, at: performance.now() });
      });
    });
    await page.locator('#panorama-narration-start').click();
    for (const [index, title] of ['舒展的塔脚', '拱形与钢架', '向上收拢的塔身', '塔旁绿荫'].entries()) {
      await page.waitForFunction(title => document.querySelector('#panorama-point-title').textContent === title, title);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-hotspot][aria-pressed="true"]')].some(node => !node.hidden));
      // A visible, centered hotspot confirms spherical projection and camera targeting agree.
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-hotspot][aria-pressed="true"]');
        const canvas = document.querySelector('#panorama-canvas').getBoundingClientRect();
        const rect = node?.getBoundingClientRect();
        return rect && Math.abs(rect.x + rect.width / 2 - canvas.x - canvas.width / 2) < 3 && Math.abs(rect.y + rect.height / 2 - canvas.y - canvas.height / 2) < 3;
      });
      await page.screenshot({ path: `agent-tmp/panorama-guidance/${label}-${index}.png` });
      assert.ok(await page.locator('#panorama-point-body mark').count(), 'current sentence is highlighted');
    }
    assert.ok(await page.locator('#panorama-point-info').isVisible());
    const geometry = await page.locator('#panorama-point-info').boundingBox();
    assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= viewport.width);
    const expected=panoramaHotspots.eiffel.reduce((count,point)=>count+narrationSegments(point.body).length,0);
    await page.waitForFunction(count=>window.sentenceLog.length>=count,expected);
    const log = await page.evaluate(() => window.sentenceLog);
    assert.equal(log.length,expected,'every current-script sentence starts on actual speaker time');
    for (let i = 1; i < log.length; i++) assert.ok(log[i].at - log[i - 1].at > 700, 'buffer receipt must not trigger early sentence changes');
    await page.waitForFunction(() => window.__tourStore.get().cameraTour === null);
    const script = panoramaNarration({ poiId: 'eiffel', hotspotIds: ['tower-feet', 'tower-arch', 'tower-spire', 'garden-shade'] });
    const finalState = await page.evaluate(async () => {
      const state = (await import('/src/guide/store.js')).store.get();
      return { row: state.messages.at(-1), tour: state.cameraTour, error: state.guideError, log: window.transcriptLog.slice(-10) };
    });
    assert.equal(finalState.row.text, script.text, JSON.stringify(finalState));
    await page.waitForFunction(text => {
      const history = JSON.parse(localStorage.getItem('virtour.conversations.v1') || '{}');
      return history.conversations?.find(row => row.id === window.__tourStore.get().conversationId)?.messages.at(-1).text === text;
    }, script.text);
    // A clicked hotspot uses reviewed story text, not the obsolete illustration disclaimer.
    await page.locator('[data-hotspot="garden-shade"]').click();
    assert.equal(await page.locator('#panorama-point-title').textContent(),'塔旁绿荫');
    assert.doesNotMatch(await page.locator('#guide-caption').textContent(), /原创测试画面/);
    await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js');
      const { toolEffect } = await import('/src/guide/tool-effects.js');
      store.set(toolEffect({ id: 'again', name: 'move_camera', status: 'done', result: { status: 'success', poi_id: 'eiffel', hotspot_ids: ['tower-arch', 'garden-shade'], dwell_seconds: 3, sync_mode: 'sentence' } }));
    });
    await page.locator('#panorama-narration-start').click();
    await page.waitForFunction(() => {
      const sentence = window.__tourStore.get().cameraSentence;
      return sentence?.hotspotId === 'tower-arch' && sentence.charIndex > 0;
    });
    await page.locator('#panorama-canvas').dispatchEvent('pointerdown', { pointerId: 99, pointerType: 'touch', clientX: 120, clientY: 150 });
    assert.equal(await page.evaluate(async () => (await import('/src/guide/store.js')).store.get().cameraTour), null);
    const interrupted = await page.evaluate(async () => (await import('/src/guide/store.js')).store.get().messages.at(-1));
    assert.equal(interrupted.interrupted, true); assert.equal(interrupted.partial, false);
    assert.ok(!interrupted.text.includes(panoramaHotspots.eiffel.find(point => point.id === 'garden-shade').body));
    assert.match(interrupted.text, /当前句未完整播完/);
    await page.locator('#panorama-back-map').click();
    assert.equal(await page.locator('#panorama-scene').isVisible(), false);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${label}: sentence-timed PCM, four camera targets, consent, actual-script history and conservative interruption transcript`);
  }
} finally { await browser?.close(); await proxy.close(); }
