import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createConversationHistory,parseConversations,conversationTitle,HISTORY_KEY } from '../src/guide/conversation-history.js';

function fixture(options={}){
  let now=0,next=0;const timers=new Map(),data=new Map();
  const storage=options.storage??{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  const scope={setTimeout(fn,delay){timers.set(++next,{fn,at:now+delay});return next;},clearTimeout:id=>timers.delete(id)};
  const store=createStore(),history=createConversationHistory({store,storage,scope,requestTitle:options.requestTitle});
  const add=(id,role,text,patch={})=>store.set({messages:[...store.get().messages,{id,role,text,createdAt:10,...patch}].slice(-12)});
  const advance=async ms=>{now+=ms;const due=[...timers].filter(([,t])=>t.at<=now);await Promise.all(due.map(async([id,t])=>{timers.delete(id);await t.fn();}));await Promise.resolve();};
  return {store,history,storage,data,add,advance,timers};
}
test('every new window has a clean draft; previous conversations are durable and explicitly resumable',async()=>{
  const f=fixture(),first=f.history.start('text');
  f.add('u','user','介绍一下埃菲尔铁塔');f.add('a','assistant','可以留意钢架的线条。',{poiIds:['eiffel']});
  await Promise.resolve();const next=f.history.start('text');
  assert.notEqual(first,next);assert.deepEqual(f.store.get().messages,[]);assert.equal(f.store.get().conversationTitle,'新对话');
  assert.equal(f.history.list().length,1);assert.match(f.history.get(first).title,/铁塔/);
  f.history.flush();const stored=parseConversations(f.storage.getItem(HISTORY_KEY));
  assert.equal(stored.length,1);assert.deepEqual(stored[0].messages[1].poiIds,['eiffel']);
  assert.equal(f.history.resume(first),true);assert.equal(f.store.get().messages.length,2);
  const persisted=f.storage.getItem(HISTORY_KEY);f.history.dispose();
  assert.equal(parseConversations(persisted)[0].messages[0].text,'介绍一下埃菲尔铁塔');
});
test('all text, realtime and companion messages remain archived beyond the 12-row model window',async()=>{
  const f=fixture();
  for(const mode of ['text','voice','companion']){
    const id=f.history.start(mode);
    for(let i=0;i<24;i++)f.add(`${mode}-${i}`,i%2?'assistant':'user',`消息${i}`,{source:mode});
    await Promise.resolve();
    assert.equal(f.store.get().messages.length,12);
    assert.equal(f.store.get().conversationTranscript.length,24);
    assert.equal(f.history.get(id).messages.length,24);
    assert.ok(f.history.get(id).messages.every(row=>row.source===mode));
  }
  f.history.flush();assert.equal(parseConversations(f.storage.getItem(HISTORY_KEY)).length,3);f.history.dispose();
});
test('stream deltas replace one row, interruption replaces the archived text and state-only updates do not duplicate it',async()=>{
  const f=fixture(),id=f.history.start('voice');
  f.store.set({messages:[{id:'stream',role:'assistant',text:'第一段',partial:true,poiIds:['eiffel']}]});
  f.store.set({messages:[{id:'stream',role:'assistant',text:'第一段完整回答',partial:true,poiIds:['eiffel']}]});
  for(let i=0;i<5;i++)f.store.set({locationStatus:`定位${i}`});
  assert.equal(f.history.get(id).messages.length,1);
  f.store.set({messages:[{id:'stream',role:'assistant',text:'（这段回答已被打断）',interrupted:true,poiIds:[]}]});
  await Promise.resolve();f.history.flush();
  assert.equal(f.history.get(id).messages.length,1);
  assert.equal(parseConversations(f.storage.getItem(HISTORY_KEY))[0].messages[0].interrupted,true);f.history.dispose();
});
test('automatic model titles never cross into a newer draft; stale titles cannot overwrite changed content',async()=>{
  let resolveTitle,requested;
  const f=fixture({requestTitle:(rows)=>{requested=rows;return new Promise(resolve=>resolveTitle=resolve);}});
  const first=f.history.start('text');f.add('u','user','介绍铁塔');f.add('a','assistant','看钢架。');
  const advance=f.advance(1200);await Promise.resolve();
  assert.ok(requested.some(row=>row.content==='介绍铁塔'));
  const second=f.history.start('text');resolveTitle('铁塔钢架与建筑美学');await advance;await Promise.resolve();
  assert.equal(f.history.get(first).title,'铁塔钢架与建筑美学');
  assert.equal(f.store.get().conversationId,second);assert.equal(f.store.get().conversationTitle,'新对话');f.history.dispose();
});
test('corrupt storage, quota failures and forged media metadata do not break a conversation',()=>{
  assert.deepEqual(parseConversations('{bad'),[]);
  const value=JSON.stringify({version:1,conversations:[{id:'known',messages:[{role:'assistant',text:'正文',poiIds:['__proto__','https://bad.test/x','eiffel']}]}]});
  assert.deepEqual(parseConversations(value)[0].messages[0].poiIds,['eiffel']);
  const f=fixture({storage:{getItem(){return '{bad';},setItem(){throw new Error('Quota');}}});
  f.history.start('companion');f.add('a','assistant','沿途讲解');f.history.flush();
  assert.equal(f.history.list().length,1);assert.match(f.history.status(),/本页面/);f.history.dispose();
});
test('fallback titles use actual topics rather than a repeated greeting',()=>{
  assert.equal(conversationTitle([{role:'user',text:'你好'},{role:'user',text:'帮我规划游览路线'}]),'世界之窗游览路线');
  assert.match(conversationTitle([{role:'assistant',text:'金字塔的几何线条。'}]),/金字塔/);
  assert.match(conversationTitle([{role:'assistant',text:'先看塔脚。',poiIds:['eiffel'],interrupted:true}]),/埃菲尔铁塔/);
});
