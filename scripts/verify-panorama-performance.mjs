import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createProxy } from '../server/proxy.ts';

const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const { proxy } = await createProxy({ backendOptions: { env: {} } });
let browser;
try {
  const origin = await proxy.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  for (const [label, viewport, faceSize, budget] of [
    ['mobile', { width: 390, height: 844 }, 1024, 2_000_000],
    ['desktop', { width: 1280, height: 900 }, 2048, 6_000_000],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 3 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/tour.html?mode=interactive`, { waitUntil: 'networkidle' });
    const metrics = await page.evaluate(async () => {
      const { store } = await import('/src/guide/store.js');
      const canvas = document.querySelector('#panorama-canvas');
      let draws = 0, layouts = 0, textureDeletes = 0;
      const uploads = [];
      const prototype = WebGLRenderingContext.prototype;
      const draw = prototype.drawArrays, upload = prototype.texImage2D, remove = prototype.deleteTexture;
      prototype.drawArrays = function(...args) { draws++; return draw.apply(this, args); };
      prototype.texImage2D = function(...args) {
        const image = args.at(-1);
        uploads.push([image.naturalWidth ?? image.width, image.naturalHeight ?? image.height]);
        return upload.apply(this, args);
      };
      prototype.deleteTexture = function(...args) { textureDeletes++; return remove.apply(this, args); };
      const rect = canvas.getBoundingClientRect.bind(canvas);
      canvas.getBoundingClientRect = () => { layouts++; return rect(); };
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const start = performance.now();
      store.set({ interactionInput: 'text', view: 'panorama', selectedPoiId: 'eiffel' });
      const deadline = start + 15000;
      while (canvas.getAttribute('aria-busy') !== 'false') {
        if (performance.now() > deadline) throw new Error('Panorama failed to become ready');
        await frame();
      }
      await frame();
      const loadMs = Math.round(performance.now() - start);
      const resources = performance.getEntriesByType('resource').filter(e => e.name.includes('/panoramas/'));
      const bytes = resources.reduce((sum, e) => sum + e.encodedBodySize, 0);
      draws = 0; layouts = 0;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }));
      for (let i = 0; i < 120; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100 + i, clientY: 100 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      await frame();
      const burst = { draws, layouts };
      const buffer = [canvas.width, canvas.height];
      for (let i = 0; i < 4; i++) await frame();
      const idleDraws = draws - burst.draws;
      const visibleHotspots = [...document.querySelectorAll('[data-hotspot]')].filter(node => !node.hidden);
      const transformPositioned = visibleHotspots.length > 0 && visibleHotspots.every(node => node.style.transform.startsWith('translate3d('));
      store.set({ view: 'map' });
      await frame();
      const afterExit = draws;
      // Switching scenes must remove input handlers, not just hide the canvas.
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }));
      await frame();
      return { loadMs, bytes, requests: resources.map(e => e.name), uploads, buffer, burst, idleDraws,
        transformPositioned, textureDeletes, releasedBuffer: [canvas.width, canvas.height], drawsAfterExit: draws - afterExit };
    });
    assert.equal(metrics.requests.length, 6);
    assert.ok(metrics.requests.every(url => url.endsWith(`-${faceSize}.jpg`)), 'only the selected derivative is downloaded');
    assert.ok(metrics.bytes > 0 && metrics.bytes < budget);
    assert.deepEqual(metrics.uploads, Array.from({ length: 6 }, () => [faceSize, faceSize]));
    assert.equal(metrics.burst.draws, 1, '120 input events coalesce into a single render');
    assert.equal(metrics.burst.layouts, 0, 'no synchronous viewport reads in the input/render path');
    assert.equal(metrics.idleDraws, 0);
    assert.ok(metrics.buffer[0] * metrics.buffer[1] <= 2_000_000);
    assert.equal(metrics.transformPositioned, true);
    assert.equal(metrics.textureDeletes, 1);
    assert.deepEqual(metrics.releasedBuffer, [1, 1]);
    assert.equal(metrics.drawsAfterExit, 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${label}: ${JSON.stringify(metrics)}`);
    await page.close();
  }
} finally { await browser?.close(); await proxy.close(); }
