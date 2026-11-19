import test from 'node:test';
import assert from 'node:assert/strict';
import { touristMapSections, touristMapNumbers, majorMapPois, mapDetailLevel, mapPoiVisible, mapRegionAnchor, mapRegions } from '../src/data/map-discovery.js';
import { pois, getPoi } from '../src/data/pois.js';
import { touristMapIndexMarkup } from '../src/components/tourist-map-index.js';
import { mapMarkup } from '../src/components/map.js';

test('current map numbering is continuous from one and reference index never invents coordinates',()=>{
  const values=Object.values(touristMapNumbers).sort((a,b)=>a-b);
  assert.deepEqual(values,Array.from({length:pois.filter(poi=>poi.position).length},(_,i)=>i+1));
  assert.equal(touristMapNumbers.eiffel,1);
  assert.ok(majorMapPois.every(id=>getPoi(id)?.position));
  for(const section of touristMapSections)for(const item of section.entries){
    if(item.poiId)assert.ok(getPoi(item.poiId),item.poiId);
    assert.equal(item.position,undefined);
  }
  const index=touristMapIndexMarkup();assert.match(index,/冒险峡谷/);assert.match(index,/极地冰川/);
  assert.match(index,/位置待核实/);assert.doesNotMatch(index,/data-reference-poi="undefined"/);
});
test('full park shows regions only; zoom reveals landmarks and detailed scenery',()=>{
  assert.equal(mapDetailLevel(1,390),'overview');assert.equal(mapDetailLevel(2,390),'landmarks');
  assert.equal(mapDetailLevel(3,390),'detail');
  assert.equal(mapPoiVisible(getPoi('eiffel'),{level:'overview'}),false);
  assert.equal(mapPoiVisible(getPoi('egypt-gate'),{level:'overview'}),false);
  assert.equal(mapPoiVisible(getPoi('egypt-gate'),{level:'detail'}),true);
  assert.equal(mapPoiVisible(getPoi('egypt-gate'),{level:'overview',forced:true}),false);
  assert.equal(mapPoiVisible(getPoi('eiffel'),{level:'detail',category:'food'}),false);
  assert.equal(mapPoiVisible(getPoi('niagara'),{level:'landmarks'}),true);
});
test('region text uses representative existing anchors, not an average of remote island exhibits',()=>{
  assert.deepEqual(mapRegionAnchor('大洋洲区',pois),getPoi('sydney').position);
  assert.equal(mapRegionAnchor('冒险峡谷',pois),null);
});
test('settings replaces the last map location pin and reference hierarchy stays in native markup',()=>{
  const html=mapMarkup();
  assert.match(html,/data-map-action="settings"/);assert.doesNotMatch(html,/data-map-action="locate"/);
  assert.match(html,/data-map-region="欧洲区"/);assert.match(html,/data-map-tier="detail"/);
  assert.match(html,/class="map-poi-number">1</);
});
test('regional number colors support white small text at at least 4.5:1 contrast',()=>{
  const luminance=color=>{
    const [r,g,b]=color.slice(1).match(/../g).map(hex=>parseInt(hex,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
    return r*.2126+g*.7152+b*.0722;
  };
  for(const region of mapRegions)assert.ok(1.05/(luminance(region.color)+.05)>=4.5,`${region.name}: ${region.color}`);
  assert.equal(mapDetailLevel(1,1440),'overview');
});
