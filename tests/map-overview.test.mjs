import test from 'node:test';
import assert from 'node:assert/strict';
import { mapScreenToArtwork, mapViewportFootprint, mapOverviewMarkup } from '../src/components/map-overview.js';
import { mapLayout, mapOffset } from '../src/components/map-layout.js';
import { rotateMapPoint } from '../src/components/map-controller.js';
import { mapRegionColor } from '../src/data/map-discovery.js';
import { mapMarkup } from '../src/components/map.js';

test('overview inverse matches actual map plane across tilt, pan, rotation and zoom',()=>{
  for(const [width,height] of [[390,620],[1440,700],[320,116]]){
    const layout=mapLayout(width-48,height);layout.centerX-=24;
    for(const rotation of [0,90,-35])for(const scale of [.65,1,2.8,5.5]){
      const state={x:-27,y:46,rotation,scale};
      const camera={state,width,height,artWidth:layout.width,artHeight:layout.height,layout};
      for(const point of [{x:4,y:8},{x:63,y:56},{x:90,y:81}]){
        const p=mapOffset(point,layout.width,layout.height,layout.angle,layout);
        const rotated=rotateMapPoint({x:p.x+layout.centerX,y:p.y+layout.centerY},rotation);
        const result=mapScreenToArtwork({x:width/2+state.x+rotated.x*scale,y:height/2+state.y+rotated.y*scale},camera);
        assert.ok(Math.abs(result.x-point.x)<1e-8 && Math.abs(result.y-point.y)<1e-8);
      }
      assert.equal(mapViewportFootprint(camera).length,4);
    }
  }
});
test('zoom shrinks the overview viewport without changing its geographic center',()=>{
  const camera={width:400,height:300,artWidth:400,artHeight:300,layout:{angle:0,centerX:0,centerY:0},state:{x:0,y:0,rotation:0,scale:1}};
  const full=mapViewportFootprint(camera),zoomed=mapViewportFootprint({...camera,state:{...camera.state,scale:2}});
  assert.deepEqual(full,[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
  assert.deepEqual(zoomed,[{x:25,y:25},{x:75,y:25},{x:75,y:75},{x:25,y:75}]);
});
test('only region numbers retain color, while landmarks have no colored bubble metadata',()=>{
  const colors=['欧洲区','非洲区','亚洲区','大洋洲区','美洲区','世界广场','游乐体验'].map(mapRegionColor);
  assert.equal(new Set(colors).size,7);
  const html=mapMarkup();
  for(const color of colors.slice(0,6))assert.ok(html.includes(`--region-color:${color}`));
  assert.doesNotMatch(html,/--region-bubble:/);
  assert.match(mapOverviewMarkup(),/overview-window/);assert.match(mapOverviewMarkup(),/overview-visitor/);
  assert.doesNotMatch(html,/data-map-action="orient"/);
});
