import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createProxy} from '../server/proxy.ts';
import {executeTool} from '../server/ai/tools.ts';
import {narrationSegments} from '../server/ai/tts.ts';
import {toCoordinates} from '../src/guide/location.js';
import {getPoi} from '../src/data/pois.js';
import {chromium} from '/root/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs';

// Isolated visual/protocol fixture; never used as a production model fallback.
let releaseAnswer;
const {proxy}=await createProxy({backendOptions:{env:{CHAT_API_KEY:'fixture',DASHSCOPE_API_KEY:'fixture'},
  titleAgent:async()=> '景点与游览安排',
  ttsAgent:async({text,onEvent})=>{
    for(const s of narrationSegments(text))onEvent({type:'audio_delta',audio:Buffer.alloc(24000).toString('base64'),sampleRate:24000,charIndex:s.charIndex});
  },
  agent:async input=>{
    const text=input.messages.at(-1).content;
    if(text.includes('等一等'))await new Promise(resolve=>releaseAnswer=resolve);
    const name=text.includes('路线')?'plan_route':text.includes('铁塔')?'get_attraction_guidance':'search_web';
    const args=name==='plan_route'?{title:'建筑散步',summary:'从当前位置出发，先看铁塔，再去凯旋门。',stops:[{poi_id:'eiffel',reason:'观察钢架'},{poi_id:'arc',reason:'看拱门'}]}:{poi_id:'eiffel'};
    const result=name==='search_web'?{status:'success',results:[1,2,3].map(i=>({title:`出行与游览资料 ${i}`,url:`https://www.szmc.net/guide/${i}`,content:'与本轮主题相关的来源说明。'})),images:[]}:executeTool(name,args,input.pageContext);
    return {content:name==='plan_route'?'从当前位置出发，先到 **埃菲尔铁塔** 看钢架线条，再去 **凯旋门** 欣赏拱门。':name==='get_attraction_guidance'?'抬头看 **塔身线条**，再看看塔脚向外舒展的姿态。':'先看建筑轮廓，再找一个喜欢的角度。\n\n\n- 留意拱门\n\n- 看看花园\n\n相关来源在下方。',traces:[{id:`fixture-${name}`,name,status:'done',result}]};
  } }});
let browser;
try {
  const origin=await proxy.listen({port:0,host:'127.0.0.1'});
  browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',args:['--no-sandbox','--enable-unsafe-swiftshader']});
  await mkdir('agent-tmp/v12',{recursive:true});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900},{width:844,height:390}]){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/tour.html?mode=interactive`);
    await page.waitForFunction(()=>document.querySelector('#companion-pet')?.getAttribute('aria-busy')==='false');
    await page.evaluate(async()=>window.__store=(await import('/src/guide/store.js')).store);
    assert.equal(await page.locator('[data-map-action="view"],[data-map-action="rotate"]').count(),0);
    assert.equal(await page.locator('.map-overview').isVisible(),false);
    await page.screenshot({path:`agent-tmp/v12/home-${viewport.width}.png`});
    await page.locator('[data-map-action="zoom-out"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-zoomed-out'),'true');
    assert.equal(await page.locator('.map-art').isVisible(),true,'zooming out never replaces the original illustrated map');
    assert.equal(await page.locator('.map-base').getAttribute('src'),'./assets/map.jpg');
    assert.equal(await page.locator('.map-surroundings,.surroundings-note').count(),0);
    await page.screenshot({path:`agent-tmp/v12/zoomed-out-${viewport.width}.png`});
    await page.locator('[data-map-action="reset"]').click();
    await page.locator('#open-catalog').click();
    assert.equal(await page.locator('.catalog-discover button').count(),4);
    await page.screenshot({path:`agent-tmp/v12/catalog-${viewport.width}.png`});
    await page.locator('#catalog-search').fill('凯旋门');
    assert.equal(await page.locator('.catalog-row').count(),1);
    await page.locator('#close-catalog').click();
    await page.locator('#text-mode-button').click();
    const centered=await page.locator('#conversation-empty').evaluate(e=>{
      const box=e.getBoundingClientRect(),title=e.querySelector('h3').getBoundingClientRect();
      return Math.abs(title.x+title.width/2-box.x-box.width/2)<2;
    });
    assert.equal(centered,true);
    await page.screenshot({path:`agent-tmp/v12/greeting-${viewport.width}.png`});
    await page.locator('#voice-input').fill('等一等，看看风景');await page.locator('#send-button').click();
    await page.waitForSelector('#conversation-progress:visible');
    assert.equal(await page.locator('#conversation-progress').evaluate(e=>e.parentElement.id),'conversation-log');
    const order=await page.evaluate(()=>{
      const user=document.querySelector('#conversation-log .from-visitor').getBoundingClientRect(),hint=document.querySelector('#conversation-progress').getBoundingClientRect();
      return hint.top>=user.bottom;
    });
    assert.ok(order);await page.screenshot({path:`agent-tmp/v12/thinking-${viewport.width}.png`});
    releaseAnswer();await page.waitForSelector('#conversation-log .from-guide');
    assert.equal(await page.locator('#conversation-progress').isVisible(),false);
    assert.equal(await page.locator('.reply-source-card').count(),3);
    const referenceHeight=await page.locator('#conversation-log .message-references').evaluate(e=>e.getBoundingClientRect().height);
    assert.ok(referenceHeight<=110);
    assert.equal(await page.locator('.markdown-body').evaluate(e=>getComputedStyle(e).whiteSpace),'normal');
    await page.screenshot({path:`agent-tmp/v12/compact-reply-${viewport.width}.png`});
    // Old timestamp with a stationary simulation must still reach every service.
    await page.evaluate(()=>window.__store.set({locationUpdatedAt:Date.now()-120000}));
    await page.locator('#voice-input').fill('帮我规划路线');await page.locator('#send-button').click();
    await page.waitForFunction(()=>Boolean(window.__store.get().plannedRoute));
    const route=await page.evaluate(()=>window.__store.get().plannedRoute);
    assert.equal(route.origin.locationSource,'simulated');assert.equal(route.geometry.legs[0].from,'visitor');
    assert.match(route.origin.name,/自由女神/);
    await page.waitForSelector('.map-poi.route-arrived');
    await page.screenshot({path:`agent-tmp/v12/route-${viewport.width}.png`});
    await page.locator('#voice-input').fill('介绍铁塔');await page.locator('#send-button').click();
    await page.waitForSelector('#app[data-view="panorama"]');
    await page.waitForFunction(()=>document.querySelector('#panorama-canvas').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('#panorama-narration-start').isVisible(),true);
    const noOverlap=await page.evaluate(()=>{
      const pet=document.querySelector('#companion-pet');
      if(pet.hidden || getComputedStyle(pet).visibility==='hidden')return true;
      const p=pet.getBoundingClientRect();
      return ['.voice-dock','.interaction-launcher','.panorama-point-info'].every(s=>{
        const e=document.querySelector(s);if(e.hidden || getComputedStyle(e).display==='none')return true;
        const r=e.getBoundingClientRect();return p.right<=r.left || p.left>=r.right || p.bottom<=r.top || p.top>=r.bottom;
      });
    });assert.ok(noOverlap);
    await page.screenshot({path:`agent-tmp/v12/panorama-text-${viewport.width}.png`});
    if(viewport.width===390){
      await page.evaluate(()=>{window.__petPositions=[];document.querySelector('.scene-surface').addEventListener('virtour:panorama-view',()=>{const p=document.querySelector('#companion-pet');window.__petPositions.push([p.style.left,p.style.top]);});});
      await page.locator('#panorama-narration-start').click();
      await page.waitForFunction(()=>window.__store.get().cameraSentence?.hotspotId==='garden-shade');
      await page.waitForFunction(()=>window.__store.get().cameraTour===null);
      assert.ok(await page.evaluate(()=>new Set(window.__petPositions.map(JSON.stringify)).size)>2);
      await page.screenshot({path:'agent-tmp/v12/panorama-voice-390.png'});
    }
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
    assert.equal(await page.locator('#voice-form').isVisible(),false);
    await page.locator('#map-settings-button').click();await page.locator('[data-location]').selectOption('1');await page.locator('[data-done]').click();
    await page.evaluate(position=>window.__store.set({visitorOrigin:position}),toCoordinates(getPoi('eiffel').position));
    assert.ok(await page.locator('[data-visited-poi="eiffel"]').count()>0);
    await page.screenshot({path:`agent-tmp/v12/companion-${viewport.width}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`${viewport.width}×${viewport.height}: 2D/overview, real surrounding map, search, centered greeting, thinking order, compact sources, simulated route origin, text panorama, safe guide and visited lights passed`);
  }
} finally {releaseAnswer?.();await browser?.close();await proxy.close();}
