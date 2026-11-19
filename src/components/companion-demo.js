import { createWatercolorOtter, createFeltDandelion } from './reference-art-avatar.js';
import { clampCompanionPosition, mountCompanionDrag } from './companion-drag.js';
import { advanceCompanionMotion, companionSize } from './companion-motion.js';
import { icon } from './icons.js';
import { safeCompanionPlacement } from './companion-placement.js';

export const GUIDES = Object.freeze({
  'otter-watercolor': { name: '沐沐', portrait:'./assets/arrival/welcome-guide.png', surface: 'companion-otter-watercolor', create: createWatercolorOtter },
  'dandelion-felt': { name: '绒绒', portrait:'./assets/reference-avatars/dandelion-preview.png', surface: 'companion-dandelion-felt', create: createFeltDandelion },
});
export const DEFAULT_GUIDE = 'otter-watercolor';

function menuMarkup(id, label, value = '') {
  return `<div class="companion-choice"><button type="button" id="companion-${id}" class="companion-choice-trigger" aria-label="${label}" aria-haspopup="listbox" aria-expanded="false" aria-controls="companion-${id}-options"><img class="guide-choice-avatar" src="${GUIDES[DEFAULT_GUIDE].portrait}" alt=""/><span data-choice-value>${value}</span>${icon('down')}</button><div id="companion-${id}-options" class="companion-options" role="listbox" aria-label="${label}" hidden></div></div>`;
}

export function companionMarkup() {
  const defaultGuide = GUIDES[DEFAULT_GUIDE];
  const surfaces = Object.entries(GUIDES).map(([id, guide]) => {
    return `<canvas id="${guide.surface}"${id === DEFAULT_GUIDE ? '' : ' hidden'} aria-label="${guide.name}"></canvas>`;
  }).join('');
  return `<section class="companion-controls" aria-label="伴游设置">
    ${menuMarkup('guide', '切换数字导游', defaultGuide.name)}
    <span id="companion-status" role="status" class="sr-only"></span>
  </section><button type="button" id="companion-pet" class="companion-pet" data-guide-name="${defaultGuide.name}" aria-label="${defaultGuide.name}，重听讲解" aria-describedby="companion-drag-hint" aria-busy="true">${surfaces}<span id="companion-loading" class="companion-loading">导游正在过来…</span></button><span id="companion-drag-hint" class="sr-only">可拖动到画面内任意位置；聚焦后可用方向键移动。轻点重听或打断讲解。</span>`;
}

export function mountCompanionDemo({ host, stage, store, map, onActivate }) {
  host.insertAdjacentHTML('beforeend', companionMarkup());
  const root = host.closest('#app');
  const controls = host.querySelector('.companion-controls');
  root.querySelector('#guide-picker').append(controls);
  const pet = host.querySelector('#companion-pet');
  // Keep the fixed character and menus in the same stacking context.
  host.closest('#app').append(pet);
  const surfaces = Object.fromEntries(Object.entries(GUIDES).map(([id, guide]) => [id, pet.querySelector(`#${guide.surface}`)]));
  const status = root.querySelector('#companion-status');
  const loading = pet.querySelector('#companion-loading');
  const portrait = host.querySelector('#replay-guide');
  portrait.querySelector('svg')?.remove();
  const thumbnail = document.createElement('img'); thumbnail.alt = ''; thumbnail.className = 'guide-animal-thumbnail'; portrait.prepend(thumbnail);
  const models = new Map(); const pending = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = DEFAULT_GUIDE; let state = store.get(); let roaming = false;
  let disposed = false; let generation = 0; let frame; let last = 0; let started = performance.now(); let openMenu = null;
  let x = 0; let y = 0; let target = 0; let placed = false; let petHeight = 180; let bounds = { left: 0, right: 0, top: 0, bottom: 0 }; let lastPosition = ''; let needsPortrait = true;
  let mapFrame = null, focusStart = null, focusToken = null, baseHeight = 100;
  let dockGeometry = '', placementBounds = bounds;
  let panoramaFrame=null;
  const obstacles=()=>[...root.querySelectorAll('.interaction-launcher,.voice-dock,.panorama-point-info,.panorama-hotspot,.photo-caption,.reply-media,.scene-controls,.panorama-back-map,.panorama-narration-start,.introduction-photo,.introduction-label,.nearby-annotation,.map-controls,.route-stop')]
    .filter(node=>!node.hidden && getComputedStyle(node).display!=='none' && getComputedStyle(node).visibility!=='hidden')
    .map(node=>node.getBoundingClientRect()).filter(rect=>rect.width>0 && rect.height>0);

  function syncGuideLabels() {
    const name = GUIDES[mode].name;
    const playing = ['speaking', 'preparing'].includes(state.guideStatus);
    host.querySelector('.guide-name strong').textContent = name;
    host.setAttribute('aria-label', `和${name}说说话`);
    root.querySelector('label[for="voice-input"]').textContent = `想去哪里，问问${name}`;
    const input = root.querySelector('#voice-input');
    const placeholder = state.interactionMode === 'text' ? `问问${name}，想看哪里？` : state.guideStatus === 'listening' ? '我在听…' : state.voiceSession ? '随时开口交流' : `想去哪里？问问${name}`;
    if (input.placeholder !== placeholder) input.placeholder = placeholder;
    portrait.setAttribute('aria-label', playing ? '打断讲解' : `重听${name}的话`);
    pet.dataset.guideName = name;
    pet.setAttribute('aria-label', playing ? `${name}，打断讲解` : `${name}，重听讲解`);
    const trigger = root.querySelector('#companion-guide');
    trigger.querySelector('[data-choice-value]').textContent = name;
    trigger.setAttribute('aria-label', `切换数字导游，当前${name}`);
    const picture=trigger.querySelector('img');
    if (picture.getAttribute('src')!==GUIDES[mode].portrait) picture.src=GUIDES[mode].portrait;
  }
  function closeMenus(restore = false) {
    const previous = openMenu; openMenu = null;
    root.querySelectorAll('.companion-options').forEach(el => { el.hidden = true; });
    root.querySelectorAll('.companion-choice-trigger').forEach(el => el.setAttribute('aria-expanded', 'false'));
    if (restore && previous) root.querySelector(`#companion-${previous}`)?.focus({ preventScroll: true });
  }
  async function selectMode(next) {
    const token = ++generation; closeMenus(); pet.setAttribute('aria-busy', 'true'); loading.hidden = false;
    status.textContent = `正在请${GUIDES[next].name}过来`;
    try {
      if (!models.has(next)) {
        if (!pending.has(next)) pending.set(next, Promise.resolve().then(() => GUIDES[next].create(surfaces[next])));
        const model = await pending.get(next); pending.delete(next); if (disposed) { model.dispose(); return; } models.set(next, model);
      }
      if (disposed || token !== generation) return;
      mode = next; started = performance.now(); needsPortrait = true;
      if(store.get().guideName!==GUIDES[mode].name)store.set({guideName:GUIDES[mode].name});
      Object.entries(surfaces).forEach(([key, surface]) => { surface.hidden = key !== mode; });
      root.querySelectorAll('[data-avatar-mode]').forEach(button => { const selected = String(button.dataset.avatarMode === mode); button.setAttribute('aria-pressed', selected); button.setAttribute('aria-selected', selected); });
      syncGuideLabels(); loading.hidden = true; pet.dataset.mode = mode; status.textContent = `已切换${GUIDES[mode].name}`;
    } catch { pending.delete(next); if (token === generation && !disposed) { status.textContent = '导游暂时没加载出来，请再选一次'; loading.textContent = '导游暂时没到，再试一次'; } }
    finally { if (!disposed && token === generation) pet.setAttribute('aria-busy', 'false'); }
  }
  function dock() {
    const box = stage.getBoundingClientRect();
    if (state.textEditing || box.width <= 0 || box.height <= 0) { pet.hidden=true; return; }
    const toolbar = stage.querySelector('.facility-filters')?.getBoundingClientRect(); const floor = toolbar?.height ? toolbar.top - 8 : box.bottom - 18;
    const companionAvailable = state.tourMode === 'companion' ? box.height - 24 : floor - box.top - 55;
    const { width, height } = companionSize({ viewportHeight: window.visualViewport?.height ?? innerHeight, stageWidth: box.width, availableHeight: companionAvailable });
    baseHeight = height;
    const following = mapFrame?.focus && !mapFrame.focus.cancelled && state.view === 'map' && !placed;
    const geometry = [box.left,box.top,box.width,box.height,state.view,state.tourMode,height].join('|');
    const resized = geometry !== dockGeometry; dockGeometry = geometry;
    // Capture/transcript/location renders must not reset a manually placed or
    // interrupted guide's interpolated size. Only a new scene/layout resizes it.
    if (!following && (resized || !placed)) { petHeight = height; pet.style.width = `${width}px`; pet.style.height = `${height}px`; }
    const currentWidth = petHeight * .75;
    const boundsWidth = following ? width : currentWidth, boundsHeight = following ? height : petHeight;
    // A short companion map has no room above its raised facility bar. Dock
    // beside that bar, while leaving the floating audio controls unobstructed.
    const sideDock = state.tourMode === 'companion' && toolbar?.height && floor - box.top - 55 < height + 12 && box.right - toolbar.right > width + 24;
    const safeLeft = sideDock ? toolbar.right + 12 : box.left + 12;
    const safeFloor = sideDock ? Math.min(box.bottom - 18, host.getBoundingClientRect().top - 12) : floor;
    bounds = { left: safeLeft, right: Math.max(safeLeft, box.right - boundsWidth - 12), top: box.top + 55, bottom: Math.max(box.top + 55, safeFloor - boundsHeight) };
    placementBounds = {left:box.left+4,right:Math.max(box.left+4,box.right-currentWidth-4),top:box.top+45,bottom:Math.max(box.top+45,box.bottom-petHeight-8)};
    const selected = stage.querySelector('[data-poi].selected, [data-facility].selected');
    if (roaming && !placed) target = selected && selected.getBoundingClientRect().left < box.left + box.width / 2 ? bounds.right : bounds.left;
    else target = x;
    if (!last) x = target;
    if (!following) {
      if (!placed) y = bounds.bottom;
      ({ x, y } = clampCompanionPosition({ x, y }, placed ? placementBounds : bounds));
    }
    positionPet();
    pet.hidden = width < 48 || box.width < 240 || getComputedStyle(stage).visibility === 'hidden' || !!document.querySelector('dialog[open]');
    if (following) syncMap(mapFrame);
  }
  function syncMap(snapshot) {
    mapFrame = snapshot;
    if (!snapshot?.focus || snapshot.focus.cancelled || state.view !== 'map' || placed || pet.dataset.dragging === 'true') return;
    const { focus, scale } = snapshot, point = focus.home ? null : map.point(focus.point);
    if (!focus.home && !point) return;
    if (focusToken !== focus.token) { focusToken = focus.token; focusStart = {x,y,height:petHeight}; }
    const box = stage.querySelector('.map-viewport').getBoundingClientRect();
    const height = focus.home ? baseHeight : Math.max(45,Math.min(baseHeight * (1 + Math.min(1.4, scale-1)*.2), box.height * .4, 160));
    petHeight = focusStart.height+(height-focusStart.height)*focus.progress;
    pet.style.height = `${petHeight}px`; pet.style.width = `${petHeight*.75}px`;
    placementBounds = {left:box.left+4,right:Math.max(box.left+4,box.right-petHeight*.75-4),top:box.top+45,bottom:Math.max(box.top+45,box.bottom-petHeight-8)};
    const width = petHeight*.75, progress = focus.progress;
    const destX = focus.home ? bounds.left : Math.max(box.left+4, Math.min(box.right-width-46, box.left+point.x+22));
    const destY = focus.home ? bounds.bottom : Math.max(box.top+45, Math.min(box.bottom-petHeight-65, box.top+point.y-petHeight*.58));
    x = focusStart.x+(destX-focusStart.x)*progress; y = focusStart.y+(destY-focusStart.y)*progress;
    target = x; pet.dataset.mapMoving = String(progress>0 && progress<1); positionPet();
  }
  const detachMap = map?.onTransform(snapshot => {
    if (snapshot.focus && snapshot.focus.token !== focusToken) placed = false;
    if (snapshot.focus?.cancelled) { placed = true; pet.dataset.mapMoving = 'false'; }
    syncMap(snapshot);
    if (snapshot.focus?.home && snapshot.focus.progress === 1) { mapFrame=null; focusToken=null; placed=false; dock(); }
    if (!snapshot.focus) { focusToken = null; pet.dataset.mapMoving = 'false'; dock(); }
  });
  function positionPet() {
    if(pet.dataset.dragging!=='true'){
      const safe=safeCompanionPlacement({x,y,width:petHeight*.75,height:petHeight,bounds:placementBounds,obstacles:obstacles()});
      pet.style.visibility=safe?'':'hidden';
      if(safe)({x,y}=safe);
    }
    const position = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (position !== lastPosition) { pet.style.left = `${x}px`; pet.style.top = `${y}px`; lastPosition = position; }
  }
  const panoramaChanged=event=>{
    const view=event.detail;
    if(state.view!=='panorama' || placed || pet.dataset.dragging==='true' || !view?.ready)return;
    const box=stage.getBoundingClientRect();
    panoramaFrame=view;
    // Screen-relative guide, not a fake object inside the cubemap. Yaw and pitch
    // change its docking position; the actual camera callback is the clock.
    x=box.left+box.width*(.5+Math.sin(view.yaw)*.3)-petHeight*.375;
    y=box.top+box.height*(.54-Math.sin(view.pitch)*.18)-petHeight*.5;
    ({x,y}=clampCompanionPosition({x,y},placementBounds));target=x;positionPet();
  };
  stage.addEventListener('virtour:panorama-view',panoramaChanged);
  const guideList = root.querySelector('#companion-guide-options');
  for (const [id, guide] of Object.entries(GUIDES)) {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'option'; button.dataset.avatarMode = id;
    button.setAttribute('aria-selected', String(id === mode)); button.setAttribute('aria-pressed', String(id === mode));
    button.innerHTML = `<img class="guide-choice-avatar" src="${guide.portrait}" alt=""/><span>${guide.name}</span>${icon('check')}`;
    button.addEventListener('click', () => { closeMenus(true); void selectMode(id); }); guideList.append(button);
  }
  function focusOption(list, option) {
    if (!option) return;
    option.focus({ preventScroll: true });
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
  for (const id of ['guide']) {
    const trigger = root.querySelector(`#companion-${id}`); const list = root.querySelector(`#companion-${id}-options`);
    const open = (edge = 'selected') => {
      closeMenus(); openMenu = id; list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
      const box = list.getBoundingClientRect();
      const rightEdge = innerWidth - 8; const leftEdge = 8;
      const offset = Math.min(0, rightEdge - box.right) + Math.max(0, leftEdge - box.left);
      list.style.translate = `${offset}px 0`;
      const options = list.querySelectorAll('button:not(:disabled)');
      const option = edge === 'first' ? options[0] : edge === 'last' ? options[options.length - 1] : list.querySelector('[aria-selected="true"]');
      focusOption(list, option);
    };
    trigger.addEventListener('click', () => { if (openMenu === id) closeMenus(); else { list.style.translate = ''; open(); } });
    trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); list.style.translate = ''; open(event.key === 'ArrowDown' ? 'first' : 'last'); } });
    list.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const options = [...list.querySelectorAll('button:not(:disabled)')]; const current = options.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      focusOption(list, options[index]);
    });
  }
  const outside = event => { if (!event.target.closest('.companion-choice')) closeMenus(); }; document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
  const keydown = event => { if (event.key === 'Escape' && openMenu) { event.preventDefault(); closeMenus(true); } }; document.addEventListener('keydown', keydown);
  const disposeDrag = mountCompanionDrag({
    element: pet,
    getPosition: () => ({x,y,bounds:placementBounds}),
    onMove(position) { closeMenus(); map?.cancelFlight(); placed = true; roaming = false; ({ x, y } = position); target = x; positionPet(); },
    onPlace() { status.textContent = '导游已放在这里'; },
  });
  pet.addEventListener('click', () => { if (!models.size) void selectMode(mode); else onActivate(); });
  const observer = new ResizeObserver(dock); observer.observe(stage); const modalObserver = new MutationObserver(dock); document.querySelectorAll('dialog').forEach(dialog => modalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  const resize = () => { closeMenus(); dock(); };
  const unsubscribe = store.subscribe(next => {
    if(next.view!==state.view){placed=false;panoramaFrame=null;}
    state = next; syncGuideLabels(); dock();
    if(panoramaFrame)panoramaChanged({detail:panoramaFrame});
  }); window.addEventListener('resize', resize); window.addEventListener('scroll', dock, { passive: true });
  function tick(now) {
    if (disposed) return; frame = requestAnimationFrame(tick); if (document.hidden || openMenu || now - last < 1000 / 30) return; const dt = Math.min((now - last) / 1000 || .033, .1); last = now;
    const following = mapFrame?.focus && !mapFrame.focus.cancelled && state.view === 'map' && !placed;
    const movement = following ? { x, target:x, moving:pet.dataset.mapMoving === 'true', walk:pet.dataset.mapMoving === 'true', run:false, action:pet.dataset.mapMoving === 'true' ? 'walk' : 'idle', direction:1 } : advanceCompanionMotion({ x, target, bounds:placed ? placementBounds : bounds, roaming, placed, blocked: pet.hidden || state.detailsOpen || pet.dataset.dragging === 'true', reduced: reduced.matches, dt, height: petHeight });
    ({ x, target } = movement);
    pet.dataset.moving = String(movement.moving); pet.dataset.motionAction = movement.action;
    positionPet();
    if (pet.hidden || !models.has(mode)) return; const time = reduced.matches ? 1 : (now - started) / 1000;
    const expressions = models.get(mode).capabilities?.expressions ?? [];
    const automaticEmotion = state.guideStatus === 'listening' ? 'curious' : state.guideStatus === 'speaking' ? 'happy' : 'neutral';
    pet.dataset.emotion = automaticEmotion;
    models.get(mode).draw({ time, walk: movement.walk, run: movement.run, turn: movement.moving ? movement.direction * .55 : 0, action: movement.action, emotion: expressions.includes(automaticEmotion) ? automaticEmotion : 'neutral', talk: state.guideStatus === 'speaking', listen: state.guideStatus === 'listening' });
    if (needsPortrait && time > .15) {
      needsPortrait = false;
      try {
        const surface = surfaces[mode]; const svg = surface.querySelector('svg');
        thumbnail.src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : surface.toDataURL('image/png');
      } catch { thumbnail.removeAttribute('src'); }
    }
  }
  syncGuideLabels(); dock(); frame = requestAnimationFrame(tick); void selectMode(mode);
  return () => { disposed = true; generation++; detachMap?.(); controls.remove(); cancelAnimationFrame(frame); disposeDrag(); observer.disconnect(); modalObserver.disconnect(); unsubscribe(); models.forEach(model => model.dispose()); pet.remove();stage.removeEventListener('virtour:panorama-view',panoramaChanged); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', keydown); window.removeEventListener('resize', resize); window.removeEventListener('scroll', dock); };
}
