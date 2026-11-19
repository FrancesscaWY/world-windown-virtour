import { mountPageTransitions, mountCardDepth, mountMascotGreeting, isArrivalNavigation } from './presentation.js';

/** Both entry URLs remain native links; once loaded, they are two persistent slides. */
export async function mountArrivalFlow({ host = window, doc = document } = {}) {
  const initial = doc.body.dataset.page === 'modes' ? 1 : 0;
  const current = doc.querySelector('main');
  let other;
  try {
    const response = await host.fetch(initial ? './index.html' : './modes.html');
    if (!response.ok) return;
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    other = doc.importNode(parsed.querySelector('main'), true);
  } catch { return; } // Native links remain a usable no-JS/network fallback.
  const pages = initial ? [other, current] : [current, other];
  const viewport = doc.createElement('div'); viewport.className = 'arrival-viewport';
  const track = doc.createElement('div'); track.className = 'arrival-track';
  const panels = pages.map((page, index) => {
    page.querySelector('.arrival-progress')?.remove();
    const panel = doc.createElement('section'); panel.className = 'arrival-panel'; panel.dataset.slide = index;
    panel.append(page); track.append(panel); return panel;
  });
  viewport.append(track); doc.body.prepend(viewport);
  const progress = doc.createElement('nav'); progress.className = 'arrival-flow-progress';
  progress.setAttribute('aria-label', '欢迎与模式选择');
  progress.innerHTML = '<a data-swipe-link href="./index.html" aria-label="欢迎页"></a><a data-swipe-link href="./modes.html" aria-label="选择游览模式"></a><span class="arrival-progress-thumb" aria-hidden="true"></span>';
  doc.body.append(progress); doc.body.classList.add('arrival-flow');
  let index = initial, pointer = null, position = index, dragged = false, suppressClick = false, suppressTimer = null;
  const paint = value => { position = value; doc.body.style.setProperty('--arrival-position', value); };
  const select = (next, { history = true, focus = false } = {}) => {
    index = next; paint(index); doc.body.dataset.page = index ? 'modes' : 'welcome';
    panels.forEach((panel, i) => { panel.inert = i !== index; panel.setAttribute('aria-hidden', String(i !== index)); });
    [...progress.querySelectorAll('a')].forEach((link, i) => { if (i === index) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    doc.title = index ? '选择游览模式 · 深圳世界之窗' : '深圳世界之窗 · AI 伴游';
    if (history) host.history.pushState({ arrival: index }, '', index ? './modes.html' : './index.html');
    if (focus) { const title = pages[index].querySelector('h1'); title.tabIndex = -1; title.focus({ preventScroll: true }); }
  };
  select(initial, { history: false });
  const click = event => {
    if (suppressClick) { suppressClick = false; host.clearTimeout(suppressTimer); event.preventDefault(); event.stopImmediatePropagation(); return; }
    const link = event.target.closest?.('a[href]');
    if (!isArrivalNavigation(event, link, host.location.href)) return;
    const url = new URL(link.href);
    if (!/\/(?:index|modes)\.html$/.test(url.pathname) && url.pathname !== '/') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const next = url.pathname.endsWith('modes.html') ? 1 : 0;
    if (next !== index) select(next, { focus: event.detail === 0 });
  };
  const down = event => {
    const control = event.target.closest?.('a,button,input,select,textarea');
    if (control && !control.hasAttribute('data-swipe-link')) {
      suppressClick=false;host.clearTimeout(suppressTimer);return;
    }
    if (event.isPrimary === false || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; dragged = false; suppressClick = false;
  };
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!dragged && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { pointer = null; return; }
    if (!dragged && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      dragged = true; viewport.setPointerCapture(event.pointerId); doc.body.classList.add('is-dragging-arrival');
    }
    if (!dragged) return;
    event.preventDefault();
    paint(Math.max(0, Math.min(1, index - dx / viewport.clientWidth)));
  };
  const end = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const next = event.type === 'pointercancel' ? index : position > index + .16 ? 1 : position < index - .16 ? 0 : index;
    pointer = null; suppressClick = dragged && event.type!=='pointercancel'; doc.body.classList.remove('is-dragging-arrival');
    // A touch swipe may produce no synthetic click. Never eat the next deliberate tap.
    host.clearTimeout(suppressTimer);
    if(suppressClick)suppressTimer=host.setTimeout(()=>{suppressClick=false;},350);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (next !== index) select(next); else paint(index);
  };
  const pop = () => select(host.location.pathname.endsWith('modes.html') ? 1 : 0, { history: false });
  const key = event => {
    if (event.target.closest?.('input,select,textarea') || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    const next = event.key === 'ArrowRight' ? 1 : 0;
    if (next !== index) { event.preventDefault(); select(next, { focus: true }); }
  };
  doc.body.addEventListener('click', click, true);
  doc.body.addEventListener('keydown', key);
  viewport.addEventListener('pointerdown', down); viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('dragstart', event => event.preventDefault());
  host.addEventListener('popstate', pop);
  const transitions = mountPageTransitions(doc.body);
  const depth = mountCardDepth(doc.querySelectorAll('.arrival-mode-card'));
  const greeting = mountMascotGreeting(doc.querySelector('.welcome-guide'), doc.querySelector('#welcome-message'));
  host.addEventListener('pagehide', event => {
    if (event.persisted) return;
    transitions.dispose(); depth(); greeting(); host.removeEventListener('popstate', pop);
  });
}
