import { getPoi } from '../data/pois.js';

/** Browsing has one cancellable completion, never a timeout that opens a stale scene. */
export function createSceneTransition({ store, guide, actions, map, preload = () => {} }) {
  let sequence = 0, pending = null;
  const cancel = () => { sequence++; pending = null; };
  const detach = map.onTransform(snapshot => { if (snapshot.focus?.cancelled) cancel(); });
  const unsubscribe = store.subscribe(state => {
    if (pending && (state.tourMode !== pending.mode || state.view !== 'map' || state.selectedPoiId !== pending.id)) {
      cancel(); map.cancelFlight();
    }
  });
  return {
    open(id, { onEnter = () => {} } = {}) {
      const poi = getPoi(id);
      if (!poi) return false;
      cancel(); map.cancelFlight();
      guide.browsePoi(id);
      if (!poi.panorama && !poi.photo) { map.focusPoi(id); onEnter(poi); return true; }
      preload(poi);
      const token = ++sequence;
      pending = { id, mode:store.get().tourMode };
      const complete = () => {
        if (token !== sequence || !pending || store.get().view !== 'map') return;
        pending = null;
        actions.enterPanorama(id);
        onEnter(poi);
      };
      if (poi.position) map.flyToPoi(id, { onComplete:complete });
      else complete(); // No invented map anchor for an unlocated catalog entry.
      return true;
    },
    cancel() { cancel(); map.cancelFlight(); },
    dispose() { cancel(); detach(); unsubscribe(); },
  };
}

export function preloadPoiScene(poi, scope = globalThis) {
  if (!scope.Image) return;
  const files = poi.panorama?.kind === 'cubemap' ? poi.panorama.mobileFaces ?? poi.panorama.faces
    : typeof poi.panorama === 'string' ? [poi.panorama] : poi.photo ? [poi.photo.file] : [];
  for (const file of files) { const image = new scope.Image(); image.src = new URL(file, scope.document.baseURI).href; }
}
