import { getPoi } from '../data/pois.js';
import { distanceMeters, nearestPoi, toCoordinates } from './location.js';

/** Arrival narration joins the existing duplex call. It never closes/reopens capture. */
export function createCompanionNarrator({ store, callSession, scope = globalThis }) {
  let pending = null, holdUntil = 0, lastSent = -Infinity, previous = { ...store.get() };
  const visited = new Set();
  const now = () => scope.Date.now();
  function reset() { pending = null; holdUntil = 0; lastSent = -Infinity; visited.clear(); }
  function flush() {
    const state = store.get(), poi = getPoi(pending);
    if (!poi || state.tourMode !== 'companion' || state.companionPaused || state.pageBackgrounded ||
      state.interactionMode !== 'realtime' || state.callState !== 'connected' || state.callMuted ||
      state.callInput === 'speaking' || !['idle','listening'].includes(state.guideStatus) ||
      now() < holdUntil || now()-lastSent < 20000) return false;
    if (!state.visitorOrigin || !poi.position || (state.locationAccuracy ?? 0) > 80 ||
      state.visitorOriginSource!=='模拟定位' && now()-(state.locationUpdatedAt ?? 0) > 30000 ||
      distanceMeters(state.visitorOrigin,toCoordinates(poi.position)) > 65) { pending = null; return false; }
    pending = null;
    if (visited.has(poi.id)) return false;
    // Clear pending before dispatch: the session changes the store synchronously.
    if (!callSession.narrateLocation(poi.id)) return false;
    visited.add(poi.id); lastSent = now(); return true;
  }
  function offer(id) { if (!visited.has(id)) pending = id; return flush(); }
  const unsubscribe = store.subscribe(state => {
    const before = previous; previous = { ...state };
    if (state.tourMode !== 'companion' || state.companionPaused) { pending = null; return; }
    if (state.callState === 'connecting' && before.callState !== 'connecting') reset();
    if (state.callInput === 'speaking' || before.callInput === 'speaking') holdUntil = now()+15000;
    if (state.callState === 'connected' && before.callState !== 'connected' && state.visitorOrigin) {
      const nearest = nearestPoi(state.visitorOrigin);
      if (nearest?.distance <= 35) pending = nearest.poi.id;
    }
    flush();
  });
  const timer = scope.setInterval(flush,1000);
  return { offer, flush, reset, dispose() { scope.clearInterval(timer); unsubscribe(); reset(); } };
}
