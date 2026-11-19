import { getPoi } from '../data/pois.js';
import { artworkRoads } from '../data/artwork-roads.js';
import { nearbyAttractions, validVisitorPosition } from '../data/nearby-attractions.js';
import { panoramaHotspots } from '../data/panorama-hotspots.js';
import { selectionTour } from './panorama-narration.js';
import { toMapPosition, nearestPoi } from './location.js';
import { projectMapPosition } from '../components/map-projection.js';

const position = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
const samePoint = (a, b) => a.x === b.x && a.y === b.y;
const nodes = new Map(artworkRoads.nodes.map(node => [node.id, node]));
const edges = new Map(artworkRoads.roads.map(road => [road.id, new Set(road.nodeIds.slice(1).flatMap((id, i) => [`${road.nodeIds[i]}:${id}`, `${id}:${road.nodeIds[i]}`]))]));

function routeGeometry(route) {
  const g = route.geometry;
  if (g?.kind !== 'artwork-traced' || g.coordinateSpace !== 'artwork-percent' || g.sourceSha256 !== artworkRoads.sourceSha256) return null;
  if (!Array.isArray(g.points) || g.points.length < 2 || g.points.length > 12000 || !g.points.every(position)) return null;
  if (!Array.isArray(g.nodeIds) || g.nodeIds.length !== g.points.length || !g.nodeIds.every(id => nodes.has(id))) return null;
  if (g.points.some((point, i) => !samePoint(point, nodes.get(g.nodeIds[i])))) return null;
  if (!Array.isArray(g.roadIds) || g.roadIds.length !== g.points.length - 1 || g.roadIds.some((id, i) => !edges.get(id)?.has(`${g.nodeIds[i]}:${g.nodeIds[i + 1]}`))) return null;
  if (!Array.isArray(g.stopIndices) || g.stopIndices.length !== route.stops.length || !route.origin && g.stopIndices[0] !== 0 || g.stopIndices.at(-1) !== g.points.length - 1) return null;
  if (g.stopIndices.some((n, i) => !Number.isInteger(n) || n < 0 || n >= g.points.length || (i > 0 && n < g.stopIndices[i - 1]))) return null;
  const prefix = route.origin && g.stopIndices[0]>0 ? 1 : 0;
  if (!Array.isArray(g.legs) || g.legs.length !== route.stops.length - 1 + prefix || route.distanceMeters !== null) return null;
  if(prefix && (g.legs[0].from!=='visitor' || g.legs[0].to!==route.stops[0].poiId || g.legs[0].startIndex!==0 || g.legs[0].endIndex!==g.stopIndices[0]))return null;
  for (let i = 0; i < route.stops.length-1; i++) {
    const leg = g.legs[i+prefix];
    if (!leg || leg.from !== route.stops[i]?.poiId || leg.to !== route.stops[i + 1]?.poiId || leg.startIndex !== g.stopIndices[i] || leg.endIndex !== g.stopIndices[i + 1]) return null;
  }
  return {
    kind: g.kind, coordinateSpace: g.coordinateSpace, sourceSha256: g.sourceSha256,
    points: g.points.map(({ x, y }) => ({ x, y })), nodeIds: [...g.nodeIds], roadIds: [...g.roadIds], stopIndices: [...g.stopIndices],
    legs: g.legs.map(({ from, to, startIndex, endIndex }) => ({ from, to, startIndex, endIndex })),
  };
}

/** Shared text/voice visual policy. The Eiffel demo always opens its real panorama. */
export function guideVisualEffect(trace, state) {
  const patch=toolEffect(trace);
  if(!patch)return null;
  const id=patch.selectedPoiId;
  if(['interactive','companion'].includes(state?.tourMode) && getPoi(id)?.panorama
    && ['get_attraction_guidance','introduce_view','get_detailed_attraction_guidance'].includes(trace.name)){
    const spoken=state.tourMode==='companion' || state.interactionInput!=='text' || state.callState==='connected';
    return {...patch,view:'panorama',introductionView:null,activeHotspotId:panoramaHotspots[id]?.[0]?.id ?? null,
      cameraTour:selectionTour(id),cameraNarrationEnabled:spoken};
  }
  return patch;
}

/** Shared trusted presentation for backend tools and local companion arrivals. */
export function introductionEffect(poiId) {
  const poi = getPoi(poiId);
  if (!poi?.position || !poi.locationVerified) return null;
  return { introductionView: { poiId: poi.id }, nearbyView: null, selectedPoiId: poi.id, mentionedPoiId: poi.id,
      view: 'map', detailsOpen: false, activeHotspotId: null, pendingNarration: null,
      facilityInfo: null, visitInfo: null, clarification: null, recommendedPoiIds: [] };
}

/** React only to successful, allowlisted backend results; never execute model-provided code. */
export function toolEffect(trace) {
  if(trace?.name==='get_attraction_guidance'){
    const result=trace.result;
    if(trace.status!=='done' || result?.error || !['found','placeholder'].includes(result?.status))return null;
    return introductionEffect(result.poi_id);
  }
  if (['get_detailed_attraction_guidance', 'move_camera'].includes(trace?.name)) {
    const result = trace.result;
    if (trace.status !== 'done' || result?.error || result?.status !== 'success') return null;
    const poi = getPoi(result.poi_id);
    const points = panoramaHotspots[poi?.id];
    if (!poi?.panorama || !points?.length) return null;
    if (trace.name === 'get_detailed_attraction_guidance' && result.show_panorama !== true) return null;
    let cameraTour = null;
    if (trace.name === 'move_camera') {
      const ids = result.hotspot_ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id => !points.some(point => point.id === id))) return null;
      if (!Number.isInteger(result.dwell_seconds) || result.dwell_seconds < 3 || result.dwell_seconds > 20) return null;
      if (result.sync_mode !== undefined && !['sentence', 'timed'].includes(result.sync_mode)) return null;
      cameraTour = { poiId: poi.id, hotspotIds: [...ids], dwellMs: result.dwell_seconds * 1000,
        ...(result.sync_mode === 'sentence' ? { narration: 'sentence' } : {}) };
    }
    return { selectedPoiId: poi.id, mentionedPoiId: poi.id, view: 'panorama', cameraTour, cameraSentence: null, cameraNarrationEnabled: false,
      introductionView: null, nearbyView: null, detailsOpen: false, activeHotspotId: null,
      pendingNarration: null, facilityInfo: null, visitInfo: null, clarification: null, recommendedPoiIds: [] };
  }
  if (trace?.name === 'look_around') {
    const result = trace.result;
    if (trace.status !== 'done' || result?.error || result?.status !== 'success') return null;
    const origin = result.origin;
    if (!(origin?.kind === 'poi' && typeof origin.poiId === 'string') && !(origin?.kind === 'visitor' && validVisitorPosition(origin))) return null;
    if (!Number.isInteger(result.radius) || !Number.isInteger(result.limit)) return null;
    const nearby = nearbyAttractions({ poiId: origin.kind === 'poi' ? origin.poiId : undefined,
      visitorPosition: origin.kind === 'visitor' ? origin : undefined, radius: result.radius, limit: result.limit });
    if (!nearby || !Array.isArray(result.items) || result.items.length !== nearby.items.length || result.items.some((item, i) => item?.poiId !== nearby.items[i].poiId)) return null;
    return { nearbyView: nearby, introductionView: null, plannedRoute: null, view: 'map', detailsOpen: false,
      activeHotspotId: null, pendingNarration: null, facilityInfo: null, visitInfo: null, clarification: null, recommendedPoiIds: [] };
  }
  if (trace?.name === 'introduce_view') {
    if (trace.status !== 'done' || trace.result?.error || trace.result?.status !== 'success') return null;
    return introductionEffect(trace.result.poi_id);
  }
  if (trace?.name !== 'plan_route' || trace.status !== 'done' || trace.result?.error || trace.result?.status !== 'success') return null;
  const route = trace.result.route;
  const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (route?.kind !== 'llm-suggested' || !bounded(route.title, 80) || !bounded(route.summary, 500) || !bounded(route.disclaimer, 500)) return null;
  if (!Array.isArray(route.stops) || route.stops.length < 2 || route.stops.length > 12) return null;
  const geometry = routeGeometry(route);
  if (!geometry) return null;
  const rawOrigin=route.origin;
  let origin=null;
  if(rawOrigin){
    const a=rawOrigin.roadAnchor;
    if(rawOrigin.kind!=='visitor' || !validVisitorPosition(rawOrigin) || !['simulated','device'].includes(rawOrigin.locationSource)
      || !bounded(rawOrigin.name,100) || !a || a.nodeId!==geometry.nodeIds[0] || a.entranceVerified!==false || !position(a.position) || !samePoint(a.position,geometry.points[0]))return null;
    const geo=toMapPosition(rawOrigin),point=projectMapPosition(geo),nearest=nearestPoi(rawOrigin);
    const known=nearest?.distance<=35?artworkRoads.anchors[nearest.poi.id]:undefined;
    if(!position(geo) || known!==undefined && known!==a.nodeId || known===undefined && Math.hypot(a.position.x-point.x,a.position.y-point.y)>5)return null;
    origin={kind:'visitor',latitude:rawOrigin.latitude,longitude:rawOrigin.longitude,locationSource:rawOrigin.locationSource,name:known!==undefined?`${nearest.poi.name}附近`:'当前位置',
      roadAnchor:{nodeId:a.nodeId,position:{...geometry.points[0]},entranceVerified:false}};
  }
  const ids = new Set();
  const stops = [];
  for (const stop of route.stops) {
    const poi = getPoi(stop?.poiId);
    if (!poi?.position || !poi.locationVerified || ids.has(poi.id) || !bounded(stop.reason, 200)) return null;
    const anchor = stop.roadAnchor, index = geometry.stopIndices[stops.length];
    if (!anchor || anchor.nodeId !== geometry.nodeIds[index] || anchor.nodeId !== artworkRoads.anchors[poi.id] || !position(anchor.position) || !samePoint(anchor.position, geometry.points[index]) || anchor.entranceVerified !== false) return null;
    ids.add(poi.id);
    // Use trusted catalog metadata, not coordinates or HTML supplied by an upstream result.
    stops.push({ poiId: poi.id, name: poi.name, position: poi.position, reason: stop.reason,
      roadAnchor: { nodeId: anchor.nodeId, position: { ...geometry.points[index] }, entranceVerified: false } });
  }
  return {
    plannedRoute: { kind: route.kind, title: route.title, summary: route.summary, stops, geometry, origin, distanceMeters: route.distanceMeters, disclaimer: route.disclaimer,
      source: { name: '按手绘底图描绘的路网', url: '/assets/map.jpg', kind: 'illustration' } },
    view: 'map', detailsOpen: false, activeHotspotId: null, facilityInfo: null, visitInfo: null, introductionView: null, nearbyView: null,
    clarification: null, recommendedPoiIds: [],
  };
}
