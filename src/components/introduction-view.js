import { getPoi } from '../data/pois.js';
import { introductionPhotos } from '../data/introduction-views.js';
import { icon } from './icons.js';
import { mapOverlayArea } from './map-overlay-area.js';

/** Two photographs above the landmark, a third below; all sizes are screen pixels. */
export function introductionLayout({ left = 12, top = 12, width, height }, count = 3) {
  if(height<180){
    const gap=6,cardWidth=Math.min(150,(width-gap*(count-1))/count);
    const cardHeight=Math.max(20,Math.min(100,Math.max(68,cardWidth*.8+20),height-46));
    const x=left+width/2,y=top+height-16;
    const slots=Array.from({length:count},(_,i)=>({x:(i-(count-1)/2)*(cardWidth+gap),y:-30-cardHeight/2,angle:0}));
    return {x,y,cardWidth,cardHeight,slots,compact:true};
  }
  // Split screens need actual photos, not three caption-sized slivers around a large gap.
  if (height < 330) {
    const gap = 10, cardWidth = Math.min(150, (width - 20 - gap * (count - 1)) / count);
    const cardHeight = Math.max(68, Math.min(100, cardWidth * .8 + 20));
    const x = left + width / 2, y = top + Math.max(cardHeight + 56, height * .6);
    const slots = Array.from({ length:count }, (_, i) => ({ x:(i - (count - 1) / 2) * (cardWidth + gap), y:-cardHeight / 2 - 46, angle:0 }));
    return { x, y, cardWidth, cardHeight, slots };
  }
  const gap = 26;
  const cardWidth = Math.max(64, Math.min(210, (width - gap - 16) / 2));
  const cardHeight = Math.max(68, Math.min(cardWidth * .82, (height - 128) / 2));
  const x = left + width / 2, y = top + height / 2;
  const slots = count === 1 ? [{ x: 0, y: -cardHeight / 2 - 46, angle: -3 }]
    : [{ x: -(cardWidth + gap) / 2, y: -cardHeight / 2 - 46, angle: -5 },
      { x: (cardWidth + gap) / 2, y: -cardHeight / 2 - 46, angle: 5 },
      { x: (cardWidth + gap) / 2, y: cardHeight / 2 + 46, angle: -2 }];
  return { x, y, cardWidth, cardHeight, slots: slots.slice(0, count) };
}

/** Only trusted catalog assets enter the DOM. Tool results carry an ID, not HTML or URLs. */
export function mountIntroductionView({ viewport, store, map }) {
  const doc = viewport.ownerDocument, view = doc.defaultView;
  const layer = doc.createElement('section');
  layer.className = 'introduction-view'; layer.hidden = true;
  layer.setAttribute('aria-label', '景点图片讲解');
  const lines = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.classList.add('introduction-threads'); lines.setAttribute('aria-hidden', 'true');
  const center = doc.createElement('div'); center.className = 'introduction-center';
  const label = doc.createElement('span'); label.className = 'introduction-label';
  const close = doc.createElement('button'); close.type = 'button'; close.className = 'map-control introduction-close';close.hidden=true;
  close.setAttribute('aria-label', '收起景点图片'); close.innerHTML = icon('close');
  const announcement = doc.createElement('span'); announcement.className = 'sr-only'; announcement.setAttribute('role', 'status');
  layer.append(lines, center, label, announcement); viewport.append(layer);
  viewport.querySelector('.map-controls').append(close);
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  let previous, cards = [], paths = [], layout, areaKey, frame = null, disposed = false;

  function safeArea() {
    return mapOverlayArea(viewport);
  }
  function position() {
    if (!layout || !previous || layer.hidden || !viewport.clientWidth || !viewport.clientHeight) return;
    const point = map.poiPoint(previous.poiId);
    if (!point) return;
    const { x, y } = point;
    center.style.left = `${x}px`; center.style.top = `${y}px`;
    label.style.left = `${x}px`; label.style.top = `${y + 16}px`;
    cards.forEach((card, index) => {
      const slot = layout.slots[index];
      Object.assign(card.style, { left: `${x + slot.x}px`, top: `${y + slot.y}px`, width: `${layout.cardWidth}px`, height: `${layout.cardHeight}px` });
      card.dataset.compact = String(layout.cardHeight < 100);
      card.style.setProperty('--from-x', `${-slot.x}px`); card.style.setProperty('--from-y', `${-slot.y}px`);
      card.style.setProperty('--tilt', `${slot.angle}deg`);
      paths[index].setAttribute('d', `M${x},${y} Q${x + slot.x * .15},${y + slot.y * .8} ${x + slot.x},${y + slot.y}`);
    });
  }
  function cancel() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null; map.cancelFlight();
    layer.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  }
  function hide() {
    cancel(); layer.hidden = true; close.hidden=true;viewport.dataset.introducing = 'false';
    for (const marker of viewport.querySelectorAll('.introducing-poi')) marker.classList.remove('introducing-poi');
    cards.forEach(card => card.remove()); cards = []; paths = []; lines.replaceChildren();
  }
  function dismiss() {
    if (!previous) return;
    const focused = layer.contains(doc.activeElement);
    store.set({ introductionView: null });
    if (focused) viewport.focus({ preventScroll: true });
  }
  function frameScene(immediate = false) {
    if (disposed || !previous || layer.hidden || !viewport.clientWidth || !viewport.clientHeight) return;
    const area = safeArea(); areaKey = JSON.stringify(area);
    layout = introductionLayout(area, cards.length);
    layer.dataset.compact=String(Boolean(layout.compact));
    position();
    map.flyToPoi(previous.poiId, { x: layout.x, y: layout.y, immediate, onComplete() {
      if (disposed || layer.hidden) return;
      position(); layer.dataset.phase = 'open';
    } });
  }
  function scheduleFrame(immediate = false) {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => { frame = null; frameScene(immediate); });
  }
  function update(state) {
    const next = state.view === 'map' && !state.facilityInfo && state.introductionView?.poiId === state.selectedPoiId ? state.introductionView : null;
    if (next === previous) return;
    previous = next; hide();
    const poi = getPoi(next?.poiId);
    if (!poi?.position || !poi.locationVerified) return;
    layer.hidden = false; close.hidden=false;layer.dataset.phase = 'travel'; viewport.dataset.introducing = 'true';
    viewport.querySelector(`[data-poi="${poi.id}"]`)?.classList.add('introducing-poi');
    label.textContent = poi.name;
    const photos = introductionPhotos(poi.id).slice(0, 3);
    for (const [index, photo] of photos.entries()) {
      const card = doc.createElement('figure'); card.className = 'introduction-photo'; card.style.setProperty('--order', index);
      const image = doc.createElement('img'); image.alt = `${poi.name} · ${photo.caption}`; image.draggable = false;
      image.decoding = 'async';
      const caption = doc.createElement('figcaption');
      const title = doc.createElement('strong'); title.textContent = photo.title;
      const text = doc.createElement('span'); text.textContent = photo.caption;
      caption.append(title, text); card.append(image, caption); card.title = photo.attribution;
      const credit = doc.createElement('span'); credit.className = 'sr-only'; credit.textContent = photo.attribution; card.append(credit);
      image.addEventListener('error', () => { image.hidden = true; card.dataset.failed = 'true'; text.textContent = '图片暂未加载，可继续听讲解'; }, { once: true });
      image.src = photo.file;
      const path = doc.createElementNS(lines.namespaceURI, 'path'); path.style.setProperty('--order', index); lines.append(path);
      cards.push(card); paths.push(path); layer.append(card);
    }
    announcement.textContent = `正在介绍${poi.name}，${photos.length ? `展开${photos.length}张景点图片` : '此景点暂未配置图片'}。`;
    scheduleFrame();
  }
  const unsubscribeTransform = map.onTransform(position);
  const unsubscribe = store.subscribe(update); update(store.get());
  const resize = () => { if (previous && layout && JSON.stringify(safeArea()) !== areaKey) scheduleFrame(true); };
  const observer = new view.ResizeObserver(resize); observer.observe(viewport);
  const dock = doc.querySelector('.voice-dock'); if (dock) observer.observe(dock);
  const callInfo = doc.querySelector('.call-info'); if (callInfo) observer.observe(callInfo);
  const settle = () => {
    if (previous && (reducedMotion.matches || doc.hidden)) {
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null; map.cancelFlight(); frameScene(true);
    }
  };
  const interact = event => {
    if (layer.hidden || event.target.closest('.introduction-view,.introduction-close')) return;
    const tool=event.target.closest('.map-controls,.map-overview');
    // Hiding a contextual rail button on pointerdown shifts the centered rail
    // before pointerup. Dismiss on click, before the map handles that action.
    if(tool && event.type!=='click' && event.type!=='keydown')return;
    if(event.type==='click' && !tool)return;
    if (event.type === 'keydown' && !['Escape', 'Home', '0', '+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    dismiss();
  };
  close.addEventListener('click', dismiss);
  for (const name of ['pointerdown', 'wheel', 'keydown','click']) viewport.addEventListener(name, interact, true);
  const escape = event => { if (event.key === 'Escape' && !layer.hidden) { event.preventDefault(); dismiss(); } };
  layer.addEventListener('keydown', escape);
  reducedMotion.addEventListener('change', settle); doc.addEventListener('visibilitychange', settle);
  return () => {
    disposed = true; unsubscribe(); unsubscribeTransform(); observer.disconnect(); hide(); layer.remove();close.remove();
    for (const name of ['pointerdown', 'wheel', 'keydown','click']) viewport.removeEventListener(name, interact, true);
    reducedMotion.removeEventListener('change', settle); doc.removeEventListener('visibilitychange', settle);
  };
}
