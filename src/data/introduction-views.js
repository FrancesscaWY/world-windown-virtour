import { parkPhotos } from './park-photos.js';

// Presentation assets are owned by the application, never supplied by a model.
// These three views reuse the locally supplied Eiffel Tower panorama faces.
const eiffelViews = Object.freeze([
  { file: './assets/panoramas/eiffel-tower/f-l3-fallback.jpg', title: '走近铁塔', caption: '塔脚与拱形钢架', attribution: '用户提供的铁塔实景素材' },
  { file: './assets/panoramas/eiffel-tower/r-l3-fallback.jpg', title: '塔旁绿荫', caption: '铁塔旁的树荫与步道', attribution: '用户提供的铁塔实景素材' },
  { file: './assets/panoramas/eiffel-tower/b-l3-fallback.jpg', title: '回望花园', caption: '铁塔全景中的周边景致', attribution: '用户提供的铁塔实景素材' },
].map(Object.freeze));

export function introductionPhotos(poiId) {
  if (poiId === 'eiffel') return eiffelViews;
  const photo = Object.hasOwn(parkPhotos, poiId) ? parkPhotos[poiId] : null;
  return photo ? [{ file: photo.file, title: '园内一瞥', caption: photo.label, attribution: `${photo.attribution} · ${photo.license}`, source: photo.source }] : [];
}
