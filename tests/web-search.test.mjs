import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearch, executeWebSearch, publicLink } from '../server/ai/web-search.ts';
import { runAgent } from '../server/ai/llm.ts';
import { messageReferences, messagePoiIds } from '../src/guide/message-media.js';

test('unconfigured search is explicit, never fetches, and accepts only a bounded query',async()=>{
  const search=createWebSearch({fetchImpl:()=>assert.fail('no credential means no network request')});
  assert.equal((await search('深圳地铁')).reason,'not_configured');
  for(const args of [{query:''},{query:'a'.repeat(301)},{query:'深圳',url:'https://evil.org'}])
    assert.ok((await executeWebSearch(args,search)).error);
});
test('web search uses one fixed endpoint, bounded sourced results, no unsafe media, and a short cache',async()=>{
  let calls=0;
  const search=createWebSearch({apiKey:'server-only',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://api.tavily.com/search');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer server-only');
    return Response.json({results:[{title:'地铁出行',url:'https://www.szmc.net/guide',content:'交通参考'},
      {title:'unsafe',url:'http://127.0.0.1/private',content:'PRIVATE'}],
      images:[{url:'https://images.example.org/station.jpg',description:'世界之窗地铁站',source_url:'https://www.szmc.net'},
        {url:'https://127.0.0.1/secret',description:'not public'}]});
  }});
  const result=await search('深圳世界之窗地铁');
  assert.equal(result.status,'success');assert.equal(result.results.length,1);assert.equal(result.images.length,1);
  await search('深圳世界之窗地铁');assert.equal(calls,1);
  assert.ok(!JSON.stringify(result).includes('server-only'));
  for(const url of ['javascript:alert(1)','https://user:pass@host.org/x','https://localhost/x','https://192.168.0.1/x','data:image/png,1'])
    assert.equal(publicLink(url),null);
});
test('search failure hides provider details and does not invent live results',async()=>{
  const search=createWebSearch({apiKey:'secret',fetchImpl:async()=>new Response('PRIVATE TOKEN',{status:401})});
  const result=await search('附近吃什么');
  assert.equal(result.status,'unavailable');assert.deepEqual(result.results,[]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('the text model awaits the server search tool and returns trace-owned source cards',async()=>{
  let round=0;
  const result=await runAgent({provider:{},city:'深圳',messages:[{role:'user',content:'附近地铁'}],
    webSearch:async()=>({status:'success',results:[{title:'地铁出行',url:'https://www.szmc.net/guide',content:'交通参考'}],images:[]}),
    complete:async(_provider,body)=>!round++?{choices:[{message:{tool_calls:[{id:'web',function:{name:'search_web',arguments:'{"query":"深圳世界之窗地铁"}'}}]}}]}
      : (assert.match(body.messages.at(-1).content,/交通参考/),{choices:[{message:{content:'可以乘坐地铁前往。'}}]})});
  const cards=messageReferences(result.traces);
  assert.equal(cards[0].title,'地铁出行');assert.equal(cards[0].kind,'web');
  assert.deepEqual(messagePoiIds(result.traces),[],'a transit answer must not inherit Eiffel photographs');
});
