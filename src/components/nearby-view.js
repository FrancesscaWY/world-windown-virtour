import { icon } from './icons.js';
import { mapOverlayArea } from './map-overlay-area.js';

/** Keep thumbnails near their geographic anchors, separating crowded labels in screen space. */
export function nearbyMapLayout(items, area) {
  const placed = [];
  const gap = 7;
  const overlaps = (a, b) => Math.max(0, Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y, b.y));
  // Place the larger photographs first; keep returned order stable for rendering and keyboard focus.
  const sorted = [...items].sort((a, b) => Number(b.photo) - Number(a.photo));
  for (const item of sorted) {
    const width = Math.min(area.width, item.photo ? 108 : 98);
    const height = Math.min(area.height, item.photo ? 94 : 32);
    const clamp = (x, y) => ({ x: Math.max(area.left, Math.min(area.left + area.width - width, x)),
      y: Math.max(area.top, Math.min(area.top + area.height - height, y)), width, height });
    const candidates = [];
    for (const dy of [-height - 16, 16, -height / 2]) for (const dx of [-width / 2, 16, -width - 16]) candidates.push(clamp(item.x + dx, item.y + dy));
    // Dense clusters can share artwork coordinates: find the closest free screen slot, not a fake map location.
    for (let y = area.top; y <= area.top + area.height - height + 1; y += 20) {
      for (let x = area.left; x <= area.left + area.width - width + 1; x += 20) candidates.push(clamp(x, y));
    }
    let best, bestScore = Infinity;
    for (const candidate of candidates) {
      const collision = placed.reduce((sum, previous) => sum + overlaps(candidate, previous), 0);
      const distance = Math.hypot(candidate.x + width / 2 - item.x, candidate.y + height / 2 - item.y);
      const score = collision * 1000 + distance;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    placed.push({ ...best, id: item.id });
  }
  const collides = placed.some((slot, i) => placed.slice(i + 1).some(other => overlaps(slot, other) > 0));
  if (collides) {
    // In a tiny viewport greedy placement can trap the last label. Repack the
    // annotations into nearby screen slots, retaining lines to their true anchors.
    const columns = Math.max(1, Math.min(3, Math.floor((area.width + gap) / 88)));
    const rows = Math.ceil(sorted.length / columns);
    const cellWidth = Math.min(108, (area.width - gap * (columns - 1)) / columns);
    const cellHeight = Math.min(94, (area.height - gap * (rows - 1)) / Math.max(1, rows));
    const left = area.left + (area.width - columns * cellWidth - (columns - 1) * gap) / 2;
    placed.length = 0;
    sorted.forEach((item, index) => {
      const row = Math.floor(index / columns), column = index % columns;
      const height = item.photo ? cellHeight : Math.min(32, cellHeight);
      placed.push({ id: item.id, x: left + column * (cellWidth + gap), y: area.top + row * (cellHeight + gap), width: cellWidth, height });
    });
  }
  return items.map(item => placed.find(slot => slot.id === item.id));
}

/** Individual map annotations, not a dialog, list panel or detached photo rail. */
export function mountNearbyView({ viewport, store, map, onSelect = () => {} }) {
  const doc = viewport.ownerDocument, view = doc.defaultView;
  const layer = doc.createElement('section'); layer.className = 'nearby-view'; layer.hidden = true;
  layer.setAttribute('aria-label', '地图上的周边景点和照片');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('nearby-connections'); svg.setAttribute('aria-hidden', 'true');
  const origin = doc.createElement('p'); origin.className = 'nearby-origin';
  const status = doc.createElement('span'); status.className = 'sr-only'; status.setAttribute('role', 'status');
  layer.append(svg, origin, status); viewport.append(layer);
  const close = doc.createElement('button'); close.type = 'button'; close.className = 'map-control nearby-close'; close.hidden = true;
  close.setAttribute('aria-label', '收起周边景点'); close.title = '收起周边景点'; close.innerHTML = icon('close');
  viewport.querySelector('.map-controls').append(close);
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let previous = null, frame = null, disposed = false, annotations = [], area;
  function cancelFrame() { if (frame !== null) view.cancelAnimationFrame(frame); frame = null; }
  function dismiss() {
    const focused = layer.contains(doc.activeElement) || doc.activeElement === close;
    store.set({ nearbyView: null });
    if (focused) viewport.focus({ preventScroll: true });
  }
  function safeArea() {
    const area=mapOverlayArea(viewport);
    origin.style.top='6px';origin.style.left=`${area.left}px`;
    return {...area,top:area.top+24,height:Math.max(1,area.height-24)};
  }
  function position() {
    if (!previous || !area || layer.hidden || !viewport.clientWidth || !viewport.clientHeight) return;
    const visible = [];
    for (const annotation of annotations) {
      const point = map.poiPoint(annotation.item.poiId);
      const shown = point && point.x >= 0 && point.x <= viewport.clientWidth && point.y >= 0 && point.y <= area.top + area.height;
      annotation.button.hidden = !shown; annotation.path.style.display = shown ? '' : 'none'; annotation.dot.style.display = shown ? '' : 'none';
      if (shown) visible.push({ ...point, id: annotation.item.poiId, photo: annotation.photo });
    }
    const slots = nearbyMapLayout(visible, area);
    for (const slot of slots) {
      const annotation = annotations.find(item => item.item.poiId === slot.id), point = visible.find(item => item.id === slot.id);
      const { button, path, dot } = annotation;
      button.style.transform = `translate3d(${slot.x}px,${slot.y}px,0)`;
      button.style.width = `${slot.width}px`; button.style.height = `${slot.height}px`;
      const x = Math.max(slot.x + 6, Math.min(slot.x + slot.width - 6, point.x));
      const y = Math.max(slot.y + 6, Math.min(slot.y + slot.height - 6, point.y));
      path.setAttribute('d', `M${point.x},${point.y} L${x},${y}`);
      dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y);
    }
  }
  function layout(immediate = false) {
    if (!previous || disposed || !viewport.clientWidth || !viewport.clientHeight) return;
    area = safeArea(); position();
    map.focusNearby([...previous.items.map(item => item.poiId), ...(previous.origin.kind === 'poi' ? [previous.origin.poiId] : [])], { immediate, area });
  }
  function schedule(immediate = false) {
    cancelFrame(); frame = view.requestAnimationFrame(() => { frame = null; layout(immediate); });
  }
  function clear() {
    layer.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    for (const annotation of annotations) annotation.button.remove();
    annotations = []; svg.replaceChildren();
    for (const marker of viewport.querySelectorAll('[data-nearby-poi]')) { delete marker.dataset.nearbyPoi; marker.inert = false; }
  }
  function update(state) {
    const next = state.view === 'map' && !state.facilityInfo && !state.introductionView ? state.nearbyView : null;
    if (next === previous) return;
    previous = next; cancelFrame(); clear();
    viewport.dataset.nearby = String(!!next);
    const app = doc.querySelector('#app'); if (app) app.dataset.browsingNearby = String(!!next);
    const pet = doc.querySelector('#companion-pet'); if (pet) pet.inert = !!next;
    layer.hidden = !next; close.hidden = !next;
    if (!next) {
      if (!state.introductionView && !state.plannedRoute) map.cancelFlight();
      map.refresh(); return;
    }
    origin.textContent = `${next.origin.kind === 'poi' ? `以${next.origin.name}为中心 · 非游客定位` : '以游客定位为中心'} · ${next.radius} 米内`;
    origin.title = next.disclaimer;
    status.textContent = next.items.length ? `地图已标注${next.items.length}处周边景点。有照片的景点在对应标记旁展示资料照片。距离为估算直线距离。` : '这个范围暂没有已收录的其他景点。';
    if (!next.items.length) origin.textContent += ' · 暂无已收录景点';
    for (const [index, item] of next.items.entries()) {
      const photo = item.photos[0];
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'nearby-annotation'; button.dataset.nearbyId = item.poiId;
      button.dataset.photo = String(!!photo);
      button.setAttribute('aria-label', `查看${item.name}，估算直线距离${item.distanceMeters}米${photo ? '，有景点资料照片' : '，暂未收录照片'}`);
      const content = doc.createElement('span'); content.className = 'nearby-annotation-content';
      if (photo) {
        const image = doc.createElement('img'); image.alt = `${item.name} · ${photo.caption}`; image.decoding = 'async'; image.draggable = false;
        image.addEventListener('load', async () => {
          try { await image.decode(); } catch { /* Image can already be decoded. */ }
          if (!disposed && image.isConnected) image.dataset.ready = 'true';
        }, { once: true });
        image.addEventListener('error', () => { image.remove(); button.dataset.photo = 'false'; annotation.photo = false; position(); }, { once: true });
        image.src = photo.file; content.append(image);
        button.title = `${photo.attribution} · 资料照片，非实时景象`;
      }
      const label = doc.createElement('span'); label.className = 'nearby-label';
      const name = doc.createElement('strong'); name.textContent = item.name;
      const distance = doc.createElement('small'); distance.textContent = `直线约 ${item.distanceMeters} 米`;
      label.append(name, distance); content.append(label); button.append(content);
      button.addEventListener('click', () => onSelect(item.poiId)); layer.append(button);
      const path = doc.createElementNS(svg.namespaceURI, 'path'); const dot = doc.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('r', '4'); svg.append(path, dot);
      const annotation = { item, button, path, dot, photo: !!photo }; annotations.push(annotation);
      const marker = viewport.querySelector(`[data-poi="${item.poiId}"]`);
      if (marker) { marker.dataset.nearbyPoi = String(index + 1); marker.inert = true; }
      if (!reduced.matches) content.animate([{ opacity: 0, transform: 'translateY(12px) scale(.9)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], {
        duration: 600, delay: index * 65, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards',
      });
    }
    area = safeArea(); position(); map.refresh(); schedule();
  }
  const unsubscribeTransform = map.onTransform(position);
  const observer = new view.ResizeObserver(() => { if (previous) schedule(true); }); observer.observe(viewport);
  for (const node of [doc.querySelector('.voice-dock'), doc.querySelector('.call-info')]) if (node) observer.observe(node);
  const settle = () => { if (reduced.matches || doc.hidden) { layer.getAnimations({ subtree: true }).forEach(animation => animation.finish()); if (previous) schedule(true); } };
  const escape = event => { if (event.key === 'Escape' && previous) { event.preventDefault(); dismiss(); } };
  const reset = event => { if (event.target.closest('[data-map-action="reset"]') && previous) dismiss(); };
  close.addEventListener('click', dismiss);
  viewport.addEventListener('keydown', escape); viewport.addEventListener('click', reset, true);
  reduced.addEventListener('change', settle); doc.addEventListener('visibilitychange', settle);
  const unsubscribe = store.subscribe(update); update(store.get());
  return () => {
    disposed = true; unsubscribe(); unsubscribeTransform(); cancelFrame(); observer.disconnect(); clear(); map.cancelFlight(); layer.remove(); close.remove();
    viewport.dataset.nearby = 'false';
    const app = doc.querySelector('#app'); if (app) app.dataset.browsingNearby = 'false';
    const pet = doc.querySelector('#companion-pet'); if (pet) pet.inert = false;
    viewport.removeEventListener('keydown', escape); viewport.removeEventListener('click', reset, true);
    reduced.removeEventListener('change', settle); doc.removeEventListener('visibilitychange', settle);
  };
}
