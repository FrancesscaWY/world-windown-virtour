import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { executeTool } from '../server/ai/tools.ts';
import { narrationSegments } from '../server/ai/tts.ts';
import { panoramaNarration } from '../src/guide/panorama-narration.js';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??`${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const inputs=[];
const {proxy}=await createProxy({backendOptions:{env:{CHAT_API_KEY:'fixture',DASHSCOPE_API_KEY:'fixture'},
  titleAgent:async()=> '地铁与游园建议',
  ttsAgent:async({text,onEvent})=>{
    for(const segment of narrationSegments(text))
      onEvent({type:'audio_delta',audio:Buffer.alloc(38400).toString('base64'),sampleRate:24000,charIndex:segment.charIndex});
  },
  agent:async input=>{
    inputs.push(input);
    const web=input.messages.at(-1)?.content.includes('联网');
    return {content:web?'可以查看下面的**联网交通资料**。':'首选 **世界之窗站**。\n\n- 出站后留意现场指示\n- 出口开放以当天公告为准',
      traces:[web?{id:'web',name:'search_web',status:'done',result:{status:'success',retrievedAt:new Date().toISOString(),
        images:[{url:'https://images.example.org/transit.svg',description:'交通资料（隔离测试）',source:'https://www.szmc.net/'}],
        results:[{title:'地铁出行参考',url:'https://www.szmc.net/',content:'以地铁官方最新信息为准。'}]}}
        :{id:'transport',name:'search_knowledge_base',status:'done',result:executeTool('search_knowledge_base',{query:'深圳世界之窗地铁'})}]};
  },
}});
let browser;
try{
  const origin=await proxy.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  await mkdir('agent-tmp/v11',{recursive:true});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1440,height:900},{width:844,height:390}]){
    const context=await browser.newContext({viewport,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.__captures=0;navigator.mediaDevices.getUserMedia=async()=>{window.__captures++;throw new Error('No microphone should be requested');};});
    await page.route('https://images.example.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#e1eaf3"/><text x="40" y="80" fill="#35566f">Transit fixture</text></svg>'}));
    await page.goto(`${origin}/tour.html?mode=interactive`);await page.waitForSelector('#companion-guide');
    await page.evaluate(async()=>window.__store=(await import('/src/guide/store.js')).store);
    assert.equal(await page.locator('.map-poi:visible').count(),0,'full park has region labels, not scenic bubbles');
    const numbers=await page.locator('.map-poi-number').allTextContents();
    assert.deepEqual(numbers.map(Number).sort((a,b)=>a-b),Array.from({length:numbers.length},(_,i)=>i+1));
    assert.equal(await page.locator('.visitor-marker').evaluate(e=>getComputedStyle(e,'::after').display),'none');
    assert.equal(await page.locator('#mode-button').innerText(),'交互');
    await page.locator('#mode-button').click();
    assert.match(await page.locator('#mode-menu').innerText(),/交互模式/);assert.match(await page.locator('#mode-menu').innerText(),/伴游模式/);
    await page.locator('#mode-button').click();
    await page.screenshot({path:`agent-tmp/v11/home-${viewport.width}.png`});
    await page.locator('[data-map-action="view"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-pitch'),'55');
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'24');
    await page.screenshot({path:`agent-tmp/v11/oblique-${viewport.width}.png`});
    await page.locator('[data-map-action="view"]').click();
    assert.equal(await page.locator('.map-viewport').getAttribute('data-map-rotation'),'0');
    await page.locator('[data-map-region="欧洲区"]').click();
    await page.locator('[data-poi="eiffel"].map-poi').click();
    await page.waitForFunction(()=>window.__store.get().cameraSentence?.hotspotId==='tower-feet');
    assert.equal(await page.evaluate(()=>window.__captures),0);
    const conversation=await page.evaluate(()=>window.__store.get().conversationId);
    await page.waitForFunction(()=>window.__store.get().cameraSentence?.hotspotId==='tower-arch');
    await page.waitForFunction(()=>window.__store.get().cameraSentence?.hotspotId==='garden-shade');
    await page.waitForFunction(()=>window.__store.get().cameraTour===null);
    const script=panoramaNarration({poiId:'eiffel',hotspotIds:['tower-feet','tower-arch','tower-spire','garden-shade']});
    assert.equal(await page.evaluate(()=>window.__store.get().messages.at(-1).text),script.text,'one tap starts a complete actual-camera narration');
    assert.equal(await page.evaluate(()=>window.__store.get().messages.filter(row=>row.role==='user').length),0,'clicks are not forged speech');
    await page.screenshot({path:`agent-tmp/v11/narration-${viewport.width}.png`});
    await page.locator('#text-mode-button').click();
    assert.match(await page.locator('#conversation-empty').innerText(),/你好，我是沐沐/);
    assert.equal(await page.locator('#voice-input').evaluate(e=>e===document.activeElement),false);
    await page.locator('#voice-input').fill('附近的地铁站有哪些');await page.locator('#send-button').click();
    await page.waitForSelector('#conversation-log strong');
    assert.equal(await page.locator('#conversation-log .markdown-body strong').first().innerText(),'世界之窗站');
    assert.equal(await page.locator('#conversation-log li').count(),2);
    assert.equal(await page.locator('#conversation-log script').count(),0);
    const safe=await page.evaluate(async()=>{
      const {renderMarkdown}=await import('/src/components/markdown.js');
      const node=renderMarkdown(document,'**重点** <script>window.__xss=1</script> <img src=x onerror=alert(1)> [危险](javascript:alert(1))');
      return {strong:node.querySelector('strong')?.textContent,scripts:node.querySelectorAll('script,img').length,unsafe:node.querySelectorAll('a[href^="javascript:"]').length};
    });
    assert.deepEqual(safe,{strong:'重点',scripts:0,unsafe:0});
    assert.equal(await page.evaluate(()=>window.__xss),undefined);
    assert.ok(await page.locator('#conversation-log .reply-source-card').count()>0,'transport receives related evidence instead of unrelated Eiffel photos');
    assert.equal(await page.locator('#conversation-log .message-photo').count(),0);
    const textConversation=await page.evaluate(()=>window.__store.get().conversationId);
    await page.screenshot({path:`agent-tmp/v11/markdown-${viewport.width}.png`});
    await page.locator('#conversation-new').click();
    await page.locator('#conversation-history').click();
    assert.equal(await page.locator('#history-continue').count(),0);
    await page.locator(`[data-history-id="${textConversation}"]`).click();
    assert.equal(await page.locator('#history-sheet').isVisible(),false);
    assert.equal(await page.locator('#voice-form').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__store.get().conversationId),textConversation);
    await page.locator('#voice-input').fill('联网交通图片');await page.locator('#send-button').click();
    await page.waitForSelector('#conversation-log .reply-source-card img');
    assert.ok(inputs.at(-1).messages.some(row=>row.content==='附近的地铁站有哪些'));
    await page.screenshot({path:`agent-tmp/v11/sourced-media-${viewport.width}.png`});
    await page.locator('#mode-button').click();await page.locator('[data-tour-mode="companion"]').click();
    await page.locator('#call-options-button').click();await page.locator('#call-history').click();
    await page.locator(`[data-history-id="${conversation}"]`).click();
    assert.equal(await page.locator('#app').getAttribute('data-tour-mode'),'interactive');
    assert.equal(await page.evaluate(()=>window.__store.get().conversationId),conversation);
    assert.equal(await page.locator('#conversation-log .markdown-body').first().innerText(),script.text);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);await context.close();
    console.log(`${viewport.width}x${viewport.height}: clean overview, continuous numbers, native-only capability, one-tap spoken camera tour without mic, Markdown/XSS, sourced cards and direct history resume passed`);
  }
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
  for(const mode of ['interactive','companion']){
    await page.goto(`${origin}/modes.html`);await page.waitForSelector('.arrival-viewport');
    await page.locator(`a[href*="mode=${mode}"]`).tap();
    await page.waitForURL(`**/tour.html?mode=${mode}&entry=modes`);
    assert.equal(await page.locator('#app').getAttribute('data-tour-mode'),mode);
  }
  await page.close();
  console.log('Touch mode selection: first deliberate tap enters either mode');
}finally{await browser?.close();await proxy.close();}
