import { parkCatalog } from './park-catalog.js';
import { parkPhotos } from './park-photos.js';
import { panoramaHotspots } from './panorama-hotspots.js';
export { panoramaHotspots } from './panorama-hotspots.js';

// WebGL cube-map order: +X, -X, +Y, -Y, +Z, -Z. These are the supplied
// Eiffel Tower faces, stored locally with the application.
const eiffelTowerPanorama = Object.freeze({
  kind: 'cubemap',
  initialView: { yaw:0, pitch:.66, fov:90 },
  faces: ['r', 'l', 'u', 'd', 'f', 'b'].map(face => `./assets/panoramas/eiffel-tower/${face}-2048.jpg`),
  mobileFaces: ['r', 'l', 'u', 'd', 'f', 'b'].map(face => `./assets/panoramas/eiffel-tower/${face}-1024.jpg`),
});

export const pois = parkCatalog.map(poi => ({
  ...poi, tag: poi.region, color: '#dce5df', photo: parkPhotos[poi.id] ?? null,
  panorama: poi.id === 'eiffel' ? eiffelTowerPanorama : null,
  panoramaKind: poi.id === 'eiffel' ? 'cubemap' : null,
  panoramaLabel: poi.id === 'eiffel' ? '埃菲尔铁塔 · 实景全景' : null,
  distanceMeters: null, queueMinutes: null, crowd: null,
  panoramaNarration: poi.id === 'eiffel' ? '欢迎来到埃菲尔铁塔全景。拖动画面环顾四周，抬头看看塔身向上收拢的线条，再看看周围的花园和步道。' : `${poi.summary}${parkPhotos[poi.id] ? '现在展示的是深圳园区实拍照片，可以点开故事继续了解。' : ''}`,
}));
export const demoData = { source: '未接实时运营数据', mapLabel: 'OSM 静态地理底图', location: '未获取游客位置' };
export const getPoi = id => pois.find(poi => poi.id === id) ?? null;
export const getHotspot = (poiId, hotspotId) => panoramaHotspots[poiId]?.find(point => point.id === hotspotId) ?? null;
export const detailSections = Object.fromEntries(pois.map(poi => [poi.id, [
  { title: '一起看一看', text: poi.summary },
  { title: '逛到这里', text: poi.position ? `地图上的标记来自 OSM 的园内地点记录。${poi.name}的即时人流、排队与开放情况尚未接入，请留意现场指示。` : '这个地点有公开名录依据，具体位置尚未核对，因此没有在地图上猜放标记。开放状态请以园区公告为准。' },
]]));
