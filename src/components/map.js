import { pois as catalogPois } from '../data/pois.js';
import { externalAssets } from '../data/external-assets.js';
import { facilities as catalogFacilities, facilityMapPosition } from '../data/facilities.js';
import { mountFacilityBubbles } from './facilities.js';
import { icon, landmark, facilityIcon } from './icons.js';
import { clampMapTransform, zoomMapAt, pinchMapTransform, pinchIntent, rotateMapPoint, normalizeRotation, MAP_LIMITS } from './map-controller.js';
import { projectMapPosition } from './map-projection.js';
import { roadNetworkMarkup, mountRoadNetwork } from './road-network.js';
import { mapLayout, mapOffset, mapPlane } from './map-layout.js';
import { touristMapNumbers, majorMapPois, mapRegions, mapDetailLevel, mapPoiVisible, mapRegionAnchor, mapRegionColor } from '../data/map-discovery.js';
import { mapOverviewMarkup, mountMapOverview } from './map-overview.js';

// Display registration must never overwrite geographic catalog coordinates.
const pois = catalogPois.map(poi => ({ ...poi, position: projectMapPosition(poi.position) }));
const facilities = catalogFacilities.map(item => ({ ...item, position: projectMapPosition(facilityMapPosition(item)) }));

/** Roads are authored in artwork space; geographic anchors are projected for display. */
export function mapMarkup() {
  return `<div class="map-viewport" role="region" tabindex="0" aria-label="世界之窗园区地理地图，非实时导航" aria-describedby="map-help" data-facility-view="all" data-map-view="relief">
    <div class="map-atmosphere" aria-hidden="true">
      <svg viewBox="0 0 600 700" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g class="map-paper-contours" fill="none">
          <path d="M-50 138C36 53 138 64 172 5M-40 164C58 79 154 93 203 7M-28 192C73 109 172 122 232 12"/>
          <path d="M420 692C428 610 531 598 649 530M450 714C456 636 550 625 658 557M482 732C486 661 575 653 670 587"/>
        </g>
        <ellipse class="map-travel-orbit" cx="300" cy="345" rx="226" ry="277" transform="rotate(-22 300 345)" fill="none"/>
        <g class="map-paper-spark" fill="none">
          <path d="M111 138v12m-6-6h12M479 548v12m-6-6h12M470 116v8m-4-4h8"/>
          <circle cx="141" cy="572" r="3"/><circle cx="511" cy="220" r="2"/>
        </g>
        <g class="map-paper-compass" transform="translate(78 541)" fill="none">
          <circle r="26"/><circle r="20"/>
          <path d="m0-17 5 17-5 17-5-17Z"/><path d="m-17 0 17-5 17 5-17 5Z"/>
          <path d="M0-31v8m0 38v8M-31 0h8m38 0h8"/>
        </g>
      </svg>
    </div>
    <div class="map-art">
      <img class="map-base" src="${externalAssets.map.file}" alt="世界之窗手绘导览地图" draggable="false"/>
      ${roadNetworkMarkup()}
      ${pois.filter(poi => poi.position).map(poi => `<button type="button" class="map-poi" style="--x:${poi.position.x}%;--y:${poi.position.y}%;--region-color:${mapRegionColor(poi.region)}" data-poi="${poi.id}" data-region="${poi.region}" data-map-tier="${majorMapPois.includes(poi.id)?'major':'detail'}" aria-label="${poi.region}，查看${poi.name}，景点编号${touristMapNumbers[poi.id]}" aria-pressed="false"><span class="map-poi-pin" aria-hidden="true">${landmark(poi.id)}<small class="map-poi-number">${touristMapNumbers[poi.id]}</small></span><span class="map-poi-label">${poi.id === 'eiffel' ? '铁塔' : poi.name}</span></button>`).join('')}
      ${mapRegions.map(region=>{const p=mapRegionAnchor(region.name,pois);return p?`<button type="button" class="map-region" data-map-region="${region.name}" style="--x:${p.x}%;--y:${p.y}%;--region-color:${region.color}" aria-label="放大${region.name}的景点">${region.name}</button>`:'';}).join('')}
      ${facilities.filter(item => item.position).map(item => `<button type="button" class="map-facility${item.anchorPoiId ? ' facility-area' : ''}" style="--x:${item.position.x}%;--y:${item.position.y}%" data-facility="${item.id}" aria-label="${item.name}${item.anchorPoiId ? '，资料所述区域，非精确店址' : item.kind === 'gate' ? '，通行待核实' : ''}" title="${item.note}" aria-pressed="false"><span class="facility-pin" aria-hidden="true">${facilityIcon(item.kind,item.id)}</span><span class="map-poi-label">${item.name}${item.anchorPoiId ? '<small>资料区域</small>' : item.kind === 'gate' ? ' · 待核实' : ''}</span></button>`).join('')}
    </div>
    <div class="map-bubbles" aria-label="地图地点信息"></div>
    <div class="map-controls" role="group" aria-label="地图控制">
      <button type="button" class="map-control" data-map-action="zoom-in" aria-label="放大地图"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <output class="map-zoom" aria-label="地图缩放比例">100%</output>
      <button type="button" class="map-control" data-map-action="zoom-out" aria-label="缩小地图"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      <span class="map-control-divider" aria-hidden="true"></span>
      <button type="button" class="map-control map-reset" data-map-action="reset" aria-label="看全园"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 3v4m0 10v4M3 12h4m10 0h4"/></svg><span>全园</span></button>
      <button type="button" class="map-control map-reset map-roads-toggle" data-map-action="roads" aria-label="隐藏路网" aria-pressed="true" aria-controls="map-road-network" title="隐藏路网"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 4M6 6l4 12m8-8-8 8"/><circle cx="6" cy="6" r="2.5" fill="var(--tour-paper,#fffaf0)"/><circle cx="18" cy="10" r="2.5" fill="var(--tour-paper,#fffaf0)"/><circle cx="10" cy="18" r="2.5" fill="var(--tour-paper,#fffaf0)"/></svg><span>路网</span></button>
      <button type="button" id="map-settings-button" class="map-control" data-map-action="settings" aria-label="定位与演示设置" title="定位与演示设置" aria-haspopup="dialog" aria-controls="simulation-sheet" aria-expanded="false">${icon('settings')}</button>
    </div>
    ${mapOverviewMarkup()}
    <span class="map-mood" aria-hidden="true">一张地图，环游世界<span>跟着好奇心出发</span></span>
    <p id="map-help" class="sr-only">绿色轮廓表示园区边界。路网按底图中可见道路手工描绘，供游览示意；用路网按钮显示或隐藏。拖动、双指缩放和旋转地图。键盘方向键平移，加减键缩放，方括号旋转，Home 键复位。点击景点先移动导游，再进入已有实景。</p>
    <span class="map-caption"><span class="map-detail-label">分区与主要景点</span> · ${externalAssets.map ? '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>' : '示意地图'}</span>
  </div>`;
}

/** Returns cleanup(); cleanup.focusPoi(id) and cleanup.reset() are also available. */
export function mountMap(container, { onSelect = () => {}, onFacility = () => {}, onFacilityKind = () => {}, onDismissFacilities = () => {}, onSettings = () => {} } = {}) {
  const viewport = container.matches?.('.map-viewport') ? container : container.querySelector('.map-viewport');
  if (!viewport) throw new Error('Map viewport not found.');
  const art = viewport.querySelector('.map-art');
  if (!art) throw new Error('Map artwork not found.');
  const view = viewport.ownerDocument.defaultView;
  const controls = viewport.querySelector('.map-controls');
  const output = viewport.querySelector('.map-zoom');
  const mood = viewport.querySelector('.map-mood');
  const bubbles = mountFacilityBubbles(viewport, onDismissFacilities);
  const disposeRoadNetwork = mountRoadNetwork(viewport);
  const zoomIn = viewport.querySelector('[data-map-action="zoom-in"]');
  const zoomOut = viewport.querySelector('[data-map-action="zoom-out"]');
  const overview=mountMapOverview(viewport,(point,resetView)=>{
    interruptFlight();
    if(resetView)reset();else focusPoint(point,Math.max(1.8,state.scale));
  });
  const pointers = new Map(); const listeners = [];
  const home = { x: 0, y: 0, scale: 1, rotation:0, pitch:0 };
  let state = { ...home };
  let gesture = null; let moved = false; let suppressClickUntil = 0; let destroyed = false;
  const previousStyles = { transform: art.style.transform, transformOrigin: art.style.transformOrigin, touchAction: viewport.style.touchAction,
    width:art.style.width, height:art.style.height, left:art.style.left, top:art.style.top };
  art.style.transformOrigin = '50% 50%'; viewport.style.touchAction = 'none';
   let lastDimensions = { width: 0, height: 0 };
   let layoutFrozen = false;
  let artWidth = 0; let artHeight = 0;
  let layout = { angle:0, centerX:0, centerY:0, boundsWidth:0, boundsHeight:0 };
  let flatLayout=null;
  const projectLayout=base=>({...base,tiltY:1,shear:0});
  const offset = point => {
    const p = mapOffset(point, artWidth, artHeight, layout.angle, layout);
    return rotateMapPoint({ x:p.x + layout.centerX, y:p.y + layout.centerY }, state.rotation);
  };
  const headingAngle = (point, next) => {
    const a=offset(point),b=offset(next);
    return (Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI+360)%360;
  };
  let flight = null, focus = null, focusSequence = 0;
  const transformListeners = new Set();
  const cancelFlight = () => { if (flight !== null) view.cancelAnimationFrame(flight); flight = null; };
  let facilityKind = 'all'; let selectedFacility = null;
  const facilityMarkers = [...art.querySelectorAll('[data-facility]')];
  const markers = [...art.querySelectorAll('[data-poi]')];
  const regionMarkers=[...art.querySelectorAll('[data-map-region]')];
  const featured = [...majorMapPois,'niagara','colosseum'];
  const priority = marker => Number(marker.classList.contains('route-stop')) * 200 + Number(marker.classList.contains('selected') || marker.classList.contains('recommended')) * 100 + (featured.includes(marker.dataset.poi) ? 20-featured.indexOf(marker.dataset.poi) : 0);
  const refreshMarkers = () => {
    if (mood) mood.hidden = facilityKind !== 'all' || state.scale > 1.01 || ((lastDimensions.height-artHeight)/2 < 145 && (lastDimensions.width-artWidth)/2 < 250);
    const kept = [], level=mapDetailLevel(state.scale,lastDimensions.width);
    viewport.dataset.mapDetail=level;
    const detailLabel=viewport.querySelector('.map-detail-label');
     if(detailLabel)detailLabel.textContent=level==='overview'?'园区分区':level==='landmarks'?'主要景点 · 继续放大看细节':'景点细节';
    for (const marker of [...facilityMarkers].sort((a,b) => Number(b.dataset.facility === selectedFacility)-Number(a.dataset.facility === selectedFacility))) {
      const item = facilities.find(f => f.id === marker.dataset.facility);
      const p = offset(item.position), x = p.x * state.scale, y = p.y * state.scale;
      const selected = item.id === selectedFacility;
      marker.classList.toggle('highlighted', facilityKind === item.kind || facilityKind === 'other' && !['food','toilets'].includes(item.kind));
      marker.classList.toggle('selected', selected); marker.setAttribute('aria-pressed', String(selected));
      marker.hidden = facilityKind === 'all' || (facilityKind === 'other' ? ['food','toilets'].includes(item.kind) : item.kind !== facilityKind) || kept.some(p => Math.abs(p.x-x)<75 && Math.abs(p.y-y)<64);
      if (!marker.hidden) kept.push({x,y,facility:true});
    }
    const sorted = [...markers].sort((a,b) => priority(b)-priority(a));
    for (const marker of sorted) {
      const poi = pois.find(p => p.id === marker.dataset.poi);
      const forced=marker.classList.contains('route-stop') || marker.classList.contains('selected') || marker.classList.contains('recommended');
       if(!mapPoiVisible(poi,{level,category:facilityKind,forced,route:marker.classList.contains('route-stop')})){marker.hidden=true;continue;}
       const p = offset(poi.position), x = p.x * state.scale, y = p.y * state.scale;
       const isRoute=marker.classList.contains('route-stop');
       let dx=0,dy=0;
       if(isRoute){
         const candidates=[[0,0],[-48,-36],[48,36],[-60,32],[60,-32],[0,-62],[0,62],[-84,0],[84,0],[-84,-62],[84,62],[-110,35],[110,-35]];
         const slot=candidates.find(([a,b])=>{
           const sx=lastDimensions.width/2+state.x+x+a,sy=lastDimensions.height/2+state.y+y+b;
           return sx>27 && sx<lastDimensions.width-56 && sy>35 && sy<lastDimensions.height-26
             && !kept.some(p=>Math.abs(p.x-x-a)<58 && Math.abs(p.y-y-b)<50);
         });
         if(slot)[dx,dy]=slot;
       }
       marker.style.setProperty('--poi-dx',`${dx}px`);marker.style.setProperty('--poi-dy',`${dy}px`);
       marker.style.setProperty('--poi-leader',`${Math.hypot(dx,dy)}px`);
       marker.style.setProperty('--poi-leader-angle',`${Math.atan2(-dy,-dx)*180/Math.PI}deg`);
       const overlaps = kept.some(p => Math.abs(p.x - x-dx) < (p.facility ? 42 : 56) && Math.abs(p.y - y-dy) < 52);
       marker.hidden = overlaps && !forced;
       if (!marker.hidden) kept.push({x:x+dx,y:y+dy});
    }
    for(const marker of regionMarkers){
      marker.hidden=level!=='overview' || facilityKind!=='all';
      if(marker.hidden)continue;
      const p=offset(mapRegionAnchor(marker.dataset.mapRegion,pois)),x=p.x*state.scale,y=p.y*state.scale;
      const candidates=[[0,-38],[0,42],[-62,0],[62,0],[0,-76],[0,76],[-70,-44],[70,44],[-70,44],[70,-44]];
      const candidate=candidates.find(([dx,dy])=>{
        const sx=lastDimensions.width/2+state.x+x+dx,sy=lastDimensions.height/2+state.y+y+dy;
        return sx>34 && sx<lastDimensions.width-34 && sy>62 && sy<lastDimensions.height-24 &&
          !kept.some(p=>Math.abs(p.x-x-dx)<60 && Math.abs(p.y-y-dy)<33);
      });
      if(!candidate){marker.hidden=true;continue;}
      const [dx,dy]=candidate;
      marker.style.setProperty('--region-dx',`${dx}px`);marker.style.setProperty('--region-dy',`${dy}px`);
      kept.push({x:x+dx,y:y+dy});
    }
    const active=markers.find(marker=>marker.classList.contains('selected') || marker.classList.contains('recommended'));
    const poi=pois.find(p=>p.id===active?.dataset.poi);
    overview.target(poi?.position ?? focus?.point,poi?.name);
    bubbles.refresh();
  };
   const applyGeometry=()=>{
     const {width,height}=lastDimensions;
     artWidth=layout.width;artHeight=layout.height;
     Object.assign(art.style,{width:`${artWidth}px`,height:`${artHeight}px`,left:`${(width-artWidth)/2}px`,top:`${(height-artHeight)/2}px`});
   };
   const dimensions = (camera=state) => {
     if (layoutFrozen) {if(flatLayout){layout=projectLayout(flatLayout,camera);applyGeometry();}return lastDimensions;}
    const width = viewport.clientWidth; const height = viewport.clientHeight;
    // display:none reports zero dimensions. Preserve the last visible geometry
    // so a background ResizeObserver notification cannot erase the map position.
    if (width > 0 && height > 0) {
      lastDimensions = { width, height };
        flatLayout=mapLayout(Math.max(1,width-16),height);
       layout=projectLayout(flatLayout,camera);
        applyGeometry();
       viewport.style.setProperty('--map-overview-width',`${Math.max(40,Math.min(84,width*.2,height*.34))}px`);
       viewport.style.setProperty('--map-tool-height',`${Math.max(20,Math.min(36,(height-24)/7))}px`);
       viewport.dataset.mapOrientation = layout.angle ? 'portrait' : 'landscape';
       art.style.setProperty('--map-angle', `${layout.angle}deg`);
        art.style.setProperty('--map-counter-angle', `${-layout.angle}deg`);
       Object.assign(art.style, { width: `${artWidth}px`, height: `${artHeight}px`, left: `${(width-artWidth)/2}px`, top: `${(height-artHeight)/2}px` });
    }
    return lastDimensions;
  };
  const listen = (target, name, handler, options) => { target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options)); };
  const setState = (next, presentation = false) => {
    if (destroyed) return;
    const { width, height } = dimensions(next); state = clampMapTransform({...next,pitch:0}, width, height, MAP_LIMITS, layout.boundsWidth, layout.boundsHeight);
    // A presentation may frame a landmark in the usable area beside the dock.
    // Normal gestures still use the usual map-edge bounds.
    if (presentation) { state.x = next.x; state.y = next.y; }
     const center = rotateMapPoint({ x:layout.centerX, y:layout.centerY }, state.rotation);
      art.style.transform = `translate(${state.x + center.x * state.scale}px, ${state.y + center.y * state.scale}px) scale(${state.scale}) ${state.rotation ? `rotate(${state.rotation}deg) ` : ''}${mapPlane(layout).transform}`;
     art.style.setProperty('--map-upright', `${mapPlane(layout).upright} rotate(${-state.rotation}deg)`);
      viewport.dataset.mapRotation = String(state.rotation);
      viewport.dataset.mapPitch=String(state.pitch ?? 0);
       viewport.dataset.mapView='flat';
       viewport.dataset.mapZoomedOut=String(state.scale<.85);
       art.style.setProperty('--map-depth','0px');
     art.style.setProperty('--map-scale', state.scale); refreshMarkers();
     overview.update({state,width,height,artWidth,artHeight,layout});
    if (output) output.textContent = `${Math.round(state.scale * 100)}%`;
    if (zoomIn) zoomIn.disabled = state.scale >= MAP_LIMITS.maxScale;
    if (zoomOut) zoomOut.disabled = state.scale <= MAP_LIMITS.minScale;
     transformListeners.forEach(listener => listener({ scale:state.scale, rotation:state.rotation, focus, moving:flight !== null }));
  };
  const flyTo = (target, { immediate = false, presentation = false, onComplete = () => {} } = {}) => {
    cancelFlight();
    if (destroyed) return;
    const start = { ...state };
    target = { ...state, ...target };
    if (immediate || !view.requestAnimationFrame || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || view.document?.hidden) {
      if (focus) focus.progress = 1;
      setState(target, presentation); onComplete(); return;
    }
    let started;
    const tick = now => {
      started ??= now;
      const progress = Math.min(1, (now - started) / 900);
      const eased = progress * progress * (3 - 2 * progress);
      if (focus) focus.progress = eased;
      // Preserve the actual starting frame, including an off-center introduction
      // view. Clamp only the destination, not each intermediate camera position.
      if (progress === 1) flight = null;
      setState({ scale: start.scale + (target.scale - start.scale) * eased,
        x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased,
        rotation:start.rotation + normalizeRotation(target.rotation-start.rotation)*eased,
        pitch:(start.pitch ?? 0)+((target.pitch ?? 0)-(start.pitch ?? 0))*eased }, true);
      if (progress < 1) flight = view.requestAnimationFrame(tick);
      else { flight = null; onComplete(); }
    };
    flight = view.requestAnimationFrame(tick);
  };
  const zoom = (factor, x = 0, y = 0) => { const { width, height } = dimensions(); setState(zoomMapAt(state, factor, x, y, width, height, layout.boundsWidth, layout.boundsHeight)); };
  const beginGesture = (orbit=false) => { gesture = { state: { ...state }, orbit, intent:null, points: [...pointers.values()].slice(0, 2).map((point) => ({ ...point })) }; };
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const isControl = (target) => !!target?.closest?.('.map-controls, .map-overview, .catalog-trigger, .facility-filters, .map-caption, .map-bubbles, .nearby-view');
  const interruptFlight = () => { cancelFlight(); if (focus) { focus.cancelled = true; transformListeners.forEach(listener => listener({scale:state.scale,focus,moving:false})); } };
  const reset = () => { focus = { token:++focusSequence, progress:0, home:true }; flyTo(home); };

  listen(viewport, 'pointerdown', (event) => {
    if (isControl(event.target) || ![0,2].includes(event.button) || event.button===2 && !state.pitch || pointers.size >= 2) return;
    interruptFlight();
    if (!pointers.size) { moved = false; suppressClickUntil = 0; }
    pointers.set(event.pointerId, point(event)); if (pointers.size > 1) moved = true;
    beginGesture(event.button===2);
  });
  listen(view, 'pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, point(event)); const points = [...pointers.values()]; const { width, height } = dimensions();
    if (points.length > 1) {
      gesture.intent ??= pinchIntent(gesture.points,points);
      moved = true; setState(pinchMapTransform(gesture.state, gesture.points, points, viewport.getBoundingClientRect(), width, height, layout.boundsWidth, layout.boundsHeight,{rotate:state.pitch>0 && gesture.intent==='rotate'}));
    } else {
      const dx = points[0].x - gesture.points[0].x; const dy = points[0].y - gesture.points[0].y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (moved) setState(gesture.orbit ? {...gesture.state,rotation:gesture.state.rotation+dx*.35,pitch:Math.max(20,gesture.state.pitch-dy*.25)}
        : { ...gesture.state, x: gesture.state.x + dx, y: gesture.state.y + dy });
    }
    if (moved) {
      event.preventDefault(); viewport.classList.add('is-dragging');
      // Capture after dragging starts so a simple tap keeps its POI click target.
      try { viewport.setPointerCapture(event.pointerId); } catch { /* pointer no longer active */ }
    }
  }, { passive: false });
  const finishPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (moved || event.type === 'pointercancel') suppressClickUntil = Date.now() + 450;
    if (pointers.size) beginGesture(); else { gesture = null; viewport.classList.remove('is-dragging'); }
  };
  listen(view, 'pointerup', finishPointer); listen(view, 'pointercancel', finishPointer);
  listen(viewport,'contextmenu',event=>{if(state.pitch && !isControl(event.target))event.preventDefault();});
  listen(viewport, 'lostpointercapture', (event) => {
    // A touch target may lose implicit capture when the viewport takes over.
    // Its bubbling event does not mean the viewport's gesture has ended.
    if (event.target === viewport) finishPointer(event);
  });
  listen(view, 'blur', () => {
    pointers.clear(); gesture = null; moved = false;
    viewport.classList.remove('is-dragging');
  });
  listen(viewport, 'click', (event) => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil && !isControl(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const facilityButton = event.target.closest?.('button[data-facility]');
    if (facilityButton && viewport.contains(facilityButton)) onFacility(facilityButton.dataset.facility);
    const filter = event.target.closest?.('[data-facility-kind]');
    if (filter && viewport.contains(filter)) onFacilityKind(filter.dataset.facilityKind);
     const button = event.target.closest?.('button[data-poi]');
     if (button && viewport.contains(button)) onSelect(button.dataset.poi);
     const region=event.target.closest?.('[data-map-region]');
     if(region && viewport.contains(region)){
       const p=mapRegionAnchor(region.dataset.mapRegion,pois);
       if(p)focusPoint(p,2.2);
     }
  }, true);
  if (controls) listen(controls, 'click', (event) => {
    const action = event.target.closest?.('[data-map-action]')?.dataset.mapAction;
    // Route controls bubble here too; do not cancel the flight they just began.
    if (!action) return;
    interruptFlight();
     if (action === 'zoom-in') zoom(1.3); else if (action === 'zoom-out') zoom(1 / 1.3); else if (action === 'reset') reset();
      else if (action === 'settings') onSettings();
  });
  listen(viewport, 'wheel', (event) => {
    if (isControl(event.target)) return;
    interruptFlight();
    event.preventDefault(); const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false });
  listen(viewport, 'keydown', (event) => {
    if (event.key === 'Escape' && bubbles.isOpen()) {
      event.preventDefault(); bubbles.dismiss(); return;
    }
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    interruptFlight();
    const directions = { ArrowLeft: [36, 0], ArrowRight: [-36, 0], ArrowUp: [0, 36], ArrowDown: [0, -36] };
    if (directions[event.key]) { const [x, y] = directions[event.key]; setState({ ...state, x: state.x + x, y: state.y + y }); }
    else if (event.key === '+' || event.key === '=') zoom(1.3);
    else if (event.key === '-' || event.key === '_') zoom(1 / 1.3);
    else if (event.key === 'Home' || event.key === '0') reset();
    else if (event.key === '[' || event.key === ']') setState({ ...state, rotation:state.rotation+(event.key === '[' ? -15 : 15) });
    else return;
    event.preventDefault();
  });
   const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(() => {
     if (!layoutFrozen && viewport.clientWidth > 0 && viewport.clientHeight > 0) setState(state, viewport.clientWidth === lastDimensions.width && viewport.clientHeight === lastDimensions.height);
   }) : null;
  resizeObserver?.observe(viewport); if (!resizeObserver) listen(view, 'resize', () => setState(state));
  setState(state);
  const cleanup = () => {
    if (destroyed) return; destroyed = true;
    cancelFlight(); transformListeners.clear();
    for (const id of pointers.keys()) { try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch { /* already released */ } }
    pointers.clear(); listeners.forEach((remove) => remove()); resizeObserver?.disconnect(); bubbles.destroy(); disposeRoadNetwork();overview.destroy();
    art.style.transform = previousStyles.transform; art.style.transformOrigin = previousStyles.transformOrigin; viewport.style.touchAction = previousStyles.touchAction;
    for (const key of ['width','height','left','top']) art.style[key] = previousStyles[key] ?? '';
    for (const key of ['--map-angle','--map-counter-angle','--map-upright']) art.style.removeProperty?.(key);
     delete viewport.dataset.mapOrientation;
     delete viewport.dataset.mapRotation;
    viewport.classList.remove('is-dragging');
  };
   cleanup.reset = reset;
   cleanup.getTransform = () => ({ ...state });
   cleanup.freezeLayout = () => { layoutFrozen=true; };
   cleanup.resumeLayout = () => { layoutFrozen=false; setState(state,true); };
  cleanup.onTransform = listener => { transformListeners.add(listener); return () => transformListeners.delete(listener); };
  cleanup.point = point => {
    if (!point) return null;
    const { width, height } = dimensions(), p = offset(point);
    return { x:width / 2 + state.x + p.x * state.scale, y:height / 2 + state.y + p.y * state.scale };
  };
  cleanup.heading = headingAngle;
  cleanup.setVisitor = (point,ahead) => overview.visitor(point,ahead);
  const focusPoint = (point, scale, options = {}) => {
    dimensions(); focus = { point, token:++focusSequence, progress:0 };
    const p = offset(point);
    flyTo({ scale, x:-p.x * scale - 18, y:-p.y * scale - 8 }, { presentation:true, ...options });
  };
  cleanup.poiPoint = id => {
    const poi = pois.find(item => item.id === id);
    if (!poi?.position) return null;
    const { width, height } = dimensions();
    const p = offset(poi.position);
    return { x: width / 2 + state.x + p.x * state.scale, y: height / 2 + state.y + p.y * state.scale };
  };
  cleanup.cancelFlight = interruptFlight;
  cleanup.flyToPoi = (id, { x, y, immediate = false, onComplete = () => {} } = {}) => {
    cancelFlight();
    const poi = pois.find(item => item.id === id);
    if (!poi?.position || destroyed) return;
    const { width, height } = dimensions();
    const scale = Math.min(2.6, Math.max(1.8, state.scale));
    const p = offset(poi.position);
    const target = { scale, x: (x ?? width / 2) - width / 2 - p.x * scale, y: (y ?? height / 2) - height / 2 - p.y * scale };
    focus = { point:poi.position, token:++focusSequence, progress:0 };
    flyTo(target, { immediate, presentation: true, onComplete });
  };
  cleanup.focusPoi = (id) => {
    cancelFlight();
    const poi = pois.find((item) => item.id === id); if (!poi?.position || destroyed) return;
    focusPoint(poi.position, 2.2);
  };
  const popMarkers = (items) => {
    for (const marker of items) {
      const pin = marker.querySelector('.facility-pin, .map-poi-pin');
      pin?.getAnimations().forEach(animation => animation.cancel());
      if (!pin || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
      const scale = marker.classList.contains('highlighted') ? 1.22 : 1;
      pin.animate([
        { transform: `scale(${scale * .82})` },
        { transform: `translateY(-6px) scale(${scale * 1.2})`, offset: .45 },
        { transform: `scale(${scale})` },
      ], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
  };
  cleanup.showFacilities = (info = null) => {
    if (destroyed) return;
    facilityKind = info?.kind ?? 'all'; selectedFacility = info?.id ?? null;
    viewport.dataset.facilityView = facilityKind;
    for (const button of viewport.querySelectorAll('[data-facility-kind]')) button.setAttribute('aria-pressed', String(button.dataset.facilityKind === facilityKind || (button.dataset.facilityKind === 'service' && info && !info.items.some(item => item.position))));
    bubbles.show(info);
    refreshMarkers();
    popMarkers(facilityMarkers.filter(marker => !marker.hidden && marker.classList.contains('highlighted')));
  };
  cleanup.revealScenery = () => {
    reset();
    popMarkers(markers.filter(marker => !marker.hidden));
  };
  cleanup.focusFacility = id => {
    cancelFlight();
    const item = facilities.find(f => f.id === id);
    if (!item?.position || destroyed) return;
    focusPoint(item.position, 2.4);
  };
  cleanup.focusFacilities = ids => {
    cancelFlight();
    const points = facilities.filter(f => ids.includes(f.id) && f.position).map(f => f.position);
    if (!points.length || destroyed) return;
    const { width, height } = dimensions();
    const x = points.reduce((sum,p) => sum+p.x,0)/points.length;
    const y = points.reduce((sum,p) => sum+p.y,0)/points.length;
    const projected = points.map(offset);
    const spanX = Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x));
    const spanY = Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y));
    const scale = Math.max(1, Math.min(2.4, (width-110)/Math.max(1,spanX), (height-100)/Math.max(1,spanY)));
    focusPoint({ x,y }, scale);
  };
  cleanup.refresh = refreshMarkers;
  cleanup.focusNearby = (ids, { area, immediate = false } = {}) => {
    focus = null;
    const points = pois.filter(poi => ids.includes(poi.id) && poi.position).map(poi => poi.position);
    if (!points.length || destroyed || !area) return;
    const { width, height } = dimensions();
    const projected = points.map(offset);
    const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.max(1, Math.min(4.4, area.width * .68 / Math.max(layout.boundsWidth * .12, maxX-minX), area.height * .6 / Math.max(layout.boundsHeight * .12, maxY-minY)));
    flyTo({ scale, x: area.left + area.width / 2 - width / 2 - (minX + maxX) / 2 * scale,
      y: area.top + area.height / 2 - height / 2 - (minY + maxY) / 2 * scale }, { immediate, presentation: true });
  };
  cleanup.focusRoute = (route, { immediate = false, onComplete = () => {} } = {}) => {
    focus = null;
    cancelFlight();
    const ids = route.stops.map(stop => stop.poiId);
    const points = [...route.geometry.points, ...pois.filter(poi => ids.includes(poi.id) && poi.position).map(poi => poi.position)];
    if (!points.length || destroyed) return;
    const { width, height } = dimensions();
    const projected = points.map(offset);
    const xs = projected.map(point => point.x), ys = projected.map(point => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const rect = viewport.getBoundingClientRect();
     // Tools live beside the map, not across its upper edge.
     const top = 48;
    const dock = viewport.ownerDocument.querySelector?.('.voice-dock')?.getBoundingClientRect();
    const overlapsDock = dock && dock.left < rect.right && dock.right > rect.left;
    const bottom = overlapsDock ? Math.max(32, Math.min(height * .45, rect.bottom - dock.top + 16)) : 32;
    const availableHeight = Math.max(80, height - top - bottom);
    const pet = viewport.ownerDocument.querySelector?.('#companion-pet')?.getBoundingClientRect();
    const petOnLeft = pet && pet.right <= rect.left + width * .45 && pet.bottom > rect.top + top && pet.top < rect.bottom - bottom;
    const left = petOnLeft ? Math.max(24, pet.right - rect.left + 16) : 24;
    const availableWidth = Math.max(80, width - left - 76);
    const scale = Math.min(3.2, Math.max(1, Math.min(availableWidth * .75 / Math.max(layout.boundsWidth * .12, maxX-minX), availableHeight * .7 / Math.max(layout.boundsHeight * .12, maxY-minY))));
    const target = clampMapTransform({ scale, rotation:state.rotation,
      x: -(minX + maxX) / 2 * scale + left + availableWidth / 2 - width / 2,
      y: -(minY + maxY) / 2 * scale + top + availableHeight / 2 - height / 2 }, width, height, MAP_LIMITS, layout.boundsWidth, layout.boundsHeight);
    flyTo(target, { immediate, onComplete });
  };
  return cleanup;
}
