import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { runAgent } from '../server/ai/llm.ts';
import { executeTool } from '../server/ai/tools.ts';
import { routePath } from '../src/components/planned-route.js';

// Isolated test model, never a production fallback or a request to a paid provider.
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const routeArgs = {
  title: '欧洲建筑三地标：斗兽场—凯旋门—铁塔',
  summary: '先看古罗马建筑的拱券结构，再欣赏凯旋门，最后看铁塔轮廓。'.repeat(5),
  stops: [{ poi_id: 'colosseum', reason: '欣赏连续拱券' }, { poi_id: 'arc', reason: '观察中央大拱门' }, { poi_id: 'eiffel', reason: '观察塔身轮廓' }],
};
const trace = { id: 'voice-route', name: 'plan_route', args: routeArgs, result: executeTool('plan_route', routeArgs), status: 'done', duration: 1 };
const { proxy } = await createProxy({ backendOptions: { env: { CHAT_API_KEY: 'test-only', DASHSCOPE_API_KEY: 'test-only' },
  titleAgent:async()=> '世界之窗游览路线',
  agent: input => {
    if (input.messages.at(-1).content.includes('失败')) throw new Error('Intentional test failure');
    let round = 0;
    return runAgent({ ...input, complete: async () => {
      if (round++ === 0) return { choices: [{ message: { tool_calls: [{ id: 'lookup', function: { name: 'search_knowledge_base', arguments: '{"query":"欧洲区 建筑路线"}' } }] } }] };
      if (round === 2) return { choices: [{ message: { tool_calls: [{ id: 'plan', function: { name: 'plan_route', arguments: JSON.stringify(routeArgs) } }] } }] };
      return { choices: [{ message: { content: '建议按斗兽场、凯旋门、铁塔的顺序游览。路线沿手绘底图的道路作示意。' } }] };
    } });
  },
  voiceAgent: async ({ onEvent }) => {
    onEvent({ type: 'tool_end', trace });
    onEvent({ type: 'audio_delta', audio: Buffer.alloc(4800).toString('base64'), sampleRate: 24000 });
    return { content: '语音路线建议已生成。', traces: [trace] };
  },
} });
let browser;
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/routes', { recursive: true });
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const requests = []; page.on('request', request => { if (/\/api\/(guide|voice)$/.test(request.url()) && request.method() === 'POST') requests.push(request.postDataJSON()); });
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
    await page.locator('#text-mode-button').click();
    await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js'); store.set({ interactionInput: 'text' });
      // Record the real camera each frame, including the transition's start.
      window.routeCameraSamples = [];
      const sample = () => {
        window.routeCameraSamples.push({ time: performance.now(), transform: document.querySelector('.map-art').style.transform });
        window.routeCameraFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    await page.locator('#voice-input').fill('规划斗兽场、凯旋门和铁塔的游览路线');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.locator('.planned-route-line').waitFor({ state: 'visible' });
    const displayedRoute=await page.evaluate(async()=>(await import('/src/guide/store.js')).store.get().plannedRoute);
    assert.equal(await page.locator('.planned-route-card').count(), 0, 'route must be drawn on the map without a popup');
    assert.deepEqual(await page.locator('[data-route-step]').evaluateAll(nodes => nodes.sort((a, b) => Number(a.dataset.routeStep) - Number(b.dataset.routeStep)).map(node => node.dataset.poi)), ['colosseum', 'arc', 'eiffel']);
    assert.equal(await page.locator('.route-stop').count(), 3);
    const routeLine = page.locator('.planned-route-line path:not(.route-line-halo)');
    await page.waitForFunction(() => document.querySelector('.planned-route-line').dataset.drawing === 'true' && document.querySelector('.route-arrived'));
    assert.equal(await page.locator('.route-arrived').first().getAttribute('data-poi'), 'colosseum', 'numbered stops must arrive in the model-selected order');
    assert.ok(await page.locator('.route-arrived').count() < 3, 'route must be revealed progressively');
    // Updating the conversation must not restart the active route animation.
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); store.set({ guideText: '正在绘制游览路线' }); });
    await page.waitForFunction(full => {
      const path = document.querySelector('.planned-route-line path:not(.route-line-halo)');
      const reference = path.cloneNode(); reference.setAttribute('d', full);
      const ratio = path.getTotalLength() / reference.getTotalLength();
      return ratio > .5 && ratio < 1;
    }, routePath(displayedRoute));
    await page.screenshot({ path: `agent-tmp/routes/${label}-drawing.png` });
    await page.waitForFunction(() => document.querySelector('.planned-route-line').dataset.drawing === 'false');
    assert.equal(await page.locator('.route-arrived').count(), 3);
    const d = await routeLine.getAttribute('d'); assert.match(d, /^M.* L.* L/);
    assert.match(await page.locator('.planned-route-label').textContent(), /3站游览/);
    assert.equal(d, routePath(displayedRoute), 'completed path must include all projected road vertices and the configured origin');
    const camera = await page.evaluate(() => { cancelAnimationFrame(window.routeCameraFrame); return window.routeCameraSamples; });
    const poses = [...new Set(camera.map(sample => sample.transform))];
    assert.ok(poses.length >= 10, `${label}: route camera must interpolate across frames, not jump (${poses.length} poses)`);
    const moving = camera.filter((sample, i) => i && sample.transform !== camera[i - 1].transform);
    assert.ok(moving.at(-1).time - moving[0].time >= 650, `${label}: camera must ease for about 900ms`);
    // Refit from a different zoom; the bubbled control click must not cancel it.
    await page.locator('[data-map-action="zoom-in"]').click();
    const beforeRefit = await page.locator('.map-art').evaluate(node => node.style.transform);
    await page.locator('[data-route-action="fit"]').click();
    assert.equal(await page.locator('.planned-route-line').getAttribute('data-drawing'), 'false', 'fitting the map must not replay the drawing');
    await page.waitForFunction(before => document.querySelector('.map-art').style.transform !== before, beforeRefit);
    await page.evaluate(() => new Promise(resolve => {
      const started = performance.now();
      const settle = now => now - started >= 1000 ? resolve() : requestAnimationFrame(settle);
      requestAnimationFrame(settle);
    }));
    assert.notEqual(await page.locator('.map-art').evaluate(node => node.style.transform), beforeRefit);
    const lineStyle = await routeLine.evaluate(path => ({ stroke: getComputedStyle(path).stroke, width: path.getBoundingClientRect().width, height: path.getBoundingClientRect().height }));
    assert.equal(lineStyle.stroke, 'rgb(69, 107, 134)');
    assert.ok(lineStyle.width > 0 && lineStyle.height > 0);
    const fits = await routeLine.evaluate(path => {
      const line = path.getBoundingClientRect(), map = document.querySelector('.map-viewport').getBoundingClientRect();
      return line.left >= map.left && line.right <= map.right && line.top >= map.top && line.bottom <= map.bottom;
    });
    assert.ok(fits, 'fit must include road detours, not only stop coordinates');
    const visible = await page.locator('.route-stop').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return { id: node.dataset.poi, visible: target?.closest('[data-poi]') === node, x, y, coveredBy: target?.outerHTML.slice(0, 160) };
    }));
    await page.screenshot({ path: `agent-tmp/routes/${label}.png` });
    assert.ok(visible.every(item => item.visible), `${label}: a route marker is covered by a panel: ${JSON.stringify(visible)}`);
    await page.locator('#voice-input').fill('规划失败的路线');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#conversation-log').textContent.includes('暂时没连上导游'));
    assert.equal(await routeLine.getAttribute('d'), d);
    await page.locator('.map-poi[data-poi="eiffel"]').click();
    await page.locator('#panorama-scene').waitFor({ state: 'visible' });
    await page.locator('#voice-input').fill('返回地图');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.locator('.planned-route-line').waitFor({ state: 'visible' });
    await page.locator('[data-route-action="clear"]').click();
    assert.equal(await page.locator('.planned-route-line').isVisible(), false);
    assert.equal(await page.locator('.route-stop').count(), 0);
    // Exercise the real native service and controller against the isolated backend stream.
    const result = await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js');
      const { createGuideController } = await import('/src/guide/controller.js');
      const { createTourActions } = await import('/src/guide/tour-actions.js');
      const { createNativeVoiceService } = await import('/src/services/native-voice.js');
      const speech = createNativeVoiceService({ browserSpeech: { stopSpeaking() {}, stopRecognition() {} } });
      const guide = createGuideController({ store, actions: createTourActions(store), speech });
      const result = await guide.submitAudio(btoa('\0'.repeat(6400)));
      guide.dispose(); speech.dispose(); return result;
    });
    assert.equal(result.status, 'executed');
    await page.locator('.planned-route-line').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.route-stop').count(), 3);
    // Clear an active drawing: no late frame may restore the line or its badges.
    await page.waitForFunction(() => document.querySelector('.planned-route-line').dataset.drawing === 'true');
    await page.locator('[data-route-action="clear"]').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await routeLine.getAttribute('d'), '');
    assert.equal(await page.locator('.route-arrived').count(), 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async route => { const { store } = await import('/src/guide/store.js'); store.set({ plannedRoute: route }); }, trace.result.route);
    await page.waitForFunction(() => document.querySelector('.route-arrived') && document.querySelector('.planned-route-line').dataset.drawing === 'false');
    assert.equal(await page.locator('.route-arrived').count(), 3);
    assert.equal(await page.locator('.route-drawing-head').isVisible(), false);
    assert.equal(await page.locator('.route-arrived').first().evaluate(node => getComputedStyle(node, '::after').animationName), 'none');
    assert.ok(requests.some(request => request.context?.plannedRoute?.stops.length === 3));
    assert.ok(requests.every(request => !request.context?.plannedRoute?.geometry), 'text and voice follow-ups must not upload road geometry');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${label}: backend tools, progressive route drawing and ordered badges, no popup or replay, fit, cancellation, reduced motion, failure retention, POI navigation and native voice.`);
  }
} finally { await browser?.close(); await proxy.close(); }
