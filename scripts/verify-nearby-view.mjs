import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { runAgent } from '../server/ai/llm.ts';

const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const { proxy } = await createProxy({ backendOptions: { env: { CHAT_API_KEY: 'test-only' },titleAgent:async()=> '园区周边景点', agent: input => {
  let round = 0;
  return runAgent({ ...input, complete: async () => !round++
    ? { choices: [{ message: { tool_calls: [{ id: 'around', function: { name: 'look_around', arguments: '{}' } }] } }] }
    : { choices: [{ message: { content: '以铁塔为中心，周围有这些景点；距离为估算直线距离。' } }] } });
} } });
let browser;
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/nearby', { recursive: true });
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['compact', { width: 360, height: 640 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
    await page.locator('#text-mode-button').click();
    await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({visitorOrigin:null,visitorOriginSource:'未获取位置'});});
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); store.set({ interactionInput: 'text', view: 'photo', selectedPoiId: 'eiffel' }); });
    await page.locator('#voice-input').fill('周围有什么');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.locator('.nearby-annotation').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.nearby-annotation img')].every(image => image.dataset.ready === 'true'));
    await page.waitForFunction(() => !document.querySelector('.nearby-view').getAnimations({ subtree: true }).some(animation => animation.playState === 'running'));
    await page.waitForFunction(() => {
      const transform = document.querySelector('.map-art').style.transform;
      if (window.nearbyTransform !== transform) { window.nearbyTransform = transform; window.nearbyStableSince = performance.now(); }
      return performance.now() - window.nearbyStableSince > 200;
    });
    assert.match(await page.locator('.nearby-origin').textContent(), /非游客定位/);
    assert.ok(await page.locator('.nearby-annotation').count() >= 2);
    assert.equal(await page.locator('.nearby-rail,.nearby-card,.nearby-header').count(), 0, 'no popup or photo rail');
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { map: rect('.map-viewport'), annotations: [...document.querySelectorAll('.nearby-annotation')].map(node => ({ ...node.getBoundingClientRect().toJSON(), hidden: node.hidden })), controls: rect('.map-controls'), dock: rect('.voice-dock') };
    });
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (const [i, annotation] of geometry.annotations.entries()) {
      assert.equal(annotation.hidden, false, `${label}: all nearby annotations must be visible after framing`);
      assert.ok(annotation.left >= geometry.map.left && annotation.right <= geometry.map.right && annotation.top >= geometry.map.top && annotation.bottom <= geometry.map.bottom, `${label}: annotation out of map ${JSON.stringify(geometry)}`);
      for (const other of [geometry.controls, geometry.dock, ...geometry.annotations.slice(i + 1)]) assert.equal(overlaps(annotation, other), false, `${label}: annotation overlaps controls or another annotation: ${JSON.stringify(geometry)}`);
    }
    assert.equal(await page.locator('.nearby-connections circle').count(), await page.locator('.nearby-annotation').count());
    await page.screenshot({ path: `agent-tmp/nearby/${label}.png` });
    // The annotation anchor must follow the map, rather than stay in a detached panel.
    const anchorBefore = await page.locator('.nearby-connections circle').first().getAttribute('cx');
    await page.locator('.map-viewport').focus(); await page.keyboard.press('ArrowRight');
    const anchorAfter = await page.locator('.nearby-connections circle').first().getAttribute('cx');
    assert.notEqual(anchorAfter, anchorBefore);
    await page.keyboard.press('ArrowLeft');
    const photo = page.locator('.nearby-annotation[data-photo="true"]').first();
    assert.ok(await photo.count(), 'nearby photos appear on map');
    await photo.click();
    await page.waitForFunction(() => document.querySelector('.nearby-view').hidden);
    assert.equal(await page.locator('.nearby-view').isVisible(), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js'); const { nearbyAttractions } = await import('/src/data/nearby-attractions.js');
      store.set({ view: 'map', introductionView: null, nearbyView: nearbyAttractions({ poiId: 'arc' }) });
    });
    await page.locator('.nearby-view').waitFor();
    assert.equal(await page.locator('.nearby-view').evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    await page.locator('.nearby-close').click();
    assert.equal(await page.locator('.nearby-view').isVisible(), false);
    await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js'); const { nearbyAttractions } = await import('/src/data/nearby-attractions.js');
      store.set({ nearbyView: nearbyAttractions({ visitorPosition: { latitude: 0, longitude: 0 } }) });
    });
    await page.waitForFunction(() => document.querySelector('.nearby-origin').textContent.includes('暂无已收录景点'));
    assert.equal(await page.locator('.nearby-annotation').count(), 0);
    await page.locator('.map-viewport').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.nearby-view').isVisible(), false);
    assert.deepEqual(errors, []); await page.close();
    console.log(`PASS ${label}: tool → anchored map labels/photos, no popup, no overlaps, scene handoff, reduced motion, empty state and dismissal`);
  }
} finally { await browser?.close(); await proxy.close(); }
