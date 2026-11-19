import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { runAgent } from '../server/ai/llm.ts';

const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const { proxy } = await createProxy({ backendOptions: { env: { CHAT_API_KEY: 'test-only' },titleAgent:async()=> '凯旋门建筑与景点看图', agent: input => {
  let round = 0;
  return runAgent({ ...input, complete: async () => {
    if (!round++) return { choices: [{ message: { tool_calls: [{ id: 'introduce', function: { name: 'introduce_view', arguments: '{"poi_id":"arc"}' } }] } }] };
    return { choices: [{ message: { content: '看看凯旋门中央的拱门和立面的层次。' } }] };
  } });
} } });
let browser;
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  await mkdir('agent-tmp/introduction', { recursive: true });
  for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['compact', { width: 360, height: 640 }], ['desktop', { width: 1280, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'domcontentloaded' });
    await page.locator('#text-mode-button').click();
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); store.set({ interactionInput: 'text', view: 'photo', selectedPoiId: 'arc' }); });
    await page.locator('#voice-input').fill('凯旋门有什么看点');
    await page.locator('#voice-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('.introduction-view')?.dataset.phase === 'travel' && !document.querySelector('.introduction-view').hidden);
    const before = await page.locator('.map-art').evaluate(node => node.style.transform);
    await page.waitForFunction(() => document.querySelector('.introduction-view')?.dataset.phase === 'open');
    const after = await page.locator('.map-art').evaluate(node => node.style.transform);
    assert.notEqual(after, before, 'camera should travel before images unfold');
    await page.waitForFunction(() => [...document.querySelectorAll('.introduction-photo img')].every(image => image.complete && image.naturalWidth > 0));
    await page.locator('.introduction-photo img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.waitForFunction(() => !document.querySelector('.introduction-view').getAnimations({ subtree: true }).some(animation => animation.playState === 'running'));
    assert.ok(await page.locator('.introduction-photo img').evaluateAll(images => images.every(image => {
      return image.getBoundingClientRect().height >= 38 && getComputedStyle(image.nextElementSibling).position === 'static';
    })), 'compact photos must retain a visible, unoccluded image, not only captions');
    assert.equal(await page.locator('.introduction-photo').count(), 1);
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { map: rect('.map-viewport'), dock: rect('.voice-dock'), controls: rect('.map-controls'), center: rect('.introduction-center'),
        cards: [...document.querySelectorAll('.introduction-photo')].map(node => node.getBoundingClientRect().toJSON()) };
    });
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    await page.screenshot({ path: `agent-tmp/introduction/${label}.png` });
    for (const [i, card] of geometry.cards.entries()) {
      assert.ok(card.left >= geometry.map.left && card.right <= geometry.map.right && card.top >= geometry.map.top && card.bottom <= geometry.map.bottom, `${label}: card outside map: ${JSON.stringify(geometry)}`);
      for (const other of [geometry.controls, geometry.dock, geometry.center, ...geometry.cards.slice(i + 1)]) assert.equal(overlaps(card, other), false, `${label}: photos overlap controls, center or each other: ${JSON.stringify(geometry)}`);
    }
    await page.screenshot({ path: `agent-tmp/introduction/${label}.png` });
    await page.locator('.introduction-close').click();
    assert.equal(await page.locator('.introduction-view').isVisible(), false);
    // Reduced motion, repeated calls and interrupted flights share the same state path.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); store.set({ selectedPoiId:'eiffel',introductionView: { poiId: 'eiffel' } }); });
    await page.waitForFunction(() => document.querySelector('.introduction-view').dataset.phase === 'open');
    assert.equal(await page.locator('.introduction-view').evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    await page.setViewportSize({ width: 844, height: 650 });
    await page.locator('.map-viewport').focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.introduction-view').isVisible(), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async () => { const { store } = await import('/src/guide/store.js'); store.set({ introductionView: { poiId: 'eiffel' } }); });
    await page.locator('[data-map-action="reset"]').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.introduction-view').isVisible(), false);
    await page.waitForFunction(()=>document.querySelector('.map-zoom').textContent==='100%');
    assert.deepEqual(errors, []);
    await page.close(); console.log(`PASS ${label}: non-panorama tool, scene switch, camera flight, local photos, safe layout, dismissal, reduced motion and cancellation`);
  }
} finally { await browser?.close(); await proxy.close(); }
