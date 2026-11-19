import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSimulator } from '../src/components/location-simulator.js';
import { getPoi } from '../src/data/pois.js';
import { toCoordinates, distanceMeters } from '../src/guide/location.js';

function fixture(source = 'simulated') {
  let time=0, next=0;
  const timers=new Map(), positions=[], sources=[];
  const node=(value='')=>({value,checked:false,hidden:false,listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);},emit(type){this.listeners.get(type)?.();}});
  const nodes={'[data-source]':node(source),'[data-walk]':node(),'[data-location]':node('0'),'[data-speed]':node('7'),'[data-reset]':node(),'[data-controls]':node()};
  const dialog=node();dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.emit('close');};
  nodes['#simulation-sheet']=dialog;nodes['[data-close]']=node();nodes['[data-done]']=node();nodes['[data-device]']=node();
  const container={hidden:true,querySelector:selector=>nodes[selector],replaceChildren(){}};
  const scope={Date:{now:()=>time},setInterval:fn=>{timers.set(++next,fn);return next;},clearInterval:id=>timers.delete(id)};
  const simulator=mountSimulator({container,scope,onPosition:(point,source)=>positions.push({...point,source}),onSource:source=>sources.push(source)});
  const advance=ms=>{time+=ms;for(const tick of [...timers.values()])tick();};
  return {simulator,container,nodes,timers,positions,sources,advance};
}

test('explicit simulation starts at one stationary mock fix and exposes heading',()=>{
  const f=fixture();f.simulator.setActive(true,{moving:false});
  assert.equal(f.container.hidden,false);assert.equal(f.timers.size,0);assert.equal(f.positions.length,1);
  assert.deepEqual(f.sources,[]);assert.equal(f.simulator.getSource(),'simulated');
  assert.ok(f.positions[0].heading>=0 && f.positions[0].heading<360);
  f.advance(1000);assert.equal(f.positions.length,1);
  assert.match(f.container.innerHTML,/<dialog id="simulation-sheet"/);
  assert.doesNotMatch(f.container.innerHTML,/simulation-settings|<summary/);
  assert.doesNotMatch(f.container.innerHTML,/data-companion-toggle|暂停伴游/);
  f.simulator.dispose();
});

test('one dialog opens/closes independently of the demo lifecycle and preview does not walk before start',()=>{
  const f=fixture();f.simulator.setPaused(true);f.simulator.setActive(true,{moving:true});
  assert.equal(f.timers.size,0);assert.equal(f.positions.length,1);assert.equal(f.nodes['[data-walk]'].checked,true);
  f.simulator.open();assert.equal(f.nodes['#simulation-sheet'].open,true);
  f.nodes['[data-done]'].emit('click');assert.equal(f.nodes['#simulation-sheet'].open,false);
  f.simulator.setPaused(false);f.advance(250);assert.equal(f.positions.length,2);
  f.simulator.open();f.simulator.setActive(false);assert.equal(f.nodes['#simulation-sheet'].open,false);
  f.simulator.dispose();
});

test('the default device source neither fabricates a fix nor requests GPS until activated by the visitor',()=>{
  const f=fixture('device');f.simulator.setActive(true,{moving:false});
  assert.equal(f.positions.length,0);assert.deepEqual(f.sources,[]);
  assert.match(f.container.innerHTML,/<option value="device">/);
  f.simulator.setSource('simulated');assert.equal(f.positions.length,1);assert.deepEqual(f.sources,['simulated']);
  f.simulator.dispose();
});

test('companion auto-walking pauses without losing position, repeated activation does not reset',()=>{
  const f=fixture();f.simulator.setActive(true);
  assert.equal(f.positions.at(-1).source,'模拟定位');
  assert.equal(distanceMeters(f.positions.at(-1),toCoordinates(getPoi('liberty').position)),0);
  assert.equal(f.timers.size,1);f.simulator.setActive(true);assert.equal(f.positions.length,1);
  f.advance(250);assert.ok(distanceMeters(f.positions[0],f.positions.at(-1))>1);
  const paused=f.positions.at(-1),count=f.positions.length;
  f.simulator.setPaused(true);f.advance(30000);assert.equal(f.timers.size,0);assert.equal(f.positions.length,count);
  f.simulator.setPaused(false);f.advance(250);
  const travelled=distanceMeters(paused,f.positions.at(-1));assert.ok(travelled>1 && travelled<2);
  f.simulator.setActive(false);f.advance(1000);assert.equal(f.timers.size,0);
  f.simulator.dispose();assert.ok(Object.values(f.nodes).every(n=>n.listeners.size===0));
});

test('source, speed, start and walking are explicit folded demo settings',()=>{
  const f=fixture();f.simulator.setActive(true,{moving:false});
  const source=f.nodes['[data-source]'];source.value='device';source.emit('change');
  assert.deepEqual(f.sources,['device']);assert.equal(f.timers.size,0);assert.equal(f.nodes['[data-controls]'].hidden,true);
  source.value='simulated';source.emit('change');assert.equal(f.nodes['[data-controls]'].hidden,false);
  const location=f.nodes['[data-location]'];location.value='2';location.emit('change');
  assert.ok(distanceMeters(f.positions.at(-1),toCoordinates(getPoi('eiffel').position))<.001);
  f.nodes['[data-walk]'].checked=true;f.nodes['[data-walk]'].emit('change');assert.equal(f.timers.size,1);
  f.simulator.setActive(true,{moving:false});assert.equal(f.timers.size,1,'unrelated activation preserves the explicit walking choice');
  f.simulator.setActive(false);f.simulator.dispose();
});

test('throttled tabs keep steps bounded; disposal is final and cancels future updates',()=>{
  const f=fixture();f.simulator.setActive(true);const first=f.positions.at(-1);f.advance(60000);
  assert.ok(distanceMeters(first,f.positions.at(-1))<=7.01);
  const count=f.positions.length;f.simulator.dispose();f.simulator.dispose();f.simulator.setActive(true);f.advance(1000);
  assert.equal(f.positions.length,count);assert.equal(f.timers.size,0);
});

test('route finishes at its last landmark with no out-of-range segment or running timer',()=>{
  const f=fixture();f.simulator.setActive(true);
  for(let step=0;step<2000 && f.timers.size;step++)f.advance(1000);
  assert.equal(f.timers.size,0);assert.equal(f.nodes['[data-walk]'].checked,false);
  assert.ok(f.positions.every(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Number.isFinite(p.heading)));
  assert.ok(distanceMeters(f.positions.at(-1),toCoordinates(getPoi('sydney').position))<.001);f.simulator.dispose();
});
