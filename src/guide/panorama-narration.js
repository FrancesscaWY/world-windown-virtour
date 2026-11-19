import { getPanoramaHotspot } from '../data/panorama-hotspots.js';
import { getPoi, panoramaHotspots } from '../data/pois.js';

/** An explicit landmark tap is permission to explain that scene, not to open a mic. */
export function selectionTour(poiId) {
  const poi = getPoi(poiId);
  if (!poi) return null;
  const points = panoramaHotspots[poiId];
  if (poi.panorama && points?.length) return { poiId, hotspotIds: points.map(point => point.id), narration: 'sentence', dwellMs: 3000 };
  return { poiId, hotspotIds: [], narration: 'sentence', scene: 'photo' };
}

/** Exact UTF-16 offsets, matching server/ai/tts.ts, not estimated speech durations. */
export function panoramaNarration(tour) {
  const sentences = [];
  let text = '';
  if (tour?.scene === 'photo') {
    const poi = getPoi(tour.poiId);
    if (!poi) return null;
    for (const match of poi.summary.matchAll(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g)) {
      sentences.push({ charIndex: text.length, text: match[0], hotspotId: null, poiId: tour.poiId }); text += match[0];
    }
    return text ? { text, sentences } : null;
  }
  for (const id of tour?.hotspotIds ?? []) {
    const point = getPanoramaHotspot(tour.poiId, id);
    if (!point) return null;
    if (text) text += '\n';
    for (const match of point.body.matchAll(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g)) {
      if (!match[0].trim()) continue;
      sentences.push({ charIndex: text.length, text: match[0], hotspotId: id, poiId: tour.poiId });
      text += match[0];
    }
  }
  return text ? { text, sentences } : null;
}

export function narrationSentence(script, index) {
  if (!Number.isInteger(index) || index < 0 || index >= (script?.text.length ?? 0)) return null;
  return script.sentences.findLast(sentence => sentence.charIndex <= index) ?? null;
}

export const synchronizedTour = state => Boolean(state?.cameraTour?.narration === 'sentence'
  && (state.view === 'panorama' || state.cameraTour.scene === 'photo') && state.selectedPoiId === state.cameraTour.poiId);
