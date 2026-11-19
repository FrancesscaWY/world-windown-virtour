export const MAP_LIMITS = Object.freeze({ minScale: .65, maxScale: 5.5 });

export const normalizeRotation = angle => Number.isFinite(angle) ? ((angle + 180) % 360 + 360) % 360 - 180 : 0;
export function rotateMapPoint({ x, y }, angle = 0) {
  const r = angle * Math.PI / 180;
  return { x:x * Math.cos(r) - y * Math.sin(r), y:x * Math.sin(r) + y * Math.cos(r) };
}

/** Keep the scene reachable, including when it is smaller than the viewport. */
export function clampMapTransform(state, width, height, limits = MAP_LIMITS, contentWidth = width, contentHeight = height) {
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, Number.isFinite(state.scale) ? state.scale : 1));
  const rotation = normalizeRotation(state.rotation);
  const r = rotation * Math.PI / 180, co = Math.abs(Math.cos(r)), si = Math.abs(Math.sin(r));
  const cw = Number.isFinite(contentWidth) ? contentWidth : 0, ch = Number.isFinite(contentHeight) ? contentHeight : 0;
  const bound = (size, content) => Math.max(0, ((Number.isFinite(content) ? content : 0) * scale - (Number.isFinite(size) ? size : 0)) / 2);
  const clamp = (value, size, content) => Math.max(-bound(size, content), Math.min(bound(size, content), Number.isFinite(value) ? value : 0)) || 0;
  return { scale, x: clamp(state.x, width, cw * co + ch * si), y: clamp(state.y, height, cw * si + ch * co), rotation,
    ...(state.pitch!==undefined ? {pitch:Math.max(0,Math.min(55,Number.isFinite(state.pitch)?state.pitch:0))}: {}) };
}

/** Anchor coordinates are relative to the viewport center in CSS pixels. */
export function zoomMapAt(state, factor, anchorX, anchorY, width, height, contentWidth = width, contentHeight = height) {
  const current = clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const nextScale = clampMapTransform({ ...current, scale: current.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1) }, width, height, MAP_LIMITS, contentWidth, contentHeight).scale;
  const ratio = nextScale / current.scale;
  return clampMapTransform({ ...current, scale: nextScale, x: anchorX - (anchorX - current.x) * ratio, y: anchorY - (anchorY - current.y) * ratio }, width, height, MAP_LIMITS, contentWidth, contentHeight);
}

/** Preserve the map point below a moving two-finger midpoint. */
export function pinchMapTransform(state, startPoints, currentPoints, rect, width, height, contentWidth = width, contentHeight = height, { rotate = true } = {}) {
  if (startPoints.length < 2 || currentPoints.length < 2) return clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const midpoint = (points) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const start = midpoint(startPoints); const current = midpoint(currentPoints);
  const startDistance = distance(startPoints);
  const factor = startDistance > 0.5 ? distance(currentPoints) / startDistance : 1;
  const before = clampMapTransform(state, width, height, MAP_LIMITS, contentWidth, contentHeight);
  const angle = points => Math.atan2(points[1].y-points[0].y, points[1].x-points[0].x)*180/Math.PI;
  const delta = rotate && startDistance > .5 && distance(currentPoints) > .5 ? normalizeRotation(angle(currentPoints)-angle(startPoints)) : 0;
  const scale = clampMapTransform({ ...before, scale: before.scale * factor }, width, height, MAP_LIMITS, contentWidth, contentHeight).scale;
  const ratio = scale / before.scale;
  const anchor = rotateMapPoint({ x:start.x-rect.left-width/2-before.x, y:start.y-rect.top-height/2-before.y }, delta);
  // Combine midpoint movement and scaling before clamping the pan. Clamping an
  // intermediate zoom can discard valid movement back from a map boundary.
  return clampMapTransform({
    ...before, scale,
    rotation:before.rotation + delta,
    x: current.x - rect.left - width / 2 - anchor.x * ratio,
    y: current.y - rect.top - height / 2 - anchor.y * ratio,
  }, width, height, MAP_LIMITS, contentWidth, contentHeight);
}

/** Commit an intent once: an ordinary pinch never accumulates incidental twist. */
export function pinchIntent(start, current) {
  if(start.length<2 || current.length<2)return null;
  const dist=p=>Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
  const angle=p=>Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x)*180/Math.PI;
  const change=Math.abs(Math.log(Math.max(.01,dist(current))/Math.max(.01,dist(start))));
  const twist=Math.abs(normalizeRotation(angle(current)-angle(start)));
  const bothMoved=current.every((p,i)=>Math.hypot(p.x-start[i].x,p.y-start[i].y)>2);
  if(bothMoved && twist>=14 && change<.08)return 'rotate';
  if(change>=.035 && (bothMoved || twist<10))return 'zoom';
  return null;
}
