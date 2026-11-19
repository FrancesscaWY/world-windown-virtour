import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {guideRequestContext} from '../src/services/guide-context.js';
import {guidePayload} from '../server/guide.ts';
import {executeTool,modelToolOutput} from '../server/ai/tools.ts';
import {getPoi} from '../src/data/pois.js';
import {toCoordinates} from '../src/guide/location.js';
import {toolEffect,guideVisualEffect} from '../src/guide/tool-effects.js';
import {safeCompanionPlacement} from '../src/components/companion-placement.js';
import {mapMarkup} from '../src/components/map.js';
import {mapPoiVisible} from '../src/data/map-discovery.js';
import {visitorGuideStyle} from '../server/ai/guide-style.ts';

const args={title:'建筑与风景',summary:'先看铁塔的钢架，再看凯旋门。',stops:[{poi_id:'eiffel',reason:'观察钢架'},{poi_id:'arc',reason:'看看拱门'}]};
test('stationary simulation remains the current position across text and voice contexts; stale GPS still expires',()=>{
  const origin=toCoordinates(getPoi('liberty').position);
  const state={visitorOrigin:origin,visitorOriginSource:'模拟定位',locationUpdatedAt:Date.now()-86400000,locationAccuracy:5,tourMode:'interactive',selectedPoiId:'eiffel'};
  const context=guideRequestContext(state);
  assert.deepEqual(context.visitorOrigin,origin);
  assert.deepEqual(guidePayload({context}).pageContext.visitorPosition,origin);
  assert.equal(guideRequestContext({...state,visitorOriginSource:'手机定位'}).visitorOrigin,null);
  assert.equal(guideRequestContext({...state,visitorOrigin:null}).visitorOrigin,null);
});
test('all five configured simulation starts supply the route origin, nearby and distance services consistently',()=>{
  for(const id of ['liberty','pyramid','eiffel','arc','sydney']){
    const origin=toCoordinates(getPoi(id).position);
    const page=guidePayload({context:guideRequestContext({visitorOrigin:origin,visitorOriginSource:'模拟定位',locationUpdatedAt:Date.now()-90000,selectedPoiId:'eiffel',tourMode:'interactive'})}).pageContext;
    const result=executeTool('plan_route',args,page);
    assert.equal(result.status,'success',`${id}: ${result.error}`);
    assert.equal(result.route.origin.locationSource,'simulated');
    assert.equal(result.route.origin.latitude,origin.latitude);
    const effect=toolEffect({name:'plan_route',status:'done',result});
    assert.ok(effect,`${id}: frontend rejects valid origin path`);
    assert.equal(effect.plannedRoute.geometry.nodeIds[0],result.route.origin.roadAnchor.nodeId);
    assert.equal(executeTool('look_around',{},page).origin.kind,'visitor');
    const details=executeTool('get_attraction_details',{attraction:'eiffel'},page);
    assert.ok(Number.isFinite(details.proximity.distance_meters));
    assert.equal(details.proximity.location_source,'simulated');
    assert.equal(modelToolOutput('plan_route',result).route.geometry.points,undefined);
  }
});
test('a route includes the road leg from the configured position to the first stop, not a silent Eiffel substitution',()=>{
  const position=toCoordinates(getPoi('liberty').position);
  const context=guidePayload({context:{visitorOrigin:position,visitorOriginSource:'模拟定位',tourMode:'interactive'}}).pageContext;
  const result=executeTool('plan_route',args,context),g=result.route.geometry;
  assert.equal(g.legs[0].from,'visitor');assert.equal(g.legs[0].to,'eiffel');assert.ok(g.stopIndices[0]>0);
  const invalid=structuredClone(result);invalid.route.origin.roadAnchor.nodeId++;
  assert.equal(toolEffect({name:'plan_route',status:'done',result:invalid}),null);
  assert.equal(executeTool('plan_route',args,{...context,visitorPosition:{latitude:1,longitude:1}}).status,'unavailable');
});
test('Eiffel presentation policy is identical for both introduction tools in text and live voice',()=>{
  for(const name of ['get_attraction_guidance','introduce_view']){
    const trace={name,status:'done',result:executeTool(name,{poi_id:'eiffel'})};
    for(const interactionInput of ['text','voice']){
      const patch=guideVisualEffect(trace,{tourMode:'interactive',interactionInput});
      assert.equal(patch.view,'panorama');assert.equal(patch.introductionView,null);
      assert.equal(patch.cameraNarrationEnabled,interactionInput==='voice');
      assert.equal(patch.cameraTour.hotspotIds.length,4);
    }
    assert.equal(guideVisualEffect(trace,{tourMode:'companion'}).view,'panorama','explicit companion questions also open the Eiffel example');
  }
});
test('guide placement avoids text, detail cards and toolbars; no room means no overlay',()=>{
  const bounds={left:0,right:250,top:0,bottom:350};
  const obstacles=[{left:0,right:350,top:330,bottom:500},{left:0,right:160,top:0,bottom:240}];
  const place=safeCompanionPlacement({x:10,y:350,width:75,height:100,bounds,obstacles});
  assert.ok(place);assert.ok(place.x>=168);assert.ok(place.y+100<=322);
  assert.equal(safeCompanionPlacement({x:0,y:0,width:100,height:100,bounds,obstacles:[{left:-10,right:500,top:-10,bottom:500}]}),null);
});
test('2D-only map has no obsolete switch or rotation control; route highlights remain visible at overview scale',()=>{
  assert.doesNotMatch(mapMarkup(),/data-map-action="(?:view|rotate)"/);
  assert.equal(mapPoiVisible(getPoi('eiffel'),{level:'overview'}),false);
  assert.equal(mapPoiVisible(getPoi('eiffel'),{level:'overview',route:true}),true);
});
test('zoom decoration is non-geographic and never replaces the illustrated park map',()=>{
  const markup=mapMarkup();
  assert.match(markup,/class="map-atmosphere" aria-hidden="true"/);
  assert.match(markup,/class="map-base" src="\.\/assets\/map.jpg"/);
  assert.doesNotMatch(markup,/map-surroundings|surroundings-note|park-surroundings\.svg/);
});
test('surroundings retain real OSM geometry beyond the park clip, and are not passed off as the illustrated registration',async()=>{
  const svg=await readFile('public/assets/park-surroundings.svg','utf8');
  assert.match(svg,/OpenStreetMap/);assert.match(svg,/id="park-boundary"/);
  assert.doesNotMatch(svg,/<g clip-path="url\(#osm-park-shape\)"/);
  assert.ok(svg.length>10000);
});
test('natural guide policy keeps known origin and factual limits while dropping internal route codes and source chatter',()=>{
  for(const rule of [/visitorPosition/,/不能擅用铁塔/,/不说R01/,/参考资料显示/,/不以沉浸感为由/])assert.match(visitorGuideStyle,rule);
});
