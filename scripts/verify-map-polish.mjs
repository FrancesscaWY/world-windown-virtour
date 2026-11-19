import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '/root/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs';

const browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
const base=process.env.DEMO_URL??'http://127.0.0.1:5174/';
await mkdir('agent-tmp/map-polish',{recursive:true});
try {
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:423,height:937},{width:768,height:1024},{width:1440,height:900},{width:844,height:390}]){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.goto(new URL('tour.html?mode=interactive',base).href);
    await page.waitForFunction(()=>document.querySelector('#companion-pet')?.getAttribute('aria-busy')==='false');
    await page.waitForFunction(()=>document.querySelector('.map-base').naturalWidth>0);
    assert.equal(await page.locator('#place-subtitle').isVisible(),false);
    assert.equal(await page.locator('#place-subtitle').textContent(),'');
    assert.equal(await page.locator('#wordmark').isVisible(),true);
    assert.equal(await page.locator('#wordmark img').evaluate(e=>e.complete&&e.naturalWidth>0),true);
    assert.equal(await page.locator('#place-title').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'the complete brand title must not be ellipsized');
    assert.match(await page.locator('link[rel="icon"]').getAttribute('href'),/brand-favicon\.png$/);
    assert.equal(await page.locator('.map-surroundings,.surroundings-note').count(),0);
    const source=await page.locator('.map-base').getAttribute('src');
    await page.screenshot({path:`agent-tmp/map-polish/home-${viewport.width}.png`});
    for(let i=0;i<4;i++)await page.locator('[data-map-action="zoom-out"]').click({force:true});
    assert.equal(await page.locator('.map-zoom').textContent(),'65%');
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-zoomed-out'),'true');
    assert.equal(await page.locator('.map-base').getAttribute('src'),source);
    assert.equal(await page.locator('.map-art').isVisible(),true);
    assert.equal(await page.locator('.visitor-marker').isVisible(),true);
    assert.equal(await page.locator('.map-atmosphere').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
    assert.equal(requests.some(url=>url.includes('park-surroundings.svg')),false);
    await page.screenshot({path:`agent-tmp/map-polish/zoomed-out-${viewport.width}.png`});
    await page.locator('[data-map-action="reset"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-zoomed-out'),'false');
    await page.locator('#text-mode-button').click();
    await page.locator('#voice-input').fill('想找一个拍照角度');
    const focus=await page.locator('#voice-input').evaluate(e=>{
      const css=getComputedStyle(e);return {style:css.outlineStyle,border:css.borderTopWidth,shadow:css.boxShadow};
    });
    assert.deepEqual(focus,{style:'none',border:'0px',shadow:'none'});
    assert.equal(await page.locator('#companion-pet').isVisible(),false);
    await page.screenshot({path:`agent-tmp/map-polish/input-${viewport.width}.png`});
    await page.locator('#voice-input').press('Escape');
    await page.locator('#close-conversation').click();
    const interactive=await page.locator('#app').evaluate(e=>getComputedStyle(e).getPropertyValue('--mode-accent'));
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
    const companion=await page.locator('#app').evaluate(e=>getComputedStyle(e).getPropertyValue('--mode-accent'));
    assert.notEqual(interactive,companion,'companion keeps its own warm palette');
    assert.equal(await page.locator('#place-subtitle').isVisible(),false);
    if(viewport.width===390)await page.screenshot({path:'agent-tmp/map-polish/companion-390.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);await page.close();
    console.log(`${viewport.width}×${viewport.height}: original map retained at 65%, non-interactive paper backdrop, supplied logo, no red input outline, compact brand header and distinct mode palettes passed`);
  }
} finally {await browser.close();}
