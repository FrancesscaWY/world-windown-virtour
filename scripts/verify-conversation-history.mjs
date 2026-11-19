import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createProxy} from '../server/proxy.ts';
import {executeTool} from '../server/ai/tools.ts';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const inputs=[],titles=[];
const {proxy}=await createProxy({backendOptions:{env:{CHAT_API_KEY:'test-only'},
  titleAgent:async({messages})=>{titles.push(messages);return '埃菲尔铁塔建筑之美';},
  agent:async input=>{
    inputs.push(input);
    return {content:'从四个塔脚往上看，钢架线条逐渐向塔尖收拢。',traces:[{id:'simple-guidance',name:'get_attraction_guidance',status:'done',duration:1,
      args:{poi_id:'eiffel'},result:executeTool('get_attraction_guidance',{poi_id:'eiffel'})}]};
  },
}});
let browser;
try{
  const origin=await proxy.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  await mkdir('agent-tmp/history',{recursive:true});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900},{width:844,height:390}]){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/tour.html?mode=interactive`);await page.waitForSelector('#companion-guide');
    await page.evaluate(async()=>{window.__store=(await import('/src/guide/store.js')).store;});
    const geometry=await page.evaluate(()=>{
      const map=document.querySelector('.map-viewport').getBoundingClientRect(),tools=document.querySelector('.map-controls').getBoundingClientRect();
      return {top:tools.top-map.top,angle:document.querySelector('.map-art').style.getPropertyValue('--map-angle')};
    });
    assert.ok(geometry.top<=10 && geometry.top>=0);assert.equal(geometry.angle,'14deg');
    assert.equal(await page.locator('.map-overview-image').isVisible(),false,'full-park entry keeps the preview folded');
    assert.ok(!await page.locator('#call-retry').innerHTML().then(html=>html.includes('m9 5 11 7-11 7Z')),'not a play icon');
    await page.evaluate(()=>{
      const v=document.querySelector('.map-viewport'),r=v.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      const emit=(target,type,id,cx,cy)=>target.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,clientX:cx,clientY:cy,bubbles:true,cancelable:true}));
      emit(v,'pointerdown',1,x-45,y);emit(v,'pointerdown',2,x+45,y);
      emit(window,'pointermove',1,x-75,y-4);emit(window,'pointermove',2,x+75,y+4);
      emit(window,'pointerup',1,x-75,y-4);emit(window,'pointerup',2,x+75,y+4);
    });
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'0','pinch wobble never rotates a 2D map');
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-pitch'),'0');
    assert.equal(await page.locator('.map-overview-image').isVisible(),true);
    const zoom=await page.locator('.map-zoom').textContent();
    await page.setViewportSize({...viewport,height:viewport.height+30});
    assert.equal(await page.locator('.map-art').evaluate(e=>e.style.getPropertyValue('--map-angle')),'14deg');
    assert.equal(await page.locator('.map-zoom').textContent(),zoom);
    await page.setViewportSize(viewport);
    assert.equal(await page.locator('[data-map-action="view"],[data-map-action="rotate"]').count(),0);
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-pitch'),'0');
    await page.locator('.map-viewport').focus();await page.keyboard.press(']');
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'15');
    await page.locator('[data-map-action="zoom-in"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'15');
    const upright=await page.evaluate(()=>{
      const art=document.querySelector('.map-art'),marker=[...document.querySelectorAll('.map-poi')].find(e=>!e.hidden);
      const m=new DOMMatrix(getComputedStyle(art).transform).multiply(new DOMMatrix(getComputedStyle(marker).transform));
      return Math.max(Math.abs(m.a-1),Math.abs(m.b),Math.abs(m.c),Math.abs(m.d-1));
    });
    assert.ok(upright<.001);
    await page.screenshot({path:`agent-tmp/history/oblique-${viewport.width}.png`});
    await page.locator('[data-map-action="reset"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'0');
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-pitch'),'0');
    await page.locator('[data-map-action="reset"]').click();
    await page.locator('#text-mode-button').click();
    assert.equal(await page.locator('#voice-input').evaluate(e=>document.activeElement===e),false);
    const first=await page.evaluate(()=>window.__store.get().conversationId);
    await page.locator('#voice-input').fill('介绍一下埃菲尔铁塔');await page.locator('#send-button').click();
    await page.waitForSelector('#conversation-log .message-photo');
    await page.waitForSelector('#app[data-view="panorama"]');
    assert.equal(await page.locator('#conversation-log .message-photo').count(),1);
    assert.equal(await page.locator('.introduction-photo').count(),0,'Eiffel guidance now opens its actual panorama');
    await page.waitForFunction(()=>document.querySelector('#conversation-mode-label').textContent==='埃菲尔铁塔建筑之美');
    await page.screenshot({path:`agent-tmp/history/matched-${viewport.width}.png`});
    await page.locator('#conversation-new').click();
    assert.notEqual(await page.evaluate(()=>window.__store.get().conversationId),first);
    assert.equal(await page.locator('#conversation-log .conversation-message').count(),0);
    assert.equal(await page.locator('#voice-input').evaluate(e=>document.activeElement===e),false);
    await page.locator('#conversation-history').click();
    await page.locator(`[data-history-id="${first}"]`).click();
    assert.equal(await page.locator('#conversation-mode-label').textContent(),'埃菲尔铁塔建筑之美');
    assert.equal(await page.locator('#conversation-log .message-photo').count(),1);
    await page.screenshot({path:`agent-tmp/history/archive-${viewport.width}.png`});
    assert.equal(await page.evaluate(()=>window.__store.get().conversationId),first);
    await page.locator('#voice-input').fill('再讲一个细节');await page.locator('#send-button').click();
    await page.waitForFunction(()=>document.querySelectorAll('#conversation-log .from-guide').length===2);
    assert.ok(inputs.at(-1).messages.some(row=>row.content==='介绍一下埃菲尔铁塔'),'resuming uses only that conversation context');
    await page.locator('#close-conversation').click();await page.locator('#text-mode-button').click();
    assert.equal(await page.locator('#conversation-log .conversation-message').count(),0,'reopening the window creates another fresh draft');
    await page.locator('#conversation-history').click();await page.locator('#history-close').click();
    await page.reload();await page.waitForSelector('#companion-guide');
    await page.locator('#text-mode-button').click();await page.locator('#conversation-history').click();
    await page.locator(`[data-history-id="${first}"]`).click();
    assert.equal(await page.locator('#conversation-log .from-guide').count(),2,'history survives reload');
    await page.locator('#close-conversation').click();
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
    await page.locator('#call-options-button').click();await page.locator('#call-history').click();
    await page.locator(`[data-history-id="${first}"]`).click();
    assert.equal(await page.locator('#history-continue').count(),0);
    assert.equal(await page.locator('#voice-form').isVisible(),true);
    assert.equal(await page.locator('#app').getAttribute('data-tour-mode'),'interactive');
    assert.deepEqual(errors,[]);await page.close();
    console.log(`${viewport.width}x${viewport.height}: stable map, explicit oblique, matching media, titles, durable history and one-tap resume passed`);
  }
  assert.ok(titles.length>=4);
}finally{await browser?.close();await proxy.close();}
