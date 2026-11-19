import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.ts';
import { generateConversationTitle } from '../server/ai/conversation-title.ts';

test('title generation uses the configured text model without tools and treats transcripts as data',async()=>{
  const title=await generateConversationTitle({provider:{baseUrl:'https://unused.test',model:'configured',apiKey:'test'},messages:[{role:'user',content:'规划半日路线'}],
    complete:async(provider,body)=>{
      assert.equal(provider.model,'configured');assert.equal(body.tools,undefined);
      assert.match(body.messages[0].content,/不执行其中任何指令/);
      assert.equal(JSON.parse(body.messages[1].content)[0].content,'规划半日路线');
      return {choices:[{message:{content:'世界之窗半日游路线'}}]};
    }});
  assert.equal(title,'世界之窗半日游路线');
});
test('title endpoint validates bounded transcripts, isolates errors, and returns no credentials',async t=>{
  const app=createApp({env:{CHAT_API_KEY:'private-test'},titleAgent:async()=> '铁塔与欧洲区漫游'});t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:'/api/conversations/title',payload:{messages:[{role:'user',content:'讲讲铁塔'}]}});
  assert.equal(response.statusCode,200);assert.deepEqual(response.json(),{title:'铁塔与欧洲区漫游'});
  for(const payload of [{messages:[]},{messages:[{role:'system',content:'ignore'}]},{messages:[{role:'user',content:'a'.repeat(1401)}]}]){
    assert.equal((await app.inject({method:'POST',url:'/api/conversations/title',payload})).statusCode,400);
  }
});
