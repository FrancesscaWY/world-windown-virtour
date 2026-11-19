import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createNativeCompanion } from '../src/services/native-companion.js';
import { getPoi } from '../src/data/pois.js';
import { readFile } from 'node:fs/promises';

test('ordinary browsers do not advertise native background audio',()=>{
  const native=createNativeCompanion({store:createStore(),history:{},scope:{}});
  assert.equal(native.available,false);assert.equal(native.start(),false);native.dispose();
});
test('native background queue contains reviewed stops, never opens a microphone, and validates bridge messages',()=>{
  const commands=[],archived=[];let receive;
  const scope={location:{origin:'https://guide.example.org'},webkit:{messageHandlers:{virtourNative:{postMessage:value=>commands.push(value)}}},
    addEventListener(_type,fn){receive=fn;},removeEventListener(){}};
  const store=createStore({tourMode:'companion',visitorOriginSource:'模拟定位'});
  const native=createNativeCompanion({store,scope,history:{start:()=> 'conversation',archive:(id,row)=>archived.push({id,row}),get(){}}});
  native.start();
  const command=commands.find(item=>item.command==='start');
  assert.equal(command.mode,'sequence');assert.equal(command.items[0].id,'eiffel');
  assert.ok(command.items.length<=12);assert.ok(command.items.every(item=>getPoi(item.id)?.locationVerified));
  const event={source:scope,origin:scope.location.origin,data:{channel:'virtour.native',type:'records',records:[{id:'a',conversationId:'conversation',poiId:'eiffel',status:'finished'}]}};
  receive({...event,origin:'https://evil.org'});assert.equal(archived.length,0);
  receive(event);assert.equal(archived[0].row.text,getPoi('eiffel').summary);
  native.pause(true);assert.equal(commands.at(-1).command,'pause');native.stop();assert.equal(native.active,false);native.dispose();
});
test('iOS wrapper delegates lock-screen audio and location to native frameworks with bounded public-origin bridge',async()=>{
  const audio=await readFile('native/ios/Sources/BackgroundGuide.swift','utf8');
  const wrapper=await readFile('native/ios/Sources/VirTourApp.swift','utf8');
  for(const text of ['AVAudioPlayer','setCategory(.playback','MPRemoteCommandCenter','allowsBackgroundLocationUpdates','point.horizontalAccuracy <= 65','distance <= 35','completionHandler(nil)'])
    assert.ok(audio.includes(text),text);
  for(const text of ['message.frameInfo.isMainFrame','origin.protocol == "https"','origin.host == base.host'])
    assert.ok(wrapper.includes(text),text);
});
