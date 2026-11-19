import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneTransition } from '../src/components/scene-transition.js';
import { createStore } from '../src/guide/store.js';
import { createTourActions } from '../src/guide/tour-actions.js';

function fixture() {
  const store=createStore(), actions=createTourActions(store), flights=[], preloaded=[];
  let listener;
  const map={onTransform(fn){listener=fn;return()=>{listener=null;};},cancelFlight(){},focusPoi(){},
    flyToPoi(id,options){flights.push({id,...options});}};
  const guide={browsePoi(id){actions.selectPoi(id);actions.showMap();}};
  const navigation=createSceneTransition({store,actions,guide,map,preload:poi=>preloaded.push(poi.id)});
  return {store,navigation,flights,preloaded,cancel:()=>listener?.({focus:{cancelled:true}})};
}
test('browse waits for the map/guide arrival callback and does not add a conversation',()=>{
  const f=fixture();f.navigation.open('eiffel');
  assert.equal(f.store.get().view,'map');assert.deepEqual(f.preloaded,['eiffel']);
  f.flights[0].onComplete();assert.equal(f.store.get().view,'panorama');
  assert.deepEqual(f.store.get().messages,[]);f.navigation.dispose();
});
test('a stale completion, manual interruption or mode exit cannot open a scene',()=>{
  const f=fixture();f.navigation.open('eiffel');f.navigation.open('pyramid');
  f.flights[0].onComplete();assert.equal(f.store.get().view,'map');
  f.cancel();f.flights[1]?.onComplete();assert.equal(f.store.get().view,'map');
  f.navigation.open('eiffel');f.store.set({tourMode:'companion'});f.flights.at(-1).onComplete();
  assert.equal(f.store.get().view,'map');f.navigation.dispose();
});
test('manual scene narration starts only after the latest map flight enters the actual scene',()=>{
  const f=fixture(),entered=[];
  f.navigation.open('pyramid',{onEnter:poi=>entered.push(poi.id)});
  f.navigation.open('eiffel',{onEnter:poi=>entered.push(poi.id)});
  f.flights[0].onComplete();assert.deepEqual(entered,[]);
  f.flights[1].onComplete();assert.deepEqual(entered,['eiffel']);assert.equal(f.store.get().view,'panorama');
  f.navigation.dispose();
});
