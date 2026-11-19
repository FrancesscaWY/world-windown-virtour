import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLayout, mapOffset, mapPlane } from '../src/components/map-layout.js';
import { mapCalibration } from '../src/data/map-calibration.js';

test('phone registration stays flat and never rotates in response to viewport height', () => {
  for (const [width,height] of [[304,400],[374,650],[407,740]]) {
    const layout = mapLayout(width,height);
    assert.equal(layout.angle,14,'one registration angle for every viewport');
    assert.equal(layout.tiltY,undefined);assert.equal(layout.shear,undefined);
    assert.ok(Math.abs(layout.width/layout.height - mapCalibration.artwork.width/mapCalibration.artwork.height) < 1e-10);
    assert.ok(layout.boundsWidth <= width - 7 && layout.boundsHeight <= height - 15);
    assert.ok(layout.boundsWidth > width * .85,'fill available width without stretching');
    const center = mapOffset({ x:50,y:50 }, layout.width,layout.height,layout.angle,layout);
    assert.deepEqual(center,{x:0,y:0});
  }
});

test('oblique artwork and overlay coordinates share one invertible matrix; labels stay upright', () => {
  const layout = {...mapLayout(390,700),tiltY:.7,shear:.08}, plane = mapPlane(layout);
  const [a,b,c,d] = plane.transform.match(/matrix\(([^)]+)/)[1].split(',').map(Number);
  const [ia,ib,ic,id] = plane.upright.match(/matrix\(([^)]+)/)[1].split(',').map(Number);
  assert.ok(Math.abs(a*ia+c*ib-1)<1e-10 && Math.abs(b*ic+d*id-1)<1e-10);
  for (const point of [{x:10,y:20},{x:75,y:91}]) {
    const x=(point.x/100-.5)*layout.width,y=(point.y/100-.5)*layout.height;
    const projected=mapOffset(point,layout.width,layout.height,layout.angle,layout);
    assert.ok(Math.hypot(projected.x-a*x-c*y,projected.y-b*x-d*y)<1e-10);
  }
});

test('landscape uses the original geometry; rotation preserves lengths and can be reversed', () => {
  assert.equal(mapLayout(1000,600).angle,14);
  const point={x:72,y:36}, width=500,height=400;
  const before=mapOffset(point,width,height,0), after=mapOffset(point,width,height,60);
  assert.ok(Math.abs(Math.hypot(before.x,before.y)-Math.hypot(after.x,after.y))<1e-10);
  const inverse=mapOffset({x:after.x/width*100+50,y:after.y/height*100+50},width,height,-60);
  assert.ok(Math.abs(inverse.x-before.x)<1e-10 && Math.abs(inverse.y-before.y)<1e-10);
});
