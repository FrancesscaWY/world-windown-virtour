import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const base=process.env.DEMO_URL || 'http://127.0.0.1:5174/';
await mkdir('agent-tmp/map-interactions',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const guides=['otter-watercolor','dandelion-felt'];
const waitIdle=page=>page.waitForFunction(()=>{const e=document.querySelector('.map-art'),value=e.style.transform;if(value!==window.__lastMap){window.__lastMap=value;window.__mapStableAt=performance.now();}return performance.now()-window.__mapStableAt>150;});
const storeState=page=>page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');const s=store.get();return {messages:s.messages,view:s.view,voiceSession:s.voiceSession,origin:s.visitorOrigin};});
const petRect=page=>page.locator('#companion-pet').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height};});
const assertStable=(a,b,label)=>{for(const key of ['x','y','height'])assert.ok(Math.abs(a[key]-b[key])<1,`${label}: ${JSON.stringify({a,b,key})}`);};
try{
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900},{width:844,height:390}]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      window.__captureCount=0;window.__locationCount=0;
      navigator.mediaDevices.getUserMedia=()=>{window.__captureCount++;return Promise.reject(new DOMException('denied','NotAllowedError'));};
      navigator.geolocation.watchPosition=()=>{window.__locationCount++;return 7;};
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(new URL('tour.html?mode=interactive',base).href);
    await page.waitForFunction(()=>document.querySelector('#companion-pet')?.dataset.mode==='otter-watercolor');
    await page.waitForFunction(()=>document.querySelector('#companion-otter-watercolor').width>0);
    assert.equal(await page.locator('#companion-emotion,#companion-action,#companion-roam').count(),0);
    assert.equal(await page.locator('[data-avatar-mode]').count(),2);
    assert.deepEqual(await page.locator('[data-avatar-mode]').allTextContents(),['沐沐','绒绒']);
    assert.equal(await page.locator('#companion-guide [data-choice-value]').textContent(),'沐沐');
    assert.deepEqual((await storeState(page)).messages,[]);
    assert.equal(await page.locator('.visitor-marker').isVisible(),true,'entry shows explicitly simulated position');
    assert.equal(await page.locator('.visitor-marker').getAttribute('data-source'),'模拟位置');
    assert.equal(await page.locator('#simulation-sheet').evaluate(e=>e.open),false);
    assert.equal(await page.locator('[data-walk]').isChecked(),false);
    await page.locator('#text-mode-button').click();
    await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({showConversationStarters:true});});
    assert.equal(await page.locator('.voice-dock > .companion-route-status').isVisible(),false);
    assert.equal(await page.locator('#companion-listen').count(),0);
    const starterHeight=(await page.locator('#conversation-starters').boundingBox()).height;
    assert.ok(starterHeight<=110,`compact starters: ${starterHeight}`);
    await page.locator('#dismiss-starters').click();
    assert.equal(await page.locator('#conversation-starters').isVisible(),false);
    await page.locator('#close-conversation').click();await page.locator('#text-mode-button').click();
    assert.equal(await page.locator('#conversation-starters').isVisible(),false,'dismissal survives reopen');
    assert.ok(await page.locator('#voice-input').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
    await page.locator('#map-settings-button').click();
    await page.locator('select[data-source]').selectOption('simulated');
    const panel=await page.locator('#simulation-sheet').evaluate(e=>{const p=e.getBoundingClientRect();return{fits:p.top>=0 && p.bottom<=innerHeight,scrolls:e.scrollHeight>e.clientHeight};});
    assert.equal(panel.fits,true,'settings use a coherent viewport-bounded dialog');
    for(const selector of ['select[data-source]','select[data-location]','[data-speed]','[data-reset]']){
      const control=page.locator(selector);await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,`${selector} receives pointer, not just isVisible`);
    }
    await page.screenshot({path:`agent-tmp/map-interactions/settings-${viewport.width}.png`});
    await page.locator('[data-done]').click();
    await page.locator('#voice-input').click();
    await page.screenshot({path:`agent-tmp/map-interactions/text-${viewport.width}.png`});
    await page.locator('#close-conversation').click();
    for(const kind of ['food','toilets','other','all']){
      await page.locator(`[data-top-facility-kind="${kind}"]`).click();
      if(kind!=='all'){
        assert.equal(await page.locator('.facility-source-line').isVisible(),true);
        assert.ok((await page.locator('.facility-source-line').boundingBox()).height<=52,'no large facility placeholder');
      }
      assert.equal(await page.locator('.map-bubble,.map-service-bubble').count(),0);
      assert.deepEqual((await storeState(page)).messages,[]);
    }
    await page.locator('#open-catalog').click();await page.locator('#catalog-search').fill('埃菲尔铁塔');await page.locator('.catalog-row[data-catalog-poi="eiffel"]').click();
    await page.waitForSelector('#app[data-view="panorama"]');
    assert.deepEqual((await storeState(page)).messages,[]);
    assert.equal(await page.locator('#map-selection').count(),0);
    assert.equal(await page.locator('.location-simulator').isVisible(),false);
    assert.equal(await page.locator('#companion-emotion').count(),0);
    assert.deepEqual((await storeState(page)).messages,[]);
    await page.locator('#panorama-back-map').click();
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
    assert.equal(await page.locator('#call-info').isVisible(),true);
    assert.equal(await page.locator('#call-retry').isVisible(),true);
    assert.equal(await page.locator('[data-companion-toggle]').count(),0);
    assert.equal(await page.locator('[data-walk]').isChecked(),true);
    assert.deepEqual((await storeState(page)).messages,[],'entering companion also waits for explicit voice');
    assert.equal(await page.evaluate(()=>window.__captureCount),0);assert.equal(await page.evaluate(()=>window.__locationCount),0);
    await page.locator('#map-settings-button').click();assert.equal(await page.locator('[data-speed]').isVisible(),true);
    await page.locator('[data-walk]').uncheck();await page.locator('select[data-source]').selectOption('device');
    assert.equal(await page.evaluate(()=>window.__locationCount),1,'device permission only follows explicit source selection');
    await page.locator('select[data-source]').selectOption('simulated');await page.locator('[data-done]').click();
    await page.screenshot({path:`agent-tmp/map-interactions/companion-${viewport.width}.png`});
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="interactive"]').click();
    assert.equal(await page.locator('#companion-listen').count(),0);
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${viewport.width}x${viewport.height}: starter dismissal, 16px inputs, silent browsing, facility precision, explicit scene, companion trail and folded location settings passed`);
  }
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('tour.html?mode=interactive',base).href);await page.waitForFunction(()=>document.querySelector('#companion-pet')?.dataset.mode==='otter-watercolor');
  // Sample both moving surfaces from exactly the same animation frames.
  await page.evaluate(async()=>{window.__frames=[];window.__sampling=true;const sample=()=>{const r=document.querySelector('#companion-pet').getBoundingClientRect();window.__frames.push({x:r.x,y:r.y,height:r.height,map:document.querySelector('.map-art').style.transform});if(window.__sampling)requestAnimationFrame(sample);};sample();const {store}=await import('/src/guide/store.js');store.set({recommendedPoiIds:['eiffel']});});
  await page.waitForFunction(()=>document.querySelector('.map-zoom').textContent==='220%');await waitIdle(page);
  const frames=await page.evaluate(()=>{window.__sampling=false;return window.__frames;});
  assert.ok(new Set(frames.map(f=>f.map)).size>8,'map interpolates');assert.ok(new Set(frames.map(f=>f.x.toFixed(1))).size>8,'guide interpolates');
  assert.ok(frames.at(-1).height>frames[0].height+10,'guide size follows zoom');assert.deepEqual((await storeState(page)).messages,[]);
  await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({recommendedPoiIds:['pyramid']});});
  await page.waitForFunction(()=>document.querySelector('#companion-pet').dataset.mapMoving==='true');
  const box=await page.locator('.map-viewport').boundingBox();await page.mouse.move(box.x+40,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+70,box.y+box.height*.5,{steps:3});await page.mouse.up();await waitIdle(page);
  assert.equal(await page.locator('#companion-pet').getAttribute('data-map-moving'),'false');
  const interrupted=await petRect(page);
  await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');for(let i=0;i<12;i++)store.set({locationStatus:`refresh-${i}`});});
  assertStable(interrupted,await petRect(page),'unrelated store updates preserve interrupted position and scale');
  await page.locator('#companion-guide').click();
  await page.locator('[data-avatar-mode="dandelion-felt"]').click();
  await page.waitForFunction(()=>document.querySelector('#companion-pet').dataset.mode==='dandelion-felt');
  assertStable(interrupted,await petRect(page),'switching the artwork guide does not reset interrupted placement');
  await page.locator('#companion-pet').focus();await page.keyboard.press('ArrowUp');
  const placed=await petRect(page);
  await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({locationStatus:'after-placement'});});
  assertStable(placed,await petRect(page),'keyboard placement persists through rendering');
  // Resizing and repeated state renders clamp the actual pet size to the new map.
  await page.setViewportSize({width:320,height:568});
  try{await page.waitForFunction(()=>{const a=document.querySelector('#companion-pet').getBoundingClientRect(),b=document.querySelector('.scene-surface').getBoundingClientRect();return a.left>=b.left-1 && a.right<=b.right+1 && a.top>=b.top-1 && a.bottom<=b.bottom+1;});}
  catch(error){console.error(await page.evaluate(()=>({pet:document.querySelector('#companion-pet').getBoundingClientRect().toJSON(),stage:document.querySelector('.scene-surface').getBoundingClientRect().toJSON(),style:document.querySelector('#companion-pet').getAttribute('style'),data:{...document.querySelector('#companion-pet').dataset}})));throw error;}
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('.scene-surface').getBoundingClientRect().height>450);
  await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({recommendedPoiIds:['eiffel']});});
  await page.waitForFunction(()=>document.querySelector('#companion-pet').dataset.mapMoving==='true');
  const drag=await page.locator('#companion-pet').boundingBox();
  await page.mouse.move(drag.x+drag.width/2,drag.y+drag.height/2);await page.mouse.down();
  await page.mouse.move(drag.x+drag.width/2-24,drag.y+drag.height/2+12,{steps:4});await page.mouse.up();
  assert.equal(await page.locator('#companion-pet').getAttribute('data-map-moving'),'false','drag cancels the shared flight');
  const dropped=await petRect(page);await waitIdle(page);
  await page.evaluate(async()=>{const {store}=await import('/src/guide/store.js');store.set({locationStatus:'after-drop'});});
  assertStable(dropped,await petRect(page),'dragged size and position persist after flight cancellation');
  await page.locator('[data-map-action="reset"]').click();await page.waitForFunction(()=>document.querySelector('.map-zoom').textContent==='100%');await waitIdle(page);
  for(const id of guides){
    await page.locator('#companion-guide').click();await page.locator(`[data-avatar-mode="${id}"]`).click();
    await page.waitForFunction(id=>{const e=document.querySelector('#companion-pet');return e.dataset.mode===id && e.getAttribute('aria-busy')==='false';},id);
    assert.equal(await page.locator(`#companion-guide-options [data-avatar-mode="${id}"]`).getAttribute('aria-selected'),'true');
  }
  await page.locator('#text-mode-button').click();
  await page.locator('#voice-input').focus();
  await page.evaluate(()=>{
    const v=window.visualViewport;Object.defineProperties(v,{height:{configurable:true,get:()=>420},offsetTop:{configurable:true,get:()=>0}});v.dispatchEvent(new Event('resize'));
  });
  await page.waitForSelector('#app[data-keyboard="true"]');
  assert.equal(await page.locator('.tour-workspace').isVisible(),false);
  assert.equal(await page.locator('#conversation-panel').isVisible(),true);
  assert.ok(await page.locator('#voice-form').evaluate(e=>e.getBoundingClientRect().bottom<=420));
  await page.screenshot({path:'agent-tmp/map-interactions/keyboard.png'});
  await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
  await page.waitForSelector('#app[data-keyboard="false"]');
  await page.locator('#voice-input').press('Escape');
  assert.equal(await page.locator('.map-viewport').isVisible(),true);
  await page.locator('[data-map-action="reset"]').click();await waitIdle(page);
  for(let i=0;i<5;i++)await page.locator('[data-map-action="zoom-out"]').click({force:true});
  assert.equal(await page.locator('.map-zoom').textContent(),'65%');
  assert.equal(await page.locator('[data-map-action="zoom-out"]').isDisabled(),true);
  await page.locator('[data-map-action="reset"]').click();await waitIdle(page);
   assert.equal(await page.locator('[data-map-action="view"],[data-map-action="rotate"]').count(),0);
   assert.equal(await page.locator('.map-viewport').getAttribute('data-map-pitch'),'0');
  await page.evaluate(()=>{
    const v=document.querySelector('.map-viewport'),r=v.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const emit=(target,type,id,cx,cy)=>target.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,clientX:cx,clientY:cy,bubbles:true,cancelable:true}));
    emit(v,'pointerdown',11,x-50,y);emit(v,'pointerdown',12,x+50,y);
    emit(window,'pointermove',11,x,y-50);emit(window,'pointermove',12,x,y+50);
    emit(window,'pointerup',11,x,y-50);emit(window,'pointerup',12,x,y+50);
  });
   assert.equal(Number(await page.locator('.map-viewport').getAttribute('data-map-rotation')),0);
   await page.locator('[data-map-action="zoom-in"]').click();await page.locator('[data-map-action="zoom-in"]').click();await waitIdle(page);
  const upright=await page.evaluate(()=>{
    const art=document.querySelector('.map-art'),marker=[...document.querySelectorAll('.map-poi')].find(e=>!e.hidden);
    const m=new DOMMatrix(getComputedStyle(art).transform).multiply(new DOMMatrix(getComputedStyle(marker).transform));
    return Math.max(Math.abs(m.a-1),Math.abs(m.b),Math.abs(m.c),Math.abs(m.d-1));
  });
  assert.ok(upright<.001,`labels invert the whole rotated map plane: ${upright}`);
  const rotated=await page.locator('.map-art').getAttribute('style');
  await page.locator('#voice-input').focus();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>420});visualViewport.dispatchEvent(new Event('resize'));});
  await page.waitForSelector('#app[data-keyboard="true"]');
  await page.locator('#voice-input').press('Escape');
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>document.querySelector('#app').dataset.workspace==='split');
  await waitIdle(page);
  assert.equal(await page.locator('.map-art').getAttribute('style'),rotated,'editing retains rotated map state');
   assert.equal(await page.locator('[data-map-action="orient"]').count(),0);
   await page.locator('[data-map-action="reset"]').click();await waitIdle(page);
  await page.waitForFunction(()=>Number(document.querySelector('.map-viewport').dataset.mapRotation)===0);
   assert.equal(Number(await page.locator('.map-viewport').getAttribute('data-map-rotation')),0);
   await page.locator('#close-conversation').click();
   await page.waitForFunction(()=>document.querySelector('.map-viewport').clientHeight>500);
   await waitIdle(page);
  await page.evaluate(()=>{
    window.__arrivalFrames=[];window.__arrivalSampling=true;
    const sample=()=>{const app=document.querySelector('#app'),pet=document.querySelector('#companion-pet').getBoundingClientRect();
      window.__arrivalFrames.push({view:app.dataset.view,x:pet.x,y:pet.y,map:document.querySelector('.map-art').style.transform});
      if(window.__arrivalSampling)requestAnimationFrame(sample);};
    sample();document.querySelector('[data-poi="eiffel"]').click();
  });
  assert.equal((await storeState(page)).view,'map','do not switch to panorama before guide arrival');
  await page.waitForFunction(()=>document.querySelector('#companion-pet').dataset.mapMoving==='true');
  assert.equal((await storeState(page)).view,'map');
  await page.waitForSelector('#app[data-view="panorama"]');
  const arrivals=await page.evaluate(()=>{window.__arrivalSampling=false;return window.__arrivalFrames.filter(f=>f.view==='map');});
  assert.ok(new Set(arrivals.map(f=>f.map)).size>8,'camera moves before the scene changes');
  assert.ok(new Set(arrivals.map(f=>`${f.x.toFixed(1)},${f.y.toFixed(1)}`)).size>8,'guide moves before the scene changes');
  assert.deepEqual((await storeState(page)).messages,[]);
  assert.deepEqual(errors,[]);await page.close();
  console.log('Continuous camera/guide, placement, keyboard restoration, 65% overview, two-finger rotation/upright labels and guide-before-panorama order passed');
}finally{await browser.close();}
