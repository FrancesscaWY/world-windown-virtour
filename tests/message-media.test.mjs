import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/guide/store.js';
import { createGuideController } from '../src/guide/controller.js';
import { createTourActions } from '../src/guide/tour-actions.js';
import { createCallSession } from '../src/guide/call-session.js';
import { messagePoiIds,visualNavigationAllowed } from '../src/guide/message-media.js';
import { pinchIntent,pinchMapTransform } from '../src/components/map-controller.js';

const trace={id:'guidance',name:'get_attraction_guidance',status:'done',result:{status:'found',poi_id:'eiffel'}};
test('simple guidance restores image matching without a second model presentation tool',async()=>{
  const store=createStore({interactionMode:'text',interactionInput:'text'});
  const guide=createGuideController({store,actions:createTourActions(store),resolveIntent:async()=>({type:'answer',text:'从钢架线条看起。',traces:[trace]})});
  await guide.submit('介绍一下铁塔');
  assert.equal(store.get().view,'panorama');assert.equal(store.get().cameraTour.poiId,'eiffel');
  assert.equal(store.get().cameraNarrationEnabled,false,'text does not unexpectedly turn on sound');
  assert.deepEqual(store.get().messages.at(-1).poiIds,['eiffel']);guide.dispose();
});
test('explicit no-navigation preferences keep inline matched photos without forcing a map switch',async()=>{
  const store=createStore({interactionMode:'text',interactionInput:'text',view:'photo',selectedPoiId:'arc'});
  const guide=createGuideController({store,actions:createTourActions(store),resolveIntent:async()=>({type:'answer',text:'从钢架线条看起。',traces:[trace]})});
  await guide.submit('介绍铁塔，不要切换画面');
  assert.equal(store.get().view,'photo');assert.equal(store.get().selectedPoiId,'arc');
  assert.deepEqual(store.get().messages.at(-1).poiIds,['eiffel']);guide.dispose();
});
test('accepted companion arrival shows images and attaches them to the corresponding native transcript',()=>{
  const store=createStore({tourMode:'companion',interactionMode:'realtime'});let emit;
  const call=createCallSession({store,guide:{interrupt(){}},sounds:{play(){},stop(){},dispose(){}},
    createTransport:options=>{emit=options.onEvent;return{start(){},stop(){}};}});
  call.start();emit({type:'ready'});
  emit({type:'arrival',status:'skipped',poiId:'eiffel',turn:1});assert.equal(store.get().introductionView,null);
  emit({type:'arrival',status:'started',poiId:'eiffel',turn:2});assert.equal(store.get().introductionView.poiId,'eiffel');
  emit({type:'answer',responseId:'arrival',turn:2,text:'从钢架线条看起。'});
  assert.deepEqual(store.get().messages[0].poiIds,['eiffel']);
  emit({type:'response_done',responseId:'arrival',turn:2});assert.equal(store.get().messages[0].partial,false);
  emit({type:'speech_started',turn:3});emit({type:'answer',responseId:'thanks',turn:3,text:'不客气。'});
  assert.deepEqual(store.get().messages.at(-1).poiIds,[]);call.dispose();
});
test('media matching rejects unsuccessful and unknown tool results; pinch intent separates zoom from twist',()=>{
  assert.deepEqual(messagePoiIds([{...trace,status:'error'}]),[]);
  assert.deepEqual(messagePoiIds([{...trace,result:{status:'found',poi_id:'__proto__'}}]),[]);
  assert.equal(visualNavigationAllowed('不用切换图片，只讲故事'),false);
  const start=[{x:100,y:100},{x:200,y:100}],zoom=[{x:80,y:96},{x:220,y:104}],twist=[{x:150,y:50},{x:150,y:150}];
  assert.equal(pinchIntent(start,zoom),'zoom');assert.equal(pinchIntent(start,twist),'rotate');
  const result=pinchMapTransform({x:0,y:0,scale:1,rotation:0},start,zoom,{left:0,top:0},400,300,400,300,{rotate:false});
  assert.equal(result.rotation,0);assert.ok(result.scale>1.3);
});

test('a sentence tour archives its own playback rather than an unheard native model summary',()=>{
  const store=createStore({interactionMode:'realtime'});let emit;
  const call=createCallSession({store,guide:{interrupt(){}},sounds:{play(){},stop(){},dispose(){}},
    createTransport:options=>{emit=options.onEvent;return{start(){},stop(){}};}});
  call.start();emit({type:'ready'});
  emit({type:'answer',turn:1,responseId:'guided',text:'未播放的模型总结',audioSuppressed:true});
  assert.equal(store.get().messages.length,0);
  emit({type:'answer',turn:2,responseId:'next',text:'下一轮的正常回答'});
  assert.equal(store.get().messages[0].text,'下一轮的正常回答');call.dispose();
});

test('simple interactive spoken guidance starts a real synchronized panorama; companion still uses map photographs',()=>{
  const store=createStore({tourMode:'interactive',interactionMode:'realtime'});let emit;
  const call=createCallSession({store,guide:{interrupt(){}},sounds:{play(){},stop(){},dispose(){}},
    createTransport:options=>{emit=options.onEvent;return{start(){},stop(){}};}});
  call.start();emit({type:'ready'});
  emit({type:'tool_end',turn:1,trace});
  assert.equal(store.get().view,'panorama');assert.equal(store.get().cameraTour.narration,'sentence');
  assert.equal(store.get().cameraNarrationEnabled,true);
  emit({type:'tool_end',turn:1,trace:{id:'followup-visual',name:'introduce_view',status:'done',result:{status:'success',poi_id:'eiffel'}}});
  assert.equal(store.get().view,'panorama','late picture tools must not replace the active spoken camera tour');
  call.dispose();
});

test('hanging up preserves the transport interruption rather than finalizing an unheard queued answer',()=>{
  const store=createStore({interactionMode:'realtime'});let emit;
  const call=createCallSession({store,guide:{interrupt(){}},sounds:{play(){},stop(){},dispose(){}},
    createTransport:options=>{emit=options.onEvent;return{start(){},stop(){emit({type:'interrupted',responseId:'queued'});}};}});
  call.start();emit({type:'ready'});
  emit({type:'answer',turn:1,responseId:'queued',text:'尚未播完的回答'});
  call.stop();
  assert.equal(store.get().messages[0].interrupted,true);
  assert.match(store.get().messages[0].text,/已被打断/);call.dispose();
});
