import { pois } from '../data/pois.js';
import { escapeHTML as esc } from './html.js';
import { introductionPhotos } from '../data/introduction-views.js';
import { landmark } from './icons.js';
export function searchPois(query = '', region = '') {
  const text = query.trim().toLowerCase();
  return pois.filter(poi => (!region || poi.region === region) && [poi.name, poi.region, ...poi.aliases].some(value => value.toLowerCase().includes(text)));
}
export function catalogResults(query, region) {
  const results = searchPois(query, region);
  return { count: results.length, html: results.map(poi => {
    const photo=introductionPhotos(poi.id)[0];
    return `<button type="button" class="catalog-row" data-catalog-poi="${poi.id}"><span class="catalog-thumb">${photo?`<img src="${esc(photo.file)}" alt="" loading="lazy"/>`:landmark(poi.id)}</span><span class="catalog-copy"><strong>${esc(poi.name)}</strong><small>${esc(poi.region)}${poi.position?'':' · 地图位置待补充'}</small></span><span class="catalog-media">${poi.panorama?'360° 全景':photo?'园区照片':'故事资料'} <span aria-hidden="true">↗</span></span></button>`;
  }).join('') || '<p class="catalog-empty">这处风景还没找到。试试简称，或换一个区域？</p>' };
}
