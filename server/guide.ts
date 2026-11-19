import { getPoi, getHotspot } from '../src/data/pois.js';
import { validVisitorPosition } from '../src/data/nearby-attractions.js';
import type { AgentInput, Message } from './ai/types.ts';

const record = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};

/** Only known page data and bounded user/assistant history cross the model boundary. */
export function guidePayload(input: { text?: string; context?: unknown }): AgentInput {
  const context = record(input.context);
  const history: Message[] = [];
  for (const item of (Array.isArray(context.messages) ? context.messages.slice(-10) : [])) {
    const row = record(item);
    const content = row.content ?? row.text;
    if ((row.role === 'user' || row.role === 'assistant') && typeof content === 'string' && content.trim()) history.push({ role: row.role, content: content.slice(0, 2000) });
  }
  const id = context.mentionedPoiId ?? context.selectedPoiId;
  const poi = typeof id === 'string' ? getPoi(id) : null;
  const selected = typeof context.selectedPoiId === 'string' ? getPoi(context.selectedPoiId) : null;
  const hotspot = context.view === 'panorama' && selected && typeof context.activeHotspotId === 'string'
    ? getHotspot(selected.id, context.activeHotspotId) : null;
  const route = record(context.plannedRoute);
  const routeStops = (Array.isArray(route.stops) ? route.stops.slice(0, 12) : []).map(stop => {
    const id = record(stop).poiId;
    const poi = typeof id === 'string' ? getPoi(id) : null;
    return poi?.position ? { id: poi.id, name: poi.name } : null;
  }).filter((stop): stop is { id: string; name: string } => stop !== null);
  return {
    city: '深圳',
    messages: [...history, ...(input.text ? [{ role: 'user' as const, content: input.text.trim() }] : [])],
    pageContext: {
      park: '深圳世界之窗', view: context.view === 'map' ? '园区地图' : '景点画面',
      ...(context.tourMode === 'companion' || context.tourMode === 'interactive' ? { tourMode:context.tourMode,
        locationSource:context.visitorOriginSource === '模拟定位' ? 'simulated' as const : 'device' as const } : {}),
      topic: poi ? { id: poi.id, name: poi.name, summary: poi.summary, source: poi.source } : null,
      visitorPosition: validVisitorPosition(context.visitorOrigin) ? { latitude: record(context.visitorOrigin).latitude as number, longitude: record(context.visitorOrigin).longitude as number } : null,
      route: routeStops.length >= 2 ? { stops: routeStops } : null,
      panorama: context.view === 'panorama' && selected?.panorama ? { poiId: selected.id,
        activeHotspot: hotspot ? { id: hotspot.id, title: hotspot.title } : null } : null,
    },
  };
}

export function validPcm(audio: string): boolean {
  if (audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return false;
  const bytes = Buffer.from(audio, 'base64');
  return bytes.length >= 3200 && bytes.length <= 1920000 && bytes.length % 2 === 0 && bytes.toString('base64') === audio;
}
