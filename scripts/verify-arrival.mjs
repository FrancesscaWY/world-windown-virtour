import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const base = process.env.DEMO_URL || 'http://127.0.0.1:5174/';
await mkdir('agent-tmp/arrival', { recursive:true });
const browser = await chromium.launch({ executablePath:process.env.CHROME_PATH, headless:true, args:['--no-sandbox','--enable-unsafe-swiftshader'] });
try {
  for (const viewport of [{width:320,height:568},{width:320,height:740},{width:390,height:660},{width:390,height:844},{width:423,height:780},{width:423,height:937},{width:768,height:1024},{width:1440,height:900},{width:844,height:390}]) {
    const context = await browser.newContext({ viewport, reducedMotion:'reduce', hasTouch:true });
    await context.addInitScript(() => {
      window.__entryCaptures = 0;
      navigator.mediaDevices.getUserMedia = () => { window.__entryCaptures++; return Promise.reject(new DOMException('denied','NotAllowedError')); };
      navigator.geolocation.watchPosition = () => { window.__entryCaptures++; return 0; };
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.waitForSelector('.arrival-flow');
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); window.__sameArrivalDocument = performance.timeOrigin; });
    const check = async () => {
      const result = await page.evaluate(() => {
        const panel = document.querySelector('.arrival-panel:not([inert])');
        const fits = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.left>=-1 && r.top>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1; };
        const overlap = (a,b) => { const x=a.getBoundingClientRect(),y=b.getBoundingClientRect(); return x.left<y.right && x.right>y.left && x.top<y.bottom && x.bottom>y.top; };
        const hints = [...panel.querySelectorAll('.welcome-destination p,.welcome-greeting,.welcome-invitation,.modes-heading p,.mode-card-caption p,.modes-footer p')];
        return {
          overflow:document.documentElement.scrollWidth>innerWidth+1 || document.documentElement.scrollHeight>innerHeight+1,
          fits:[...panel.querySelectorAll('h1,h2,.welcome-mascot,.arrival-mode-card,footer')].every(fits),
          oneLine:hints.every(e=>{const range=document.createRange();range.selectNodeContents(e); const rows=[...range.getClientRects()].filter(r=>r.width>1 && r.height>1).map(r=>Math.round(r.top));return Math.max(...rows)-Math.min(...rows)<8 && e.scrollWidth<=e.clientWidth+1;}),
          distinct:!panel.querySelector('.welcome-title') || !overlap(panel.querySelector('.welcome-title'),panel.querySelector('.welcome-mascot')),
          hero:!panel.querySelector('.welcome-world') || (()=>{const r=panel.querySelector('.welcome-world').getBoundingClientRect(),title=panel.querySelector('h1').textContent;return r.height>=innerHeight*.48 && /AI伴游/.test(title) && !panel.querySelector('.welcome-greeting,.welcome-destination');})(),
          captures:window.__entryCaptures,
          sameDocument:window.__sameArrivalDocument===performance.timeOrigin,
        };
      });
      assert.deepEqual(result,{overflow:false,fits:true,oneLine:true,distinct:true,hero:true,captures:0,sameDocument:true},JSON.stringify({viewport,result}));
      assert.deepEqual(errors,[]);
    };
    await check(); await page.screenshot({path:`agent-tmp/arrival/welcome-${viewport.width}x${viewport.height}.png`});
    await page.locator('#welcome-enter').click(); await page.waitForURL('**/modes.html');
    await check(); await page.screenshot({path:`agent-tmp/arrival/modes-${viewport.width}x${viewport.height}.png`});
    await page.goBack(); await page.waitForSelector('body[data-page="welcome"]'); await check();
    await page.keyboard.press('ArrowRight'); await page.waitForSelector('body[data-page="modes"]');
    await page.locator('.arrival-flow-progress [aria-label="欢迎页"]').click(); await page.waitForSelector('body[data-page="welcome"]');
    await page.setViewportSize({width:viewport.width,height:Math.max(480,viewport.height-100)}); await check();
    await context.close(); console.log(`${viewport.width}x${viewport.height}: AI companion title, large illustration, one invitation, same-document slides, back/keyboard/progress and viewport resize passed`);
  }
  // Inspect an in-flight drag: scene and indicator move together, without document requests.
  const context = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true });
  const page = await context.newPage(); await page.goto(base); await page.waitForSelector('.arrival-flow');
  await page.evaluate(() => { window.__documentToken=42; });
  const documents=[]; page.on('request',request=>{if(request.resourceType()==='document') documents.push(request.url());});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y:720}]});
  for (let x=300;x>=180;x-=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:720}]});
  const position=Number(await page.locator('body').evaluate(e=>e.style.getPropertyValue('--arrival-position')));
  assert.ok(position>.2 && position<.7,'drag must move both slides continuously');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForSelector('body[data-page="modes"]');
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
  assert.equal(await page.evaluate(()=>window.__documentToken),42);assert.deepEqual(documents,[]);
  await page.locator('.arrival-back').click(); await page.waitForSelector('body[data-page="welcome"]');
  await page.locator('#welcome-enter').click(); await page.waitForSelector('body[data-page="modes"]');
  await page.locator('.arrival-mode-card').filter({has:page.getByRole('heading',{name:'交互模式',exact:true})}).click();
   await page.waitForSelector('#app[data-interaction="realtime"]');
  await page.goBack(); await page.waitForSelector('body[data-page="modes"]');
  await context.close();
  const direct=await browser.newPage({reducedMotion:'reduce'});await direct.goto(new URL('modes.html',base).href);
  await direct.waitForSelector('.arrival-flow'); await direct.locator('.arrival-back').click();
  await direct.waitForSelector('body[data-page="welcome"]');await direct.reload();await direct.waitForSelector('.arrival-flow');await direct.close();
  console.log('Real touch drag, synced indicator, zero document navigation, direct links, reload and tour/back passed.');
} finally { await browser.close(); }
