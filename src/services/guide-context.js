/** Follow-up requests need the visit order, not thousands of road coordinates. */
export function guideRequestContext(state) {
  const stops = Array.isArray(state?.plannedRoute?.stops)
    ? state.plannedRoute.stops.slice(0, 12).filter(stop => typeof stop?.poiId === 'string').map(stop => ({ poiId: stop.poiId })) : [];
  // A configured simulation remains current while stationary; only device fixes expire.
  const fresh = state?.visitorOriginSource === '模拟定位' || state?.locationUpdatedAt === undefined || Number.isFinite(state.locationUpdatedAt) && Date.now()-state.locationUpdatedAt <= 30000;
  const position = fresh && (state?.locationAccuracy ?? 0) <= 80 ? state?.visitorOrigin : null;
  return {
    messages: state?.messages, selectedPoiId: state?.selectedPoiId, mentionedPoiId: state?.mentionedPoiId, view: state?.view,
    activeHotspotId: state?.activeHotspotId,
    tourMode:state?.tourMode, visitorOriginSource:state?.visitorOriginSource,
    plannedRoute: stops.length ? { stops } : null,
    visitorOrigin: position ? { latitude:position.latitude, longitude:position.longitude } : null,
  };
}
