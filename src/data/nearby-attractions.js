import { parkCatalog } from './park-catalog.js';
import { introductionPhotos } from './introduction-views.js';
import { toCoordinates, distanceMeters } from '../guide/location.js';

export function validVisitorPosition(point) {
  return !!point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

/** Geographic proximity only: artwork coordinates must never be used as metres. */
/** @param {{ poiId?: string, visitorPosition?: { latitude: number, longitude: number } | null, radius?: number, limit?: number }} options */
export function nearbyAttractions({ poiId, visitorPosition, radius = 450, limit = 6 } = {}) {
  const center = parkCatalog.find(poi => poi.id === poiId && poi.position && poi.locationVerified);
  if (poiId && !center) return null;
  const coordinate = center ? toCoordinates(center.position) : validVisitorPosition(visitorPosition) ? visitorPosition : null;
  if (!coordinate || !Number.isFinite(radius) || radius < 50 || radius > 1500 || !Number.isInteger(limit) || limit < 1 || limit > 8) return null;
  const origin = center ? { kind: 'poi', poiId: center.id, name: center.name } : { kind: 'visitor', latitude: coordinate.latitude, longitude: coordinate.longitude };
  const items = parkCatalog.filter(poi => poi.position && poi.locationVerified && poi.id !== center?.id)
    .map(poi => ({ poi, distance: distanceMeters(coordinate, toCoordinates(poi.position)) }))
    .filter(item => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.poi.id.localeCompare(b.poi.id))
    .slice(0, limit)
    .map(({ poi, distance }) => ({ poiId: poi.id, name: poi.name, region: poi.region, summary: poi.summary,
      distanceMeters: Math.round(distance), photos: introductionPhotos(poi.id), source: poi.source }));
  return { origin, radius, limit, items,
    disclaimer: '按已收录地点坐标估算的直线距离，非步行距离或导航；照片为资料照片，不代表实时景象。' };
}
