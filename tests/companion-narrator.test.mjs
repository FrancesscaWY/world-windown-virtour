import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionNarrator } from '../src/guide/companion-narrator.js';
import { createStore } from '../src/guide/store.js';
import { getPoi } from '../src/data/pois.js';
import { toCoordinates } from '../src/guide/location.js';
import { callPresentation } from '../src/components/call-status.js';
import { guideRequestContext } from '../src/services/guide-context.js';

function fixture() {
  let now=100000;const sent=[];
  const position=toCoordinates(getPoi('eiffel').position);
  const store=createStore({tourMode:'companion',interactionMode:'realtime',callState:'connected',callInput:'listening',
    guideStatus:'listening',visitorOrigin:position,locationAccuracy:5,locationUpdatedAt:now});
  const scope={Date:{now:()=>now},setInterval:()=>1,clearInterval(){}};
  const narrator=createCompanionNarrator({store,scope,callSession:{narrateLocation(id){sent.push(id);return true;}}});
  return {store,narrator,sent,advance(ms){now+=ms;store.set({locationUpdatedAt:now});narrator.flush();}};
}
test('arrival is queued during conversation and yields for 15 seconds after visitor speech',()=>{
  const f=fixture();f.store.set({callInput:'speaking',guideStatus:'listening'});
  f.narrator.offer('eiffel');assert.deepEqual(f.sent,[]);
  f.store.set({callInput:'listening',guideStatus:'thinking'});
  f.advance(16000);assert.deepEqual(f.sent,[]);
  f.store.set({guideStatus:'listening'});assert.deepEqual(f.sent,['eiffel']);
  f.narrator.offer('eiffel');f.advance(60000);assert.deepEqual(f.sent,['eiffel']);f.narrator.dispose();
});
test('stale, inaccurate, distant, background, muted and paused fixes do not start narration',()=>{
  for(const patch of [{locationUpdatedAt:0},{locationAccuracy:150},{visitorOrigin:toCoordinates(getPoi('sydney').position)},
    {pageBackgrounded:true},{callMuted:true},{companionPaused:true},{interactionMode:'text'}]){
    const f=fixture();f.store.set(patch);f.narrator.offer('eiffel');assert.deepEqual(f.sent,[],JSON.stringify(patch));f.narrator.dispose();
  }
});
test('latest nearby arrival replaces the queue and source reset discards pending work',()=>{
  const f=fixture();f.store.set({guideStatus:'speaking'});f.narrator.offer('sydney');f.narrator.offer('eiffel');
  f.store.set({guideStatus:'listening'});assert.deepEqual(f.sent,['eiffel']);
  f.narrator.reset();f.store.set({guideStatus:'thinking'});f.narrator.offer('eiffel');f.narrator.reset();
  f.store.set({guideStatus:'listening'});assert.deepEqual(f.sent,['eiffel']);f.narrator.dispose();
});
test('companion status never calls a stale GPS fix continuous tracking',()=>{
  const f=fixture(),s=f.store.get();
  assert.match(callPresentation(s,110000).hint,/持续定位/);
  assert.match(callPresentation(s,140000).hint,/定位更新已暂停/);
  assert.match(callPresentation({...s,pageBackgrounded:true},110000).hint,/后台受系统限制/);
  f.narrator.dispose();
});
test('model context does not present stale or inaccurate GPS as a current visitor position',()=>{
  const visitorOrigin=toCoordinates(getPoi('eiffel').position);
  assert.equal(guideRequestContext({visitorOrigin,locationUpdatedAt:null}).visitorOrigin,null);
  assert.equal(guideRequestContext({visitorOrigin,locationUpdatedAt:Date.now()-60000}).visitorOrigin,null);
  assert.equal(guideRequestContext({visitorOrigin,locationUpdatedAt:Date.now(),locationAccuracy:150}).visitorOrigin,null);
  assert.deepEqual(guideRequestContext({visitorOrigin,locationUpdatedAt:Date.now(),locationAccuracy:5}).visitorOrigin,visitorOrigin);
});
